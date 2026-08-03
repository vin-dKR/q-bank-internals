/**
 * One-time helper to obtain a Google Drive OAuth2 refresh token for the ingest API.
 *
 * Prerequisites (once, in Google Cloud Console → APIs & Services → Credentials):
 *   1. Enable the "Google Drive API" for your project.
 *   2. Create an OAuth client ID of type "Desktop app" (loopback redirects are allowed
 *      automatically). Note its Client ID and Client secret.
 *   3. On the OAuth consent screen, add your Google account as a Test user (if the app is in
 *      "Testing"), so the refresh token does not expire in 7 days — or publish the app.
 *
 * Run (from the repo root):
 *   node apps/api/scripts/get-drive-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>
 *   # or put GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in apps/api/.env and:
 *   node --env-file=apps/api/.env apps/api/scripts/get-drive-refresh-token.mjs
 *
 * Then paste the printed GOOGLE_OAUTH_* lines into apps/api/.env and restart the API.
 */
import http from 'node:http';
import { google } from 'googleapis';

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.argv[2];
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.argv[3];

if (!clientId || !clientSecret) {
  console.error(
    'Missing client id/secret.\n' +
      'Usage: node apps/api/scripts/get-drive-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>\n' +
      '   or: set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in the environment.',
  );
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://localhost:${PORT}`;
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', redirectUri);
  const code = url.searchParams.get('code');
  if (!code) {
    res.statusCode = 400;
    res.end('No authorization code in the request.');
    return;
  }
  oauth2
    .getToken(code)
    .then(({ tokens }) => {
      res.end('Success! You can close this tab and return to the terminal.');
      if (!tokens.refresh_token) {
        console.error(
          '\nNo refresh token returned. Revoke prior access at ' +
            'https://myaccount.google.com/permissions and run this again.',
        );
      } else {
        console.log('\n=== Add these to apps/api/.env ===\n');
        console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`);
        console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`);
        console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log('\nKeep DRIVE_ROOT_FOLDER_ID set. Then restart the API.\n');
      }
    })
    .catch((err) => {
      res.statusCode = 500;
      res.end(`Error exchanging code: ${err.message}`);
      console.error(err);
    })
    .finally(() => {
      server.close();
      setTimeout(() => process.exit(0), 100);
    });
});

server.listen(PORT, () => {
  console.log('\n1) Open this URL in your browser and authorize access:\n');
  console.log(authUrl);
  console.log(`\n2) Waiting for Google to redirect to ${redirectUri} …\n`);
});
