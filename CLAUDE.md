# CLAUDE.md

Guidance for Claude Code / any AI assistant working in this repo.

## Before you touch anything

**Read [`CONVENTIONS.md`](./CONVENTIONS.md) in full.** It is the law of this repo, not a style suggestion.
Every rule about where a file goes, how layers may call each other, and what counts as unacceptable code
is defined there. Do not improvise a structure — the structure already exists and is deliberate.

## The shape in one breath

npm-workspaces monorepo. `apps/api` (Express) and `apps/web` (Vite/React) both depend on
`packages/contracts` (zod-defined API boundary — the single source of truth for request/response types).
Dependencies flow `apps → packages`, one direction, always.

Backend is strictly layered: `routes → controller → service → repository (interface) → infrastructure (impl)`.
Services never see `req`/`res`. Nothing `new`s its own dependencies — wiring lives only in `apps/api/src/container.ts`.

Frontend is feature-sliced: `features/<name>/{api,components,hooks,types,index.ts}`, plus `shared/` for
cross-cutting UI/lib, plus `app/` for the shell (router, providers, layout).

## Commands

```bash
npm install            # from repo root — installs all workspaces
npm run dev            # api + web together
npm run dev:api        # Express on :4000
npm run dev:web        # Vite on :5173
npm run typecheck      # all workspaces
npm run lint           # machine-enforced subset of CONVENTIONS.md
npm run build          # all workspaces
```

## The non-negotiables (full list in CONVENTIONS.md)

- One concept, one place, predictable from its name.
- No `any`. No empty `catch`. No `console.log`. No `util.ts` junk drawers.
- API shapes are defined once in `@ingest/contracts` and consumed by both sides — never re-typed by hand.
- Copy-paste twice → extract. One http client, one logger, one error type.
- Every change satisfies the Definition of Done (§10) before it lands.
