# CONVENTIONS — the law of this repo

> This file is not a suggestion. It is the contract every change (human or AI) must satisfy
> before it is allowed to land. If a change violates a rule here, the change is wrong — not the rule.
> When a rule genuinely needs to bend, you change **this file first, with reasoning**, then the code.

If you are an AI assistant working in this repo: **read this file fully before writing a single line.**
Do not "just get it working." Do not leave TODOs you invented. Do not add a second way to do a thing
that already has one way. The bar is *maintainable and correct*, not *done*.

---

## 0. The one-sentence philosophy

**One concept lives in exactly one place, and its location is predictable from its name.**

Everything below is a consequence of that sentence.

---

## 1. Repository shape

This repo holds **two independent apps** — no npm workspace. Each installs, builds, runs, and deploys
on its own, from its own directory:

```
ingest/
├── api/   Express + Node backend. Has a main(). Deploys as its own Vercel project (Root Directory: api).
│   └── contracts/   vendored copy of @ingest/contracts, installed via "file:./contracts".
└── web/   Vite + React frontend. Deploys as its own Vercel project (Root Directory: web).
    └── contracts/   vendored copy of @ingest/contracts, installed via "file:./contracts".
```

**The API boundary is `@ingest/contracts`** — zod schemas + inferred DTO types, the single source of
truth for the api ⇄ web seam. Because the apps are independent (no workspace to link a shared package,
and Vercel cannot reach a sibling directory outside a project's Root Directory), contracts is **copied
into each app**. The rule that replaces "apps → packages":

- Types crossing the api/web boundary are defined **once in `@ingest/contracts`** and imported as
  `@ingest/contracts` on both sides — never re-typed by hand in a component or a service.
- A change to the boundary must be applied to **both** `api/contracts` and `web/contracts` (they are
  copies). Keep them identical.
- The two apps **never** import from each other. Anything shared crosses only through `@ingest/contracts`.

---

## 2. Naming — no exceptions

| Thing | Rule | Example |
|---|---|---|
| Files & folders | `kebab-case` | `document-picker.tsx`, `error-catalog.ts` |
| React components (the symbol) | `PascalCase`, file matches | `DocumentPicker` in `document-picker.tsx` |
| Variables, functions | `camelCase` | `listDrivePdfs` |
| Types, interfaces, classes | `PascalCase`, **no `I` prefix** | `DocumentRepository`, not `IDocumentRepository` |
| Constants (true constants) | `SCREAMING_SNAKE_CASE` | `MAX_UPLOAD_BYTES` |
| Zod schemas | suffix `Schema` | `DocumentSchema` |
| Inferred DTO types | the noun, no suffix | `type Document = z.infer<typeof DocumentSchema>` |

**Role suffix in the filename tells you the layer.** A file's name must announce what it is:
`*.routes.ts`, `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `*.schema.ts`, `*.types.ts`, `*.client.ts`, `*.api.ts`, `*.hook.ts`.
If you can't give a file one of these roles, it probably doesn't belong where you're putting it.

---

## 3. Backend layering (`apps/api`) — sacred, one-directional

Request flows **down**; nothing calls back **up**.

```
HTTP  →  routes  →  controller  →  service  →  repository (interface)  →  infrastructure (impl)
                                      │
                                      └→ pure domain logic (no I/O)
```

| Layer | May do | May NOT do | Knows about |
|---|---|---|---|
| `*.routes.ts` | Declare paths, attach middleware + validation, point to controller | Contain logic | its controller |
| `*.controller.ts` | Translate HTTP ⇄ service call. Read `req`, shape `res`. | Business rules, DB, `try/catch` for flow control | its service, `@ingest/contracts` |
| `*.service.ts` | **All business rules.** Orchestrate repositories + infra. | Touch `req`/`res`. Know it's HTTP. Instantiate its own deps. | repository **interfaces**, other services |
| `*.repository.ts` | **Interface only** — the shape of persistence the service needs | Contain a Prisma/Mongo call | domain types |
| `infrastructure/**` | Concrete adapters: Prisma repo, Drive client, AI client, queue | Contain business rules | external SDKs |

**The service depends on the repository *interface*, never the Prisma class.** The concrete class lives in
`infrastructure/database/repositories/` and is wired in the composition root (§5). This is what lets you swap
Mongo, mock in tests, and read a service without reading a driver.

`req` and `res` exist **only** inside `*.controller.ts` and middleware. If you see `req` in a service, it is a bug.

---

## 4. Feature modules — the unit of organization

Group by **feature/domain**, never by technical type. There is no top-level `controllers/` or `services/` bucket.
Everything about one concept sits together:

```
apps/api/src/modules/documents/
├── documents.routes.ts        # path table
├── documents.controller.ts    # http adapter
├── documents.service.ts       # business rules
├── documents.repository.ts    # persistence interface (the port)
├── documents.types.ts         # domain types internal to this module
└── index.ts                   # the module's PUBLIC surface — the ONLY thing others import
```

Frontend mirrors this exactly:

```
apps/web/src/features/documents/
├── api/         # calls to the backend for this feature
├── components/  # UI owned by this feature
├── hooks/       # react hooks for this feature
├── types/       # feature-local types (shared types live in @ingest/contracts)
└── index.ts     # public surface
```

**Cross-feature imports go through the `index.ts` barrel only.** Never reach into another feature's internals
(`features/verification/components/some-internal-thing`). If two features need the same thing, it is not feature
code — promote it to `shared/` (web) or `shared/`/a package (api). Promotion, not duplication.

---

## 5. Dependency injection — manual, explicit, one place

No DI framework. Wiring happens in **one file**: `apps/api/src/container.ts` (the composition root).
It is the *only* place allowed to call `new PrismaDocumentRepository(...)`, `new DriveClient(...)`, etc.
Everything else receives its dependencies as constructor/factory arguments and asks for **interfaces**.

Rule: **if a module `new`s its own dependency, it's wrong.** Dependencies flow in; they are never reached out for.
This is the difference between "testable and swappable" and "welded together."

---

## 6. The DRY law (this repo's obsession)

1. **The API boundary is defined once**, in `packages/contracts`, as a zod schema. The backend validates with it;
   the frontend infers its types from it. There is **no** hand-written duplicate of a request/response shape.
2. **Two literals that must stay equal = one constant.** A magic string used twice is a bug waiting to desync.
3. **Copy-paste is a design signal, not a shortcut.** The second time you write something, extract it. The third time
   you're already too late. Shared helpers live in `shared/utils` (api) / `shared/lib` (web) or a package.
4. **One way to do a thing.** One http client, one logger, one error type, one date formatter. If you need a second,
   you first delete the first. Parallel implementations of the same concern are forbidden.
5. **Config is read once** (`config/env.ts`), validated once, and imported typed. `process.env` appears in exactly
   one file in each app. Nowhere else.

---

## 7. Errors — structured, never swallowed

- One error type: `AppError` (`shared/errors/app-error.ts`), carrying a `code`, HTTP `status`, and safe `message`.
- Error codes live in **one catalog** (`shared/errors/error-catalog.ts`). Controllers/services throw catalog errors;
  they never build ad-hoc status codes.
- There is **one** error-handling middleware, mounted last. Controllers do **not** `try/catch` to turn errors into
  responses — they let `AppError` propagate. Async handlers are wrapped with `asyncHandler` so rejections reach it.
- **Never** `catch (e) {}`. Never `catch` only to `console.log` and continue. Either handle it meaningfully or let it rise.

---

## 8. TypeScript — strict, honest types

- `strict: true` is on and stays on. `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes` on.
- **`any` is banned.** If you don't know the type, it's `unknown` and you narrow it. `as` casts are a smell — justify
  each in a comment or delete it. `@ts-ignore`/`@ts-expect-error` require a one-line reason.
- **No non-null `!`** to silence the compiler — prove the value exists or handle its absence.
- Prefer `type` for data shapes; `interface` only for extendable contracts (like a repository port).
- Every exported function has an explicit return type. No inferred public APIs.

---

## 9. What "no AI-slop code" means here — the ban list

These get a change rejected on sight:

- ❌ Dead code, commented-out blocks, `console.log` left in. Debug with the logger; delete before committing.
- ❌ Invented TODO/FIXME that punts the actual task. If it's the task, do it. If it's genuinely later, it goes in the
  issue tracker with a link, not a naked `// TODO: handle this`.
- ❌ Comments that restate the code (`// increment i`). Comments explain **why**, never **what**.
- ❌ A function doing three things. One function, one responsibility, one reason to change. If you need "and" to
   describe it, split it.
- ❌ Defensive junk: `if (data && data.items && data.items.length > 0)` when the type already guarantees the shape.
   Trust your types; validate only at the boundary (zod).
- ❌ `util.ts` / `helpers.ts` / `misc/` junk drawers. Every helper has a named home by what it does
   (`format-latex.ts`, `paginate.ts`), never a dumping ground.
- ❌ Reformatting or "drive-by refactoring" unrelated lines in a change. Keep diffs about one thing.
- ❌ Fixing a symptom in the wrong layer (patching the controller because the service is wrong). Fix the cause.

---

## 10. Definition of Done (a change may land only if ALL are true)

1. It obeys §1–§9. New files are in the folder their role dictates, named by the naming table.
2. No duplication introduced; if the change made something appear twice, it was extracted.
3. `npm run typecheck`, `npm run lint`, `npm run build` all pass at the root.
4. The API boundary (if touched) changed in `packages/contracts` first, and both sides consume it.
5. The diff is minimal and single-purpose. Nothing unrelated moved.
6. You can explain, in one sentence, why every new file lives exactly where it lives.

---

## 11. When you're unsure where something goes

Ask these in order and stop at the first yes:

1. Is it shared across `web` and `api`? → `packages/contracts` (or a new package).
2. Is it business logic for one feature? → that feature's `modules/<feature>` (api) / `features/<feature>` (web).
3. Is it a cross-cutting mechanism (logging, errors, http)? → `shared/`.
4. Is it an adapter to an external system (Drive, AI, DB)? → `apps/api/src/infrastructure/`.
5. Still unsure? → it's probably two things. Split it and re-ask for each half.
