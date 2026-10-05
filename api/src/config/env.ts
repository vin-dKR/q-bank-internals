import 'dotenv/config';
import { z } from 'zod';

/**
 * The ONLY place in the backend that reads `process.env` (§6.5).
 * Everything else imports the typed, validated `env` object below.
 * A missing/invalid variable crashes the process at boot — never silently at 3am.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),

  // Which persistence adapter the composition root wires. `memory` needs no external services,
  // so the app boots for local dev; `mongo` uses Prisma and requires DATABASE_URL.
  DB_DRIVER: z.enum(['memory', 'mongo']).default('memory'),
  DATABASE_URL: z.string().optional(),

  // External services are optional so dev can boot; their clients throw a clear error if a route
  // that needs them is actually called without configuration.
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  DRIVE_ROOT_FOLDER_ID: z.string().optional(),

  // OAuth2 "act as a real user" credentials. Preferred for personal Gmail accounts: uploaded files
  // are owned by the user (who has storage quota), unlike a service account (which has none).
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  // Vision model + key for the extraction worker (ported from the Python PDF Extractor); also drives
  // the Verify "read the page again" re-extractor. gpt-5.4-mini rather than the older gpt-4o: the same
  // upgrade already paid off on both sibling AI paths in this file — gpt-4o produced loose boxes in the
  // detector and wrapped units inconsistently in the LaTeX refiner. It is a reasoning model, so this
  // budget covers hidden reasoning before the JSON; the extractor retries at double and then fails
  // loudly rather than persisting a silently truncated page. Override to trade quality for cost.
  OPENAI_API_KEY: z.string().optional(),
  // Local-only override when an OS-level OPENAI_API_KEY would otherwise take precedence over .env.
  OPENAI_API_KEY_2: z.string().optional(),
  EXTRACTION_MODEL: z.string().default('gpt-5.4'),
  STRUCTURE_OCR_MIN_CONFIDENCE: z.coerce.number().min(0).max(100).default(70),
  STRUCTURE_OCR_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  // Age after which a document still `queued`/`extracting` is treated as orphaned and auto-reset to
  // `failed` on the next read. Each completed page touches the document timestamp, so this is a
  // heartbeat threshold rather than a whole-PDF timeout.
  STALE_EXTRACTION_MS: z.coerce.number().int().positive().default(600000),
  // Consecutive pages rendered/read in one queue callback. Each page is still checkpointed before
  // the next, so a failure resumes at the first missing page. Four avoids re-downloading a large
  // Drive PDF once per page while staying comfortably below Vercel's function limit; set to 1 for
  // exceptionally dense/scanned material.
  EXTRACTION_PAGES_PER_TASK: z.coerce.number().int().min(1).max(10).default(4),
  // Text model for the interactive "Fix LaTeX with AI" per-field refiner. gpt-4o-mini mangled backslash
  // commands (it emitted `\text` unescaped in JSON, so `\t` parsed to a TAB — `6 \text{m}` came back
  // `6 <TAB>ext{m}`). gpt-5.4-mini escapes reliably AND, with the units-as-\text prompt, wraps physical
  // quantities correctly (`-3 m/sec` -> `\(-3\ \text{m/sec}\)`); gpt-4o wrapped inconsistently. Override
  // to trade cost for quality.
  LATEX_MODEL: z.string().default('gpt-5.4'),
  // Vision model for the Verify auto-crop figure detector (bounding-box localisation, not OCR). Uses a
  // strong spatial model — gpt-4o gives loose, mis-placed boxes here; gpt-5.4 (the model the upstream
  // image-auto-cropper uses) produces tight boxes. Override only if you have a better spatial model.
  DETECTION_MODEL: z.string().default('gpt-5.4'),
  // Output-token budget per detection call. gpt-5.4 is a reasoning model, so this cap covers hidden
  // reasoning AND the JSON reply; a dense page (many questions + a box per option-picture) needs a big
  // reply, and too small a cap truncates the JSON — which used to surface as a silent "no figures" and
  // is why detection worked on sparse page 1 but not on denser later pages. Generous by default; the
  // detector retries at double once before failing loudly. Raise if very dense pages still truncate.
  DETECTION_MAX_TOKENS: z.coerce.number().int().positive().default(16000),

  // BullMQ (Redis) connection for the extraction queue. Absent → in-process queue (dev, no Redis).
  REDIS_URL: z.string().optional(),

  // Serverless mode (Vercel). Production uses Vercel Queue's private consumer for background page
  // tasks. `VERCEL` is set automatically in Vercel's runtime; `SERVERLESS=true` forces that adapter
  // locally for integration testing.
  VERCEL: z.string().optional(),
  SERVERLESS: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),

  // Supabase storage for verified question/option image crops (same bucket the main bank reads).
  SUPABASE_URL: z.string().default('https://jrekcngltfkghrgzgvju.supabase.co'),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  SUPABASE_BUCKET: z.string().default('images'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = {
  ...parsed.data,
  OPENAI_API_KEY:
    parsed.data.NODE_ENV === 'production' || parsed.data.VERCEL
      ? parsed.data.OPENAI_API_KEY
      : parsed.data.OPENAI_API_KEY_2 || parsed.data.OPENAI_API_KEY,
};
export type Env = typeof env;

/**
 * True when running on a serverless platform (Vercel sets `VERCEL`) or when forced via `SERVERLESS`.
 * In this mode the composition root wires Vercel Queue and skips cold-start stale-job recovery,
 * which would otherwise race concurrent queue invocations.
 */
export const isServerless = Boolean(env.VERCEL) || env.SERVERLESS;
