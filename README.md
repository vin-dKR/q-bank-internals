# Eduents Ingest

Internal pipeline that turns a module PDF into verified, tagged questions in the Eduents bank:
**split → upload to Drive → AI-extract → verify/fix → publish**. One app, replacing the four
standalone helpers (chapter splitter, page cutter, extractor, question editor).

> **Read [`CONVENTIONS.md`](./CONVENTIONS.md) before contributing.** It is the law of this repo —
> where every file goes, how layers may call each other, and what counts as unacceptable code.

## Stack

| Concern | Choice |
|---|---|
| Structure | **Two independent apps** (`api/`, `web/`) — no workspace; each installs and deploys on its own |
| Backend | Express + Node + TypeScript (`api/`) |
| Frontend | Vite + React + TypeScript (`web/`) |
| API boundary | zod schemas in `@ingest/contracts`, **vendored into each app** (`api/contracts`, `web/contracts`) |
| Persistence | Prisma + MongoDB (prod) · in-memory adapter (dev, default) |
| Server state | TanStack Query |
| Heavy jobs | BullMQ + Redis worker (`npm run worker`) · in-process queue (dev) · synchronous in-request (serverless) |
| AI extraction | OpenAI `gpt-4o` vision (ported from the standalone PDF Extractor) |

## Layout

```
api/   Express backend — layered: routes → controller → service → repository(port) → infrastructure(impl)
  contracts/   vendored copy of @ingest/contracts (installed via file:./contracts)
  api/index.ts Vercel serverless entry (wraps the Express app)
web/   Vite/React frontend — feature-sliced: features/<name>/{api,components,hooks,types}
  contracts/   vendored copy of @ingest/contracts (installed via file:./contracts)
```

> The two apps are **not** a workspace anymore. `@ingest/contracts` is copied into each app, so a
> change to the API boundary must be made in **both** `api/contracts` and `web/contracts`.

## Run it — two servers, two terminals

```bash
# terminal 1 — API on :4000
cd api && npm install && npm run prisma:generate && npm run dev

# terminal 2 — web on :5173 (Vite proxies /api → :4000)
cd web && npm install && npm run dev
```

Per app: `npm run typecheck`, `npm run lint`, `npm run build`.

The API boots with **no external services**: `DB_DRIVER=memory` (default) means no MongoDB needed,
and Drive/OpenAI are only required by the routes that actually use them. To use MongoDB, set
`DB_DRIVER=mongo` + `DATABASE_URL`. Copy `api/.env.example` → `api/.env` (and `web/.env.example` →
`web/.env`) when you wire real services.

Deploying to Vercel: see [`DEPLOY_VERCEL.md`](./DEPLOY_VERCEL.md) — one project per app, Root
Directory `api` and `web` respectively.
