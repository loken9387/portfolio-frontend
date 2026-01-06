# portfolio-frontend

A lightweight React + Vite console for orchestrating Docker containers and requesting terminal sessions from the backend APIs.

## Features

- Start Docker containers for a given configuration ID and remove them (with optional `force=true`).
- View container status snapshots and trigger broadcast events.
- Request terminal sessions and connect to the returned WebSocket for interactive commands.
- Includes the [`portfolio-messaging`](portfolio-messaging) git submodule for shared messaging contracts.

## Getting started

```bash
npm install
npm run dev
```

By default API requests are made relative to the hosting origin. To point at a specific backend, create a `.env` file and set:

```
VITE_API_BASE_URL=http://localhost:8080
VITE_WS_BASE_URL=ws://localhost:8080
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
