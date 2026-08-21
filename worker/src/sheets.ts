const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEET_RANGE = 'Sheet1!A:G';

type SheetsConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  spreadsheetId: string;
};

export type SheetSignup = {
  memberId: string;
  fullName: string;
  affiliation: string;
  sector: string;
  email: string;
  contribution: string;
  sourceUrl: string;
  createdAt: string;
};

function sheetsConfig(env: Env): SheetsConfig | null {
  const clientId = env.SHEETS_CLIENT_ID?.trim();
  const clientSecret = env.SHEETS_CLIENT_SECRET?.trim();
  const refreshToken = env.SHEETS_REFRESH_TOKEN?.trim();
  const spreadsheetId = env.SHEETS_SPREADSHEET_ID?.trim();
  if (!clientId || !clientSecret || !refreshToken || !spreadsheetId) return null;
  return { clientId, clientSecret, refreshToken, spreadsheetId };
}

async function accessToken(config: SheetsConfig): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error(`google_token_${response.status}`);
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== 'object' ||
    !('access_token' in body) ||
    typeof body.access_token !== 'string'
  ) {
    throw new Error('google_token_invalid');
  }
  return body.access_token;
}

async function appendSignup(config: SheetsConfig, signup: SheetSignup): Promise<void> {
  const token = await accessToken(config);
  const range = encodeURIComponent(SHEET_RANGE);
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values`;
  const authorization = { Authorization: `Bearer ${token}` };
  const emailResponse = await fetch(`${baseUrl}/${encodeURIComponent('Sheet1!D2:D')}`, {
    headers: authorization,
  });
  if (!emailResponse.ok) throw new Error(`sheets_email_read_${emailResponse.status}`);
  const emailBody: unknown = await emailResponse.json();
  const values =
    emailBody &&
    typeof emailBody === 'object' &&
    'values' in emailBody &&
    Array.isArray(emailBody.values)
      ? emailBody.values
      : [];
  const normalizedEmail = signup.email.trim().toLowerCase();
  if (
    values.some(
      (row) =>
        Array.isArray(row) &&
        typeof row[0] === 'string' &&
        row[0].trim().toLowerCase() === normalizedEmail
    )
  ) {
    return;
  }

  const appendResponse = await fetch(
    `${baseUrl}/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: [
          [
            signup.fullName,
            signup.affiliation,
            signup.sector,
            signup.email,
            signup.contribution,
            signup.sourceUrl,
            signup.createdAt.slice(0, 19).replace('T', ' '),
          ],
        ],
      }),
    }
  );
  if (!appendResponse.ok) throw new Error(`sheets_append_${appendResponse.status}`);
}

/**
 * Best-effort mirror into Romain's operational sheet. D1 remains authoritative;
 * retries and the email lookup make a lost append response safe to repeat.
 */
export async function writeSignupToSheet(env: Env, signup: SheetSignup): Promise<void> {
  const config = sheetsConfig(env);
  if (!config) return;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await appendSignup(config, signup);
      return;
    } catch (error) {
      if (attempt < 3) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, attempt * 250);
        await promise;
        continue;
      }
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'sheet_writeback_failed',
          memberId: signup.memberId,
          error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        })
      );
    }
  }
}
