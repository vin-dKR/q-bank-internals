/**
 * Build-time deploy-env gate. Runs first in `vercel.json`'s buildCommand so a missing or
 * malformed variable fails the BUILD with a full list of problems, instead of crashing the
 * serverless function at runtime one variable at a time. Exits immediately off Vercel, so
 * local `npm run build` is unaffected. Mirrors the runtime schema in `src/config/env.ts` —
 * keep the two in sync when the boundary changes.
 */
const env = process.env;

if (!env.VERCEL) process.exit(0);

const errors = [];
const missing = (name) => !env[name] || env[name].trim() === '';

// Persistence — serverless instances are frozen and recycled, so in-memory storage loses
// everything between invocations.
if (env.DB_DRIVER !== 'mongo') {
  errors.push('DB_DRIVER must be "mongo" on a deploy (the in-memory driver loses all data between invocations).');
} else if (missing('DATABASE_URL')) {
  errors.push('DATABASE_URL is required when DB_DRIVER=mongo.');
}

// CORS origin the browser must match.
if (missing('WEB_ORIGIN')) {
  errors.push('WEB_ORIGIN is required — the deployed web app URL, e.g. https://<web-project>.vercel.app');
} else {
  try {
    // A scheme-less value like "localhost:5173" still parses (as scheme "localhost:"), so
    // require an explicit http(s) protocol rather than trusting the URL constructor alone.
    const url = new URL(env.WEB_ORIGIN);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors.push(`WEB_ORIGIN is not an http(s) URL: "${env.WEB_ORIGIN}" — include the https:// scheme.`);
    } else if (url.hostname === 'localhost') {
      errors.push(`WEB_ORIGIN is "${env.WEB_ORIGIN}" (localhost) — set it to the deployed web app URL.`);
    }
  } catch {
    errors.push(`WEB_ORIGIN is not a valid URL: "${env.WEB_ORIGIN}" — include the https:// scheme.`);
  }
}

if (missing('OPENAI_API_KEY')) {
  errors.push('OPENAI_API_KEY is required — extraction, LaTeX refinement and figure detection all fail without it.');
}
if (missing('SUPABASE_SERVICE_KEY')) {
  errors.push('SUPABASE_SERVICE_KEY is required — verified image crops cannot upload without it.');
}

// Drive auth: the OAuth trio (preferred) or a service account, plus the root folder.
const oauthVars = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN'];
const oauthMissing = oauthVars.filter((n) => missing(n));
if (oauthMissing.length > 0 && oauthMissing.length < oauthVars.length) {
  errors.push(`Google OAuth is only partially configured — missing ${oauthMissing.join(', ')}.`);
}
if (oauthMissing.length === oauthVars.length && missing('GOOGLE_SERVICE_ACCOUNT_JSON')) {
  errors.push('Drive auth is missing — set the GOOGLE_OAUTH_* trio (preferred) or GOOGLE_SERVICE_ACCOUNT_JSON.');
}
if (missing('DRIVE_ROOT_FOLDER_ID')) {
  errors.push('DRIVE_ROOT_FOLDER_ID is required for Drive access.');
}
if (!missing('GOOGLE_SERVICE_ACCOUNT_JSON')) {
  try {
    JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch {
    errors.push('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — re-paste the raw service-account file, without surrounding quotes.');
  }
}

// Values that break the serverless runtime when present/wrong.
if (env.NODE_ENV && env.NODE_ENV !== 'production') {
  errors.push(`NODE_ENV is "${env.NODE_ENV}" — set it to "production" or delete it (Vercel provides it).`);
}
if (!missing('REDIS_URL')) {
  errors.push('REDIS_URL must NOT be set on Vercel — the API would only enqueue jobs and no worker exists to drain the queue, so extraction would silently never run.');
}

if (errors.length > 0) {
  console.error('\n✖ Deploy environment is misconfigured:\n');
  for (const message of errors) console.error(`  • ${message}`);
  console.error('\nFix these in Vercel → Project → Settings → Environment Variables, then redeploy.\n');
  process.exit(1);
}

console.log(`✓ deploy env OK (${oauthMissing.length === 0 ? 'Drive: OAuth' : 'Drive: service account'}, DB: mongo)`);
