# Deploying the API to Vercel (serverless)

The Express API runs on Vercel as a single serverless function. This is **API-only** — the web app
(`apps/web`) is deployed separately.

## What makes it work

- `api/index.ts` — the serverless entry. Exports the Express app (an Express app *is* a `(req,res)`
  handler). Counterpart to `apps/api/src/main.ts` (the long-running `app.listen` server used locally).
- `vercel.json` — a catch-all rewrite sends every request to the function; Express routes internally.
  Sets `maxDuration` and bundles the Prisma engine.
- Serverless mode is auto-detected (`VERCEL` is set in Vercel's runtime; `SERVERLESS=true` forces it
  locally). In this mode the composition root wires **`SynchronousJobQueue`**: extraction runs
  **inline inside the request** instead of as detached background work, because Vercel freezes the
  function the instant the response is sent and would otherwise kill the work mid-flight.

## Vercel project settings

- **Root Directory:** repo root (so npm workspaces install and `@ingest/contracts` resolves).
- **Framework Preset:** Other. Install/build commands come from `vercel.json`.
- **Environment variables** (Project → Settings → Environment Variables):
  - `DB_DRIVER=mongo` and `DATABASE_URL=...` — **required in practice.** The default in-memory store
    resets on every cold start, so nothing persists between requests on serverless.
  - `WEB_ORIGIN=https://<your-web-domain>` — CORS allow-origin for the separately-deployed frontend.
  - `OPENAI_API_KEY`, `EXTRACTION_MODEL`, `DETECTION_MODEL` — extraction/detection.
  - `SUPABASE_SERVICE_KEY` (+ `SUPABASE_URL`, `SUPABASE_BUCKET`) — image crops.
  - Drive: use **`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REFRESH_TOKEN`
    / `DRIVE_ROOT_FOLDER_ID`**. Do **not** use the service-account path — it reads a key *file* from
    disk (`google-auth.ts`), which doesn't exist on serverless.

## Known constraints (read before relying on it)

1. **`maxDuration: 300` needs a paid plan.** Hobby caps functions at **60s**; Vercel silently clamps.
   Multi-page PDF extraction runs *inline* now, so a long PDF can exceed the limit and the request
   fails. This was the accepted trade for "Vercel-only, no external worker." If extractions time out,
   the durable fix is the Redis + off-Vercel worker path (set `REDIS_URL` and run `worker.ts`
   elsewhere) — the code already supports it (BullMQ branch in `container.ts`).
2. **4.5 MB request-body limit.** Vercel serverless rejects request bodies over ~4.5 MB *at the edge*,
   before the function runs. Multer accepts PDFs up to 25 MB (`MAX_UPLOAD_BYTES`), so larger chapter
   uploads will fail on Vercel regardless of that limit. For big PDFs, upload direct-to-storage or use
   a non-serverless host for the upload endpoint.
3. **Native `canvas` binary.** `pdf-to-img` (rasterizer, used by extraction *and* page rendering)
   depends on node-`canvas`, a native module. It must install/build for Vercel's Linux runtime during
   `npm install`. If the function fails to load `canvas`, that's why — pin a `canvas` version with
   Linux prebuilds or move rasterization off-serverless.
4. **Prisma on serverless.** `binaryTargets` now includes `rhel-openssl-3.0.x` and `vercel.json`
   bundles `node_modules/.prisma/client`. Each cold start opens a new Mongo connection; under load
   consider Atlas connection limits / Prisma Accelerate.

## Local check

```bash
SERVERLESS=true npm run dev:api   # boots with the synchronous queue; logs "Queue: synchronous in-request"
```
