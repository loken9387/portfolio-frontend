import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? '';

interface PortMapping {
  containerPort: number;
  hostPort?: number;
  protocol?: string;
}

interface EnvVar {
  name: string;
  value?: string;
  secret?: boolean;
}

interface VolumeMount {
  hostPathOrVolume: string;
  containerPath: string;
  mode?: string;
}

interface DockerServiceConfig {
  id?: number;
  name: string;
  containerName: string;
  description?: string;
  image: string;
  command?: string;
  entrypoint?: string;
  restartPolicy?: string;
  networkMode?: string;
  networkName?: string;
  ports?: PortMapping[];
  envVars?: EnvVar[];
  volumes?: VolumeMount[];
}

interface DockerContainerStatus {
  configId?: number;
  configName?: string;
  containerId?: string;
  containerName?: string;
  status?: string;
  running?: boolean;
  expectedRunning?: boolean;
  pid1Running?: boolean;
  attentionNeeded?: boolean;
}

interface DockerStatusEvent {
  statuses: DockerContainerStatus[];
  generatedAtEpochMs: number;
}

interface TerminalSessionDescriptor {
  containerId: string;
  cmd?: string | null;
  websocketPath: string;
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

function MetaRow({ label, value }: { label: string; value?: string | number | boolean | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{String(value)}</dd>
    </div>
  );
}

function DockerStatusCard({ status }: { status: DockerContainerStatus }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">{status.containerName || status.configName || status.containerId || 'Container'}</div>
        {status.status && <Badge label={String(status.status)} />}
      </div>
      <dl className="meta-grid">
        <MetaRow label="Container ID" value={status.containerId} />
        <MetaRow label="Config ID" value={status.configId} />
        <MetaRow label="Config name" value={status.configName} />
        <MetaRow label="Container name" value={status.containerName} />
        <MetaRow label="Running" value={status.running} />
        <MetaRow label="Expected running" value={status.expectedRunning} />
        <MetaRow label="PID1 running" value={status.pid1Running} />
        <MetaRow label="Attention needed" value={status.attentionNeeded} />
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
  const [configs, setConfigs] = useState<DockerServiceConfig[]>([]);
  const [configForm, setConfigForm] = useState<{
    name: string;
    containerName: string;
    description: string;
    image: string;
    command: string;
    entrypoint: string;
    restartPolicy: string;
    networkMode: string;
    networkName: string;
    portsText: string;
    envVarsText: string;
    volumesText: string;
  }>({
    name: '',
    containerName: '',
    description: '',
    image: '',
    command: '',
    entrypoint: '',
    restartPolicy: 'always',
    networkMode: 'bridge',
    networkName: '',
    portsText: '[{"containerPort":80,"hostPort":8080,"protocol":"tcp"}]',
    envVarsText: '[{"name":"APP_ENV","value":"prod","secret":false}]',
    volumesText: '[{"hostPathOrVolume":"/data","containerPath":"/var/www","mode":"rw"}]',
  });
  const [forceRemove, setForceRemove] = useState(false);
  const [containerId, setContainerId] = useState('');
  const [command, setCommand] = useState('');
  const [statuses, setStatuses] = useState<DockerContainerStatus[]>([]);
  const [broadcastResult, setBroadcastResult] = useState<DockerStatusEvent | null>(null);
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

  const parseJsonArray = <T,>(label: string, text: string): T[] | undefined => {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed as T[];
      throw new Error(`${label} must be an array.`);
    } catch (error) {
      console.error(error);
      throw new Error(`${label} JSON is invalid.`);
    }
  };

  const handleFetchConfigs = async () => {
    try {
      setFeedback('Loading Docker service configurations...');
      const response = await fetch(buildApiUrl('/api/docker/configs'));
      if (!response.ok) throw new Error(await response.text());
      const payload: DockerServiceConfig[] = await response.json();
      setConfigs(payload);
      setFeedback(`Loaded ${payload.length} configuration(s).`);
    } catch (error) {
      console.error(error);
      setFeedback('Unable to fetch Docker configurations.');
    }
  };

  const handleLoadConfigById = async () => {
    if (!configId) {
      setFeedback('Provide a config ID before loading details.');
      return;
    }
    try {
      setFeedback('Loading configuration details...');
      const response = await fetch(buildApiUrl(`/api/docker/configs/${configId}`));
      if (!response.ok) throw new Error(await response.text());
      const payload: DockerServiceConfig = await response.json();
      setConfigForm({
        name: payload.name ?? '',
        containerName: payload.containerName ?? '',
        description: payload.description ?? '',
        image: payload.image ?? '',
        command: payload.command ?? '',
        entrypoint: payload.entrypoint ?? '',
        restartPolicy: payload.restartPolicy ?? '',
        networkMode: payload.networkMode ?? '',
        networkName: payload.networkName ?? '',
        portsText: payload.ports?.length ? JSON.stringify(payload.ports, null, 2) : '',
        envVarsText: payload.envVars?.length ? JSON.stringify(payload.envVars, null, 2) : '',
        volumesText: payload.volumes?.length ? JSON.stringify(payload.volumes, null, 2) : '',
      });
      setFeedback('Configuration loaded. You can edit and re-submit.');
    } catch (error) {
      console.error(error);
      setFeedback('Unable to load configuration.');
    }
  };

  const handleCreateConfig = async () => {
    try {
      const body: DockerServiceConfig = {
        name: configForm.name,
        containerName: configForm.containerName,
        description: configForm.description || undefined,
        image: configForm.image,
        command: configForm.command || undefined,
        entrypoint: configForm.entrypoint || undefined,
        restartPolicy: configForm.restartPolicy || undefined,
        networkMode: configForm.networkMode || undefined,
        networkName: configForm.networkName || undefined,
        ports: parseJsonArray<PortMapping>('Ports', configForm.portsText),
        envVars: parseJsonArray<EnvVar>('Env vars', configForm.envVarsText),
        volumes: parseJsonArray<VolumeMount>('Volumes', configForm.volumesText),
      };

      setFeedback('Creating Docker service configuration...');
      const response = await fetch(buildApiUrl('/api/docker/configs'), {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      const payload: DockerServiceConfig = await response.json();
      setFeedback(`Configuration ${payload.id ?? ''} created.`);
      setConfigId(payload.id?.toString() ?? '');
      handleFetchConfigs();
    } catch (error) {
      console.error(error);
      setFeedback('Failed to create Docker service configuration.');
    }
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
      const payload: DockerStatusEvent = await response.json();
      setBroadcastResult(payload);
      setStatuses(payload.statuses ?? []);
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
          <h1>Portfolio Docker control plane</h1>
          <p className="lede">
            Connect to the Portfolio API described in the ICD to manage Docker service configurations, launch
            containers, broadcast status updates, and attach to in-container terminals over WebSockets.
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
            <h2>Service configurations</h2>
          </div>
          <div className="button-row">
            <button onClick={handleFetchConfigs}>List configs</button>
            <button onClick={handleLoadConfigById} className="secondary">
              Load by ID
            </button>
          </div>
        </div>

        <p className="muted">
          Fields map directly to the <code>DockerServiceConfig</code> object defined in the ICD. Use JSON arrays for
          ports, environment variables, and volume mounts to preserve the expected shapes.
        </p>

        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={configForm.name}
              onChange={(event) => setConfigForm({ ...configForm, name: event.target.value })}
              placeholder="nginx"
            />
          </label>
          <label className="field">
            <span>Container name</span>
            <input
              type="text"
              value={configForm.containerName}
              onChange={(event) => setConfigForm({ ...configForm, containerName: event.target.value })}
              placeholder="nginx"
            />
          </label>
          <label className="field">
            <span>Description</span>
            <input
              type="text"
              value={configForm.description}
              onChange={(event) => setConfigForm({ ...configForm, description: event.target.value })}
              placeholder="Reverse proxy"
            />
          </label>
          <label className="field">
            <span>Image</span>
            <input
              type="text"
              value={configForm.image}
              onChange={(event) => setConfigForm({ ...configForm, image: event.target.value })}
              placeholder="nginx:latest"
            />
          </label>
          <label className="field">
            <span>Command override</span>
            <input
              type="text"
              value={configForm.command}
              onChange={(event) => setConfigForm({ ...configForm, command: event.target.value })}
              placeholder={'bash -lc "echo hi"'}
            />
          </label>
          <label className="field">
            <span>Entrypoint override</span>
            <input
              type="text"
              value={configForm.entrypoint}
              onChange={(event) => setConfigForm({ ...configForm, entrypoint: event.target.value })}
              placeholder="/docker-entrypoint.sh"
            />
          </label>
          <label className="field">
            <span>Restart policy</span>
            <input
              type="text"
              value={configForm.restartPolicy}
              onChange={(event) => setConfigForm({ ...configForm, restartPolicy: event.target.value })}
              placeholder="always"
            />
          </label>
          <label className="field">
            <span>Network mode</span>
            <input
              type="text"
              value={configForm.networkMode}
              onChange={(event) => setConfigForm({ ...configForm, networkMode: event.target.value })}
              placeholder="bridge"
            />
          </label>
          <label className="field">
            <span>Network name</span>
            <input
              type="text"
              value={configForm.networkName}
              onChange={(event) => setConfigForm({ ...configForm, networkName: event.target.value })}
              placeholder="custom overlay"
            />
          </label>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Ports JSON array</span>
            <textarea
              value={configForm.portsText}
              onChange={(event) => setConfigForm({ ...configForm, portsText: event.target.value })}
              rows={4}
            />
          </label>
          <label className="field">
            <span>Env vars JSON array</span>
            <textarea
              value={configForm.envVarsText}
              onChange={(event) => setConfigForm({ ...configForm, envVarsText: event.target.value })}
              rows={4}
            />
          </label>
          <label className="field">
            <span>Volumes JSON array</span>
            <textarea
              value={configForm.volumesText}
              onChange={(event) => setConfigForm({ ...configForm, volumesText: event.target.value })}
              rows={4}
            />
          </label>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Config ID (for lookups)</span>
            <input
              type="number"
              value={configId}
              onChange={(event) => setConfigId(event.target.value)}
              placeholder="e.g. 42"
            />
          </label>
          <div className="button-row">
            <button onClick={handleCreateConfig}>Create configuration</button>
            <button
              onClick={() => {
                setConfigForm({
                  name: '',
                  containerName: '',
                  description: '',
                  image: '',
                  command: '',
                  entrypoint: '',
                  restartPolicy: 'always',
                  networkMode: 'bridge',
                  networkName: '',
                  portsText: '',
                  envVarsText: '',
                  volumesText: '',
                });
                setFeedback('Cleared form.');
              }}
              className="secondary"
            >
              Clear form
            </button>
          </div>
        </div>

        {configs.length > 0 && (
          <div className="card-grid">
            {configs.map((config) => (
              <div key={config.id ?? config.name} className="card">
                <div className="card-header">
                  <div className="card-title">{config.name}</div>
                  {config.id !== undefined && <Badge label={`ID: ${config.id}`} />}
                </div>
                <dl className="meta-grid">
                  <MetaRow label="Container name" value={config.containerName} />
                  <MetaRow label="Image" value={config.image} />
                  <MetaRow label="Restart policy" value={config.restartPolicy} />
                  <MetaRow label="Network mode" value={config.networkMode} />
                  <MetaRow label="Network name" value={config.networkName} />
                </dl>
                <details className="details">
                  <summary>Raw config</summary>
                  <pre className="code-block">{prettyPrint(config)}</pre>
                </details>
                <div className="button-row" style={{ marginTop: '10px' }}>
                  <button onClick={() => setConfigId(config.id?.toString() ?? '')}>Use for actions</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
              placeholder="e.g. 1"
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
            <dl className="meta-grid">
              <MetaRow
                label="Generated at"
                value={new Date(broadcastResult.generatedAtEpochMs).toLocaleString()}
              />
              <MetaRow label="Statuses" value={broadcastResult.statuses.length} />
            </dl>
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
            <h2>ZeroMQ broadcast channel</h2>
          </div>
        </div>
        <p className="muted">
          The backend publishes <code>DockerStatusEvent</code> protobuf messages on the <code>docker.status</code> topic via
          ZeroMQ (<code>tcp://*:5556</code> by default). Use the broadcast button above for an on-demand publish, or subscribe
          for 5-second streaming updates while containers are running.
        </p>
      </section>
    </div>
  );
}

export default App;
