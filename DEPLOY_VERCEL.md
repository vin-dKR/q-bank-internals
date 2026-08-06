# Deploying to Vercel — two independent projects

`api/` and `web/` are independent apps (no workspace). Create **two Vercel projects from the same
GitHub repo**, each with its own Root Directory. Deploy the API first, then the web app.

---

## Project 1 — API (`api/`)

- **Import** the repo, set **Root Directory = `api`**, **Framework Preset = Other**.
  Install/build come from `api/vercel.json`. Because the app is self-contained (its own
  `node_modules`, `prisma` on PATH, and a vendored `contracts/`), there is no workspace ambiguity —
  this is what makes `prisma generate` work (rooting at a workspace member gave `prisma: command not
  found`).
- **Environment variables:**
  - `DB_DRIVER=mongo` + `DATABASE_URL=...` — **required in practice.** The in-memory default resets
    every cold start, so nothing persists on serverless.
  - `WEB_ORIGIN=https://<your-web-domain>` — CORS allow-origin for the web app (set after Project 2).
  - `OPENAI_API_KEY`, `EXTRACTION_MODEL`, `DETECTION_MODEL`.
  - `SUPABASE_SERVICE_KEY` (+ `SUPABASE_URL`, `SUPABASE_BUCKET`) — image crops.
  - Drive: `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REFRESH_TOKEN` /
    `DRIVE_ROOT_FOLDER_ID`. Do **not** use the service-account path — it reads a key *file* from disk,
    which doesn't exist on serverless.

### How the API function works
- `api/api/index.ts` — the serverless entry. Exports the Express app (an Express app *is* a `(req,res)`
  handler). Counterpart to `api/src/main.ts` (the long-running `app.listen` server used locally).
- `api/tsconfig.json` — the options @vercel/node compiles the function with (it reads the tsconfig at
  the app root and does not resolve `extends`, so the flags are inlined there).
- The CJS `helmet` import is resolved interop-independently in `api/src/app.ts`, so it compiles even
  though @vercel/node type-checks without `esModuleInterop` (this was the recurring `TS2349`).
- `api/vercel.json` — `buildCommand` runs `prisma generate`; a catch-all rewrite sends every request
  to the function; sets `maxDuration` and ships the Prisma engine via `includeFiles`.
- Serverless is auto-detected (`VERCEL` in Vercel's runtime; `SERVERLESS=true` forces it locally). In
  this mode the composition root wires **`SynchronousJobQueue`**: extraction runs **inline inside the
  request** instead of as detached background work, because Vercel freezes the function the instant
  the response is sent and would otherwise kill it mid-flight.

---

## Project 2 — web (`web/`)

- **Import** the same repo, set **Root Directory = `web`**, **Framework Preset = Vite**.
- **Environment variable:** `VITE_API_BASE_URL = https://<your-api>.vercel.app/api` (read at build
  time; defaults to `/api`, which only works in local dev via the Vite proxy).
- `web/vercel.json` adds the SPA fallback so client-side routes resolve on refresh.

---

## Wire them together (CORS)
After both deploy: set the API project's `WEB_ORIGIN` to the web app's URL and **redeploy the API**.
The API only accepts the browser origin named here (`app.ts` → `cors({ origin: WEB_ORIGIN })`).

---

## Known constraints (read before relying on it)

1. **`maxDuration: 300` needs a paid plan.** Hobby caps functions at **60s**; Vercel silently clamps.
   Multi-page PDF extraction runs *inline* on serverless, so a long PDF can exceed the limit. The
   durable fix is the Redis + off-Vercel worker path (set `REDIS_URL`, run `npm run worker` elsewhere)
   — the code already supports it (BullMQ branch in `container.ts`).
2. **4.5 MB request-body limit.** Vercel rejects bodies over ~4.5 MB *at the edge*. Multer accepts PDFs
   up to 25 MB (`MAX_UPLOAD_BYTES`), so larger uploads fail on Vercel regardless. For big PDFs, upload
   direct-to-storage or use a non-serverless host for that endpoint.
3. **Native `canvas` / `sharp`.** The rasterizer (`pdf-to-img` → node-`canvas`) and the detector
   (`sharp`) are native modules. They build during `npm install` on Vercel's Linux runtime. Locally,
   npm 11 gates their install scripts — the `allowScripts` block in each `package.json` approves them.
4. **Prisma on serverless.** `binaryTargets` includes `rhel-openssl-3.0.x` and `vercel.json` ships
   `node_modules/.prisma/client`. Each cold start opens a new Mongo connection; under load consider
   Atlas connection limits / Prisma Accelerate.

## Local check

```bash
# API
cd api && SERVERLESS=true npm run dev   # boots with the synchronous queue; logs "Queue: synchronous in-request"
cd api && npm run typecheck             # covers src/ AND the api/index.ts function (what @vercel/node compiles)

# web
cd web && npm run build                 # the exact Vite build Vercel runs
```
