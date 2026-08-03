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
  OPENAI_API_KEY: z.string().optional(),
  EXTRACTION_MODEL: z.string().default('gemini-2.5-pro'),

  REDIS_URL: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;
