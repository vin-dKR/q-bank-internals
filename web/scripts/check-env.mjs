/**
 * Build-time deploy-env gate. Vite inlines VITE_* variables at build time, so a missing value
 * cannot be fixed after the fact — fail the BUILD with a clear message instead of shipping a
 * bundle that calls /api on its own domain (where the SPA rewrite answers every API call with
 * index.html). Exits immediately off Vercel, so local `npm run build` is unaffected.
 */
const env = process.env;

if (!env.VERCEL) process.exit(0);

const errors = [];

if (!env.VITE_API_BASE_URL || env.VITE_API_BASE_URL.trim() === '') {
  errors.push('VITE_API_BASE_URL is required — the deployed API URL, e.g. https://<api-project>.vercel.app/api');
} else {
  try {
    // A scheme-less value like "localhost:4000" still parses (as scheme "localhost:"), so
    // require an explicit http(s) protocol rather than trusting the URL constructor alone.
    const url = new URL(env.VITE_API_BASE_URL);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors.push(`VITE_API_BASE_URL is not an http(s) URL: "${env.VITE_API_BASE_URL}" — include the https:// scheme.`);
    } else if (url.hostname === 'localhost') {
      errors.push(`VITE_API_BASE_URL is "${env.VITE_API_BASE_URL}" (localhost) — set it to the deployed API URL.`);
    }
  } catch {
    errors.push(`VITE_API_BASE_URL is not a valid URL: "${env.VITE_API_BASE_URL}" — include the https:// scheme.`);
  }
}

if (errors.length > 0) {
  console.error('\n✖ Deploy environment is misconfigured:\n');
  for (const message of errors) console.error(`  • ${message}`);
  console.error('\nFix these in Vercel → Project → Settings → Environment Variables, then redeploy.\n');
  process.exit(1);
}

console.log('✓ deploy env OK');
