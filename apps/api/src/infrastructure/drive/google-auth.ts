import { resolve } from 'node:path';
import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/drive'];

/** A Drive v3 client authenticated as a service account (folders only; no upload quota). */
export function serviceAccountDrive(keyFilePath: string): drive_v3.Drive {
  const auth = new google.auth.GoogleAuth({
    keyFile: resolve(process.cwd(), keyFilePath),
    scopes: SCOPES,
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * A Drive v3 client authenticated as a real user via an OAuth2 refresh token. Uploaded files are
 * owned by that user, so their storage quota applies — this is what makes uploads work on a personal
 * Gmail account. Obtain the refresh token once with `scripts/get-drive-refresh-token.mjs`.
 */
export function oauthDrive(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): drive_v3.Drive {
  const auth = new google.auth.OAuth2(input.clientId, input.clientSecret);
  auth.setCredentials({ refresh_token: input.refreshToken });
  return google.drive({ version: 'v3', auth });
}
