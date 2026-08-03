# Eduents Ingest

Internal pipeline that turns a module PDF into verified, tagged questions in the Eduents bank:
**split → upload to Drive → AI-extract → verify/fix → publish**. One app, replacing the four
standalone helpers (chapter splitter, page cutter, extractor, question editor).

> **Read [`CONVENTIONS.md`](./CONVENTIONS.md) before contributing.** It is the law of this repo —
> where every file goes, how layers may call each other, and what counts as unacceptable code.

## Stack

| Concern | Choice |
|---|---|
| Monorepo | npm workspaces |
| Backend | Express + Node + TypeScript (`apps/api`) |
| Frontend | Vite + React + TypeScript (`apps/web`) |
| API boundary | zod schemas in `packages/contracts` (one source of truth for both sides) |
| Persistence | Prisma + MongoDB (prod) · in-memory adapter (dev, default) |
| Server state | TanStack Query |
| Heavy jobs | BullMQ + Redis worker (`npm run worker`) · in-process queue (dev, default) |
| AI extraction | OpenAI `gpt-4o` vision in the worker (ported from the standalone PDF Extractor) |

## Layout

```
apps/
  api/   Express backend — layered: routes → controller → service → repository(port) → infrastructure(impl)
  web/   Vite/React frontend — feature-sliced: features/<name>/{api,components,hooks,types}
packages/
  contracts/   zod schemas + inferred DTO types shared by api & web
```

## Run it

```bash
npm install                 # from repo root — installs all workspaces
npm run dev                 # api on :4000, web on :5173 (Vite proxies /api → :4000)

# or individually
npm run dev:api
npm run dev:web

npm run typecheck           # all workspaces
npm run lint                # machine-enforced subset of CONVENTIONS.md
npm run build
```

The app boots with **no external services**: `DB_DRIVER=memory` (default) means no MongoDB needed,
and Drive/Gemini are only required by the routes that actually use them. To use MongoDB, set
`DB_DRIVER=mongo` + `DATABASE_URL` and run `npm run prisma:generate` in `apps/api`.

Copy `.env.example` → `apps/api/.env` when you wire real services.
# q-bank-internals
