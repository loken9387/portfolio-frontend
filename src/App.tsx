import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? '';

interface TerminalSessionDescriptor {
  containerId: string;
  cmd?: string | null;
  websocketPath: string;
}

interface DockerContainerStatus {
  containerId?: string;
  configId?: number | string;
  state?: string;
  image?: string;
  name?: string;
  createdAt?: string;
  startedAt?: string;
  additionalInfo?: Record<string, unknown>;
  [key: string]: unknown;
}

const defaultHeaders = {
  'Content-Type': 'application/json',
};

const buildApiUrl = (path: string) => {
  if (!API_BASE_URL) return path;
  const normalizedBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`;
};

const buildWebSocketUrl = (path: string) => {
  if (path.startsWith('ws://') || path.startsWith('wss://')) return path;

  const baseFromEnv = WS_BASE_URL || API_BASE_URL;
  const origin = typeof window !== 'undefined' ? window.location : undefined;
  const fallbackBase = origin
    ? `${origin.protocol === 'https:' ? 'wss' : 'ws'}://${origin.host}`
    : 'ws://localhost:8080';
  const normalizedBase = baseFromEnv
    ? (baseFromEnv.startsWith('http')
        ? baseFromEnv.replace(/^http/, 'ws')
        : baseFromEnv
      ).replace(/\/$/, '')
    : fallbackBase;

  return `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`;
};

function prettyPrint(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.error('Unable to stringify', error);
    return String(value);
  }
}

function Badge({ label }: { label: string }) {
  return <span className="badge">{label}</span>;
}

function DockerStatusCard({ status }: { status: DockerContainerStatus }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">{status.name || status.containerId || 'Container'}</div>
        {status.state && <Badge label={String(status.state)} />}
      </div>
      <dl className="meta-grid">
        {status.containerId && (
          <div>
            <dt>Container ID</dt>
            <dd>{String(status.containerId)}</dd>
          </div>
        )}
        {status.configId !== undefined && (
          <div>
            <dt>Config ID</dt>
            <dd>{String(status.configId)}</dd>
          </div>
        )}
        {status.image && (
          <div>
            <dt>Image</dt>
            <dd>{status.image}</dd>
          </div>
        )}
        {status.startedAt && (
          <div>
            <dt>Started</dt>
            <dd>{status.startedAt}</dd>
          </div>
        )}
      </dl>
      <details className="details">
        <summary>Raw payload</summary>
        <pre className="code-block">{prettyPrint(status)}</pre>
      </details>
    </div>
  );
}

function App() {
  const [configId, setConfigId] = useState('');
  const [forceRemove, setForceRemove] = useState(false);
  const [containerId, setContainerId] = useState('');
  const [command, setCommand] = useState('');
  const [statuses, setStatuses] = useState<DockerContainerStatus[]>([]);
  const [broadcastResult, setBroadcastResult] = useState<unknown>(null);
  const [descriptor, setDescriptor] = useState<TerminalSessionDescriptor | null>(null);
  const [feedback, setFeedback] = useState('');
  const [terminalMessages, setTerminalMessages] = useState<string[]>([]);
  const [terminalInput, setTerminalInput] = useState('');
  const [socketState, setSocketState] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');

  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  const websocketUrl = useMemo(() => {
    if (!descriptor) return '';
    return buildWebSocketUrl(descriptor.websocketPath);
  }, [descriptor]);

  const appendTerminalMessage = (message: string) => {
    setTerminalMessages((prev) => [...prev, message]);
  };

  const handleStartContainer = async () => {
    if (!configId) {
      setFeedback('Config ID is required to start a container.');
      return;
    }
    try {
      setFeedback('Starting container...');
      const response = await fetch(buildApiUrl(`/api/docker/configs/${configId}/start`), {
        method: 'POST',
        headers: defaultHeaders,
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setFeedback(`Started container ${payload.containerId ?? 'successfully'}.`);
    } catch (error) {
      console.error(error);
      setFeedback('Failed to start container. Check console for details.');
    }
  };

  const handleRemoveContainers = async () => {
    if (!configId) {
      setFeedback('Config ID is required to remove containers.');
      return;
    }
    try {
      setFeedback('Removing containers...');
      const response = await fetch(
        buildApiUrl(`/api/docker/configs/${configId}/containers?force=${forceRemove}`),
        {
          method: 'DELETE',
        },
      );
      if (!response.ok) throw new Error(await response.text());
      setFeedback('Containers removed.');
    } catch (error) {
      console.error(error);
      setFeedback('Failed to remove containers. Check console for details.');
    }
  };

  const handleFetchStatuses = async () => {
    try {
      setFeedback('Refreshing status list...');
      const response = await fetch(buildApiUrl('/api/docker/status'));
      if (!response.ok) throw new Error(await response.text());
      const payload: DockerContainerStatus[] = await response.json();
      setStatuses(payload);
      setFeedback('Status list updated.');
    } catch (error) {
      console.error(error);
      setFeedback('Unable to fetch container statuses.');
    }
  };

  const handleBroadcastStatuses = async () => {
    try {
      setFeedback('Broadcasting status...');
      const response = await fetch(buildApiUrl('/api/docker/status/broadcast'), {
        method: 'POST',
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setBroadcastResult(payload);
      setFeedback('Broadcast triggered successfully.');
    } catch (error) {
      console.error(error);
      setFeedback('Unable to broadcast container statuses.');
    }
  };

  const handleRequestSession = async () => {
    if (!containerId) {
      setFeedback('Container ID is required to open a terminal session.');
      return;
    }
    try {
      setFeedback('Requesting terminal session...');
      const response = await fetch(buildApiUrl('/api/terminal/sessions'), {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify({ containerId, cmd: command || undefined }),
      });
      if (!response.ok) throw new Error(await response.text());
      const payload: TerminalSessionDescriptor = await response.json();
      setDescriptor(payload);
      setFeedback('Terminal session granted. Connect when ready.');
    } catch (error) {
      console.error(error);
      setFeedback('Terminal session request failed.');
    }
  };

  const handleConnectSocket = () => {
    if (!descriptor) {
      setFeedback('Request a terminal session before connecting.');
      return;
    }
    socketRef.current?.close();
    const ws = new WebSocket(websocketUrl);
    socketRef.current = ws;
    setSocketState('connecting');

    ws.onopen = () => {
      setSocketState('open');
      appendTerminalMessage('[connected]');
    };

    ws.onclose = () => {
      setSocketState('closed');
      appendTerminalMessage('[closed]');
    };

    ws.onerror = () => {
      setSocketState('error');
      appendTerminalMessage('[error]');
    };

    ws.onmessage = (event) => {
      appendTerminalMessage(event.data);
    };
  };

  const handleSendInput = () => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setFeedback('Open the terminal WebSocket connection first.');
      return;
    }
    socketRef.current.send(terminalInput);
    appendTerminalMessage(`> ${terminalInput}`);
    setTerminalInput('');
  };

  return (
    <div className="layout">
      <header className="hero">
        <div>
          <p className="eyebrow">Portfolio utilities</p>
          <h1>Docker &amp; Terminal Console</h1>
          <p className="lede">
            Start and stop Docker containers, broadcast their statuses, and open interactive terminal sessions via the
            provided backend endpoints.
          </p>
        </div>
        <div className="pill-group">
          <Badge label={API_BASE_URL ? `API base: ${API_BASE_URL}` : 'API base: relative'} />
          <Badge label={WS_BASE_URL ? `WebSocket base: ${WS_BASE_URL}` : 'WebSocket base: derived'} />
          <Badge label="React + Vite" />
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Docker</p>
            <h2>Manage containers</h2>
          </div>
          <div className="button-row">
            <button onClick={handleFetchStatuses}>Refresh statuses</button>
            <button onClick={handleBroadcastStatuses} className="secondary">Broadcast statuses</button>
          </div>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Config ID</span>
            <input
              type="number"
              value={configId}
              onChange={(event) => setConfigId(event.target.value)}
              placeholder="e.g. 42"
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={forceRemove}
              onChange={(event) => setForceRemove(event.target.checked)}
            />
            Force remove
          </label>
          <div className="button-row">
            <button onClick={handleStartContainer}>Start container</button>
            <button onClick={handleRemoveContainers} className="secondary">Remove containers</button>
          </div>
        </div>

        {feedback && <div className="feedback">{feedback}</div>}

        {broadcastResult && (
          <div className="card">
            <div className="card-header">
              <div className="card-title">Broadcast response</div>
            </div>
            <pre className="code-block">{prettyPrint(broadcastResult)}</pre>
          </div>
        )}

        <div className="card-grid">
          {statuses.length === 0 && (
            <p className="muted">No container statuses yet. Click "Refresh statuses" to load data.</p>
          )}
          {statuses.map((status, index) => (
            <DockerStatusCard key={status.containerId?.toString() ?? index} status={status} />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Terminal</p>
            <h2>Request and connect</h2>
          </div>
          <div className="button-row">
            <button onClick={handleRequestSession}>Request session</button>
            <button onClick={handleConnectSocket} className="secondary">Connect WebSocket</button>
          </div>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Container ID</span>
            <input
              type="text"
              value={containerId}
              onChange={(event) => setContainerId(event.target.value)}
              placeholder="container hash"
            />
          </label>
          <label className="field">
            <span>Command (optional)</span>
            <input
              type="text"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="/bin/bash"
            />
          </label>
        </div>

        {descriptor && (
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Session descriptor</div>
                <p className="muted">Pass the WebSocket URL into a terminal emulator of your choice.</p>
              </div>
            </div>
            <dl className="meta-grid">
              <div>
                <dt>Container</dt>
                <dd>{descriptor.containerId}</dd>
              </div>
              {descriptor.cmd && (
                <div>
                  <dt>Command</dt>
                  <dd>{descriptor.cmd}</dd>
                </div>
              )}
              <div>
                <dt>WebSocket path</dt>
                <dd><code>{descriptor.websocketPath}</code></dd>
              </div>
              <div>
                <dt>Full WebSocket URL</dt>
                <dd><code>{websocketUrl}</code></dd>
              </div>
            </dl>
          </div>
        )}

        <div className="terminal">
          <div className="terminal-header">
            <div>
              <div className="card-title">Interactive terminal</div>
              <p className="muted">WebSocket state: {socketState}</p>
            </div>
            <div className="button-row">
              <button onClick={handleConnectSocket}>Connect</button>
              <button
                onClick={() => {
                  socketRef.current?.close();
                  setSocketState('closed');
                }}
                className="secondary"
              >
                Disconnect
              </button>
            </div>
          </div>
          <div className="terminal-body">
            <div className="terminal-output">
              {terminalMessages.length === 0 && <p className="muted">No terminal output yet.</p>}
              {terminalMessages.map((line, index) => (
                <div key={`${line}-${index}`} className="terminal-line">{line}</div>
              ))}
            </div>
            <div className="terminal-input">
              <input
                type="text"
                value={terminalInput}
                onChange={(event) => setTerminalInput(event.target.value)}
                placeholder="Type a command"
              />
              <button onClick={handleSendInput}>Send</button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Messaging</p>
            <h2>Portfolio messaging submodule</h2>
          </div>
        </div>
        <p className="muted">
          The <code>portfolio-messaging</code> git submodule is included to share message definitions and utilities for
          Docker container updates. Run <code>git submodule update --init --recursive</code> after cloning to make it
          available to your tooling.
        </p>
      </section>
    </div>
  );
}

export default App;
