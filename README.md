# portfolio-frontend

A lightweight React + Vite console for orchestrating Docker containers and requesting terminal sessions from the backend APIs.

## Features

- Start Docker containers for a given configuration ID and remove them (with optional `force=true`).
- View container status snapshots and trigger broadcast events.
- Request terminal sessions and connect to the returned WebSocket for interactive commands.
- Includes the [`portfolio-messaging`](portfolio-messaging) git submodule for shared messaging contracts.

## Getting started

1. **Install dependencies** (Node 18+ recommended):

```bash
npm install
```

2. **Configure backend URLs** (optional). Create a `.env` file if your backend is not hosted at the same origin:

```
VITE_API_BASE_URL=http://localhost:8080
VITE_WS_BASE_URL=ws://localhost:8080
```

3. **Run the app locally**:

```bash
npm run dev
```

The dev server prints a local URL (e.g., `http://localhost:5173`). Open it in your browser. API calls will be sent to `VITE_API_BASE_URL` and WebSocket connections to `VITE_WS_BASE_URL`.

4. **Build and preview production assets** (optional):

```bash
npm run build
npm run preview
```

## Submodules

After cloning, pull down the messaging helpers with:

```bash
git submodule update --init --recursive
```

## Scripts

- `npm run dev` – start the Vite dev server.
- `npm run build` – type-check and build for production.
- `npm run preview` – serve the built assets locally.
