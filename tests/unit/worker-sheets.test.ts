import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { writeSignupToSheet, type SheetSignup } from '../../worker/src/sheets';

const env = {
  SHEETS_CLIENT_ID: 'client-id',
  SHEETS_CLIENT_SECRET: 'client-secret',
  SHEETS_REFRESH_TOKEN: 'refresh-token',
  SHEETS_SPREADSHEET_ID: 'spreadsheet-id',
} as Env;

const signup: SheetSignup = {
  memberId: 'mbr_test',
  fullName: 'Ada Lovelace',
  affiliation: 'Analytical Engine',
  sector: 'Research',
  email: 'ada@example.test',
  contribution: 'Lend your name to the statement',
  sourceUrl: 'https://reversealignment.tw/join/',
  createdAt: '2026-08-21T02:30:45.123Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('writeSignupToSheet', () => {
  test('does nothing when the Sheets credentials are not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await writeSignupToSheet({} as Env, signup);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('appends every private signup field in the operational sheet order', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        requests.push({ url, init });
        if (url === 'https://oauth2.googleapis.com/token') {
          return Response.json({ access_token: 'access-token' });
        }
        if (url.includes('Sheet1!D2%3AD')) {
          return Response.json({ values: [['other@example.test']] });
        }
        return Response.json({ updates: { updatedRows: 1 } });
      })
    );

    await writeSignupToSheet(env, signup);

    expect(requests).toHaveLength(3);
    expect(requests[2]!.url).toContain(
      'Sheet1!A%3AG:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'
    );
    expect(JSON.parse(String(requests[2]!.init?.body))).toEqual({
      values: [
        [
          'Ada Lovelace',
          'Analytical Engine',
          'Research',
          'ada@example.test',
          'Lend your name to the statement',
          'https://reversealignment.tw/join/',
          '2026-08-21 02:30:45',
        ],
      ],
    });
  });

  test('does not append an email already present in the sheet', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      if (url === 'https://oauth2.googleapis.com/token') {
        return Response.json({ access_token: 'access-token' });
      }
      return Response.json({ values: [['ADA@EXAMPLE.TEST']] });
    });
    vi.stubGlobal('fetch', fetchMock);

    await writeSignupToSheet(env, signup);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
