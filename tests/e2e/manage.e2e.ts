import { expect, test, type Page, type Route } from '@playwright/test';
import content from '../../src/data/content.json' with { type: 'json' };

const manageCopy = content.en.join.manage;
// Relative to the served `dist`, matching how join-form.e2e.ts opens its page.
// The zh-TW build's `/en/` tree is the copy under test, which is exactly where a
// root-absolute API URL would break.
const MANAGE_URL = '/en/join/manage/';
const ME_ROUTE = '**/en/join/api/me**';

const MEMBER = {
  id: 'mbr_e2e_probe',
  fullName: 'Ada Lovelace',
  affiliation: 'Analytical Engine',
  role: 'Analytical Engine',
  sector: 'Research',
  contribution: 'Lend your name to the statement',
  links: '',
  statement: '',
  status: 'pending_review',
  source: 'community',
  email: 'ada@example.com',
  imageKey: null,
  portraitUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  publishedAt: null,
} as const;

type Capture = { method: string; body: string };

/**
 * Mock `/join/api/me`. The route pattern deliberately matches the page-relative
 * URL the client must produce; a regression to an absolute origin would miss it
 * and the assertions would fail rather than silently pass.
 */
async function installMeMock(
  page: Page,
  options: {
    captures?: Capture[];
    getStatus?: number;
    writeStatus?: number;
    writeBody?: Record<string, unknown>;
    html?: boolean;
  } = {}
) {
  await page.route(ME_ROUTE, async (route: Route) => {
    const method = route.request().method();

    if (options.html) {
      // What Cloudflare Access actually returns once the session expires.
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><title>Sign in ・ Cloudflare Access</title></html>',
      });
    }

    if (method === 'GET') {
      const status = options.getStatus ?? 200;
      return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(
          status === 200 ? { ok: true, member: MEMBER } : { error: 'not_found' }
        ),
      });
    }

    options.captures?.push({ method, body: route.request().postData() || '' });
    const status = options.writeStatus ?? 200;
    const body =
      options.writeBody ??
      (method === 'DELETE'
        ? { ok: true, deleted: true, portraitDeleted: false }
        : { ok: true, member: { ...MEMBER, fullName: 'Ada B. Lovelace' } });
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

test.describe('Access-gated entry manager', () => {
  test('loads the caller entry and shows what is stored', async ({ page }) => {
    await installMeMock(page);
    await page.goto(MANAGE_URL);

    await expect(page.locator('[data-manage-editor]')).toBeVisible();
    await expect(page.locator('[data-manage-input="fullName"]')).toHaveValue('Ada Lovelace');
    await expect(page.locator('[data-manage-input="affiliation"]')).toHaveValue(
      'Analytical Engine'
    );
    await expect(page.locator('[data-manage-input="sector"]')).toHaveValue('Research');
    await expect(page.locator('[data-manage-status]')).toHaveText(
      manageCopy.statusLabels.pending_review
    );
    // No stored portrait still renders the monogram the directory would show.
    await expect(page.locator('[data-manage-portrait-image]')).toHaveAttribute(
      'src',
      /^data:image\/svg\+xml/
    );
    await expect(page.locator('[data-manage-portrait-remove]')).toBeHidden();
  });

  test('saves an edit through the page-relative API path', async ({ page }) => {
    const captures: Capture[] = [];
    await installMeMock(page, { captures });
    await page.goto(MANAGE_URL);
    await expect(page.locator('[data-manage-input="fullName"]')).toHaveValue('Ada Lovelace');

    await page.locator('[data-manage-input="fullName"]').fill('Ada B. Lovelace');
    await page.locator('[data-manage-save]').click();

    await expect(page.locator('[data-manage-message]')).toHaveText(manageCopy.savedMessage);
    expect(captures).toHaveLength(1);
    expect(captures[0]!.method).toBe('PATCH');
    expect(captures[0]!.body).toContain('Ada B. Lovelace');
  });

  test('never sends the request to an absolute origin', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/me')) requested.push(request.url());
    });
    await installMeMock(page);
    await page.goto(MANAGE_URL);
    await expect(page.locator('[data-manage-editor]')).toBeVisible();

    expect(requested).toHaveLength(1);
    // Served from the zh-TW host's /en/ preview tree, so the relative path must
    // resolve within it rather than jumping to the English apex.
    expect(new URL(requested[0]!).pathname).toBe('/en/join/api/me');
  });

  test('shows a calm no-entry state rather than an error', async ({ page }) => {
    await installMeMock(page, { getStatus: 404 });
    await page.goto(MANAGE_URL);

    await expect(page.locator('[data-manage-not-found]')).toBeVisible();
    await expect(page.locator('[data-manage-not-found]')).toContainText(manageCopy.notFoundMessage);
    await expect(page.locator('[data-manage-editor]')).toBeHidden();
  });

  test('asks the visitor to re-authenticate when Access returns its login page', async ({
    page,
  }) => {
    await installMeMock(page, { html: true });
    await page.goto(MANAGE_URL);

    await expect(page.locator('[data-manage-message]')).toHaveText(manageCopy.reauthMessage);
    await expect(page.locator('[data-manage-editor]')).toBeHidden();
  });

  test('gates deletion behind an explicit confirmation', async ({ page }) => {
    const captures: Capture[] = [];
    await installMeMock(page, { captures });
    await page.goto(MANAGE_URL);
    await expect(page.locator('[data-manage-editor]')).toBeVisible();

    const deleteButton = page.locator('[data-manage-delete]');
    await expect(deleteButton).toBeDisabled();
    expect(captures).toHaveLength(0);

    await page.locator('[data-manage-delete-confirm]').check();
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();

    await expect(page.locator('[data-manage-message]')).toHaveText(manageCopy.deletedMessage);
    expect(captures.map((capture) => capture.method)).toEqual(['DELETE']);
  });

  test('surfaces a name collision and a rate limit distinctly', async ({ page }) => {
    await installMeMock(page, {
      writeStatus: 409,
      writeBody: { error: 'name_collision' },
    });
    await page.goto(MANAGE_URL);
    await expect(page.locator('[data-manage-input="fullName"]')).toHaveValue('Ada Lovelace');
    await page.locator('[data-manage-save]').click();
    await expect(page.locator('[data-manage-message]')).toHaveText(manageCopy.nameCollision);

    await page.unroute(ME_ROUTE);
    await installMeMock(page, {
      writeStatus: 429,
      writeBody: { error: 'rate_limited', retryAfter: 60 },
    });
    await page.locator('[data-manage-save]').click();
    await expect(page.locator('[data-manage-message]')).toHaveText(manageCopy.rateLimited);
  });

  test('is noindex and reachable only under the Access-gated join prefix', async ({ page }) => {
    await installMeMock(page);
    const response = await page.goto(MANAGE_URL);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toContain('/join/manage/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow'
    );
  });
});
