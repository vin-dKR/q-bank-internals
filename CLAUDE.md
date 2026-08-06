# CLAUDE.md

Guidance for Claude Code / any AI assistant working in this repo.

## Before you touch anything

**Read [`CONVENTIONS.md`](./CONVENTIONS.md) in full.** It is the law of this repo, not a style suggestion.
Every rule about where a file goes, how layers may call each other, and what counts as unacceptable code
is defined there. Do not improvise a structure — the structure already exists and is deliberate.

## The shape in one breath

**Two independent apps — no workspace.** `api/` (Express) and `web/` (Vite/React) each install, run, and
deploy on their own. The zod-defined API boundary lives in `@ingest/contracts`, **vendored into each app**
(`api/contracts`, `web/contracts`, installed via `file:./contracts`) — the single source of truth for
request/response types, imported as `@ingest/contracts` on both sides. A boundary change must be applied
to **both** copies.

Backend is strictly layered: `routes → controller → service → repository (interface) → infrastructure (impl)`.
Services never see `req`/`res`. Nothing `new`s its own dependencies — wiring lives only in `api/src/container.ts`.

Frontend is feature-sliced: `features/<name>/{api,components,hooks,types,index.ts}`, plus `shared/` for
cross-cutting UI/lib, plus `app/` for the shell (router, providers, layout).

## Commands — run each app from its own directory (two terminals)

```bash
# API — Express on :4000
cd api && npm install && npm run prisma:generate && npm run dev

# web — Vite on :5173 (proxies /api → :4000)
cd web && npm install && npm run dev
```

Per app (run inside `api/` or `web/`): `npm run typecheck`, `npm run lint`, `npm run build`.
Deploy: one Vercel project per app (Root Directory `api` / `web`) — see `DEPLOY_VERCEL.md`.

## The non-negotiables (full list in CONVENTIONS.md)

- One concept, one place, predictable from its name.
- No `any`. No empty `catch`. No `console.log`. No `util.ts` junk drawers.
- API shapes are defined once in `@ingest/contracts` and consumed by both sides — never re-typed by hand.
- Copy-paste twice → extract. One http client, one logger, one error type.
- Every change satisfies the Definition of Done (§10) before it lands.
