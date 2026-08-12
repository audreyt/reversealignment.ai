import { expect, test, type Page, type Route } from '@playwright/test';
import content from '../../src/data/content.json' with { type: 'json' };
import { MAX_PORTRAIT_BYTES } from '../../src/lib/portrait-limits';

const joinCopy = content.en.join;
const formCopy = joinCopy.form;
const photoCopy = formCopy.photo!;
const JOIN_URL = 'https://reversealignment.ai/join/';

type JoinCapture = {
  fields: Record<string, string>;
  portrait: { contentType: string; bytes: Buffer } | null;
};

type JoinRouteOptions = {
  captures?: JoinCapture[];
  status?: number;
  body?: Record<string, unknown>;
};

/**
 * Mock POST /en/join/api. Captures multipart fields + optional portrait blob.
 */
async function installJoinApiMock(page: Page, options: JoinRouteOptions = {}) {
  const captures = options.captures;
  const status = options.status ?? 200;
  const body = options.body ?? {
    ok: true,
    status: 'pending_review',
    message: 'Thanks — under review.',
    portraitStored: true,
  };

  await page.route('**/en/join/api**', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();

    const headers = route.request().headers();
    const contentType = headers['content-type'] || '';
    const fields: Record<string, string> = {};
    let portrait: JoinCapture['portrait'] = null;

    if (contentType.includes('multipart/form-data')) {
      const buf = route.request().postDataBuffer() ?? Buffer.alloc(0);
      const boundaryMatch = /boundary=(.+)$/i.exec(contentType);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1]!;
        const parts = splitMultipart(buf, boundary);
        for (const part of parts) {
          if (part.name === 'portrait' && part.filename) {
            portrait = {
              contentType: part.contentType || 'application/octet-stream',
              bytes: part.data,
            };
          } else if (part.name) {
            fields[part.name] = part.data.toString('utf8');
          }
        }
      }
    } else {
      // Fail loud if the client regresses to JSON.
      const raw = route.request().postData() || '';
      fields.__raw = raw;
    }

    captures?.push({ fields, portrait });

    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

type MultipartPart = {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
};

function splitMultipart(buf: Buffer, boundary: string): MultipartPart[] {
  const delim = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let start = buf.indexOf(delim);
  while (start !== -1) {
    start += delim.length;
    if (buf[start] === 45 && buf[start + 1] === 45) break; // --
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
    const next = buf.indexOf(delim, start);
    if (next === -1) break;
    let chunk = buf.subarray(start, next);
    // trim trailing CRLF
    if (chunk.length >= 2 && chunk[chunk.length - 2] === 13 && chunk[chunk.length - 1] === 10) {
      chunk = chunk.subarray(0, chunk.length - 2);
    }
    const sep = chunk.indexOf('\r\n\r\n');
    if (sep === -1) {
      start = next;
      continue;
    }
    const headerText = chunk.subarray(0, sep).toString('utf8');
    const data = chunk.subarray(sep + 4);
    const nameMatch = /name="([^"]+)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
    if (nameMatch) {
      parts.push({
        name: nameMatch[1]!,
        filename: fileMatch?.[1],
        contentType: typeMatch?.[1]?.trim(),
        data,
      });
    }
    start = next;
  }
  return parts;
}

/**
 * Build a portrait-aspect gradient JPEG in the page and feed it to the photo
 * picker — same canvas → toBlob → File → DataTransfer path as halftone-lab.
 * Returns the source JPEG byte length so tests can prove the upload differs.
 */
async function feedPortraitJpeg(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 500;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    const g = ctx.createLinearGradient(0, 0, 400, 500);
    g.addColorStop(0, '#1a1a2e');
    g.addColorStop(0.45, '#c4a574');
    g.addColorStop(1, '#f5f0e8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 400, 500);
    // Soft facial-ish oval so the halftone has structure beyond a flat wash.
    ctx.fillStyle = 'rgba(90, 60, 40, 0.55)';
    ctx.beginPath();
    ctx.ellipse(200, 220, 110, 140, 0, 0, Math.PI * 2);
    ctx.fill();

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.92
      );
    });
    const file = new File([blob], 'portrait-source.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('[data-join-photo]') as HTMLInputElement | null;
    if (!input) throw new Error('photo input missing');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return blob.size;
  });
}

/** Feed a non-image File the pipeline cannot screen. */
async function feedPlainTextFile(page: Page) {
  await page.evaluate(() => {
    const file = new File(['this is not an image'], 'notes.txt', { type: 'text/plain' });
    const input = document.querySelector('[data-join-photo]') as HTMLInputElement | null;
    if (!input) throw new Error('photo input missing');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function fillDetails(page: Page) {
  await page.locator('[data-join-input="fullName"]').fill('Ada Lovelace');
  await page.locator('[data-join-input="affiliation"]').fill('Analytical Engine');
  await page.locator('[data-join-input="sector"]').selectOption('Research');
  await page
    .locator('[data-join-input="contribution"]')
    .selectOption('Lend your name to the statement');
  await page.locator('[data-join-input="links"]').fill('https://example.com/ada');
  await page.locator('[data-join-input="statement"]').fill('Building analytical engines.');
}

async function openJoinForm(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/join/');
  await expect(page.locator('[data-join-form]')).toBeVisible();
}

function hasImageMagic(buf: Buffer): 'webp' | 'png' | null {
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'png';
  }
  return null;
}

test.describe('English Access join form', () => {
  test('shows directory-only profile controls only for endorsement intents', async ({ page }) => {
    await openJoinForm(page);

    await expect(page.locator('[data-join-input="fullName"]')).toBeVisible();
    await expect(page.locator('[data-join-input="affiliation"]')).toBeVisible();
    await expect(page.locator('[data-join-input="sector"]')).toBeVisible();
    await expect(page.locator('[data-join-input="contribution"]')).toBeVisible();
    await expect(page.locator('[data-join-input="links"]')).toBeVisible();
    await expect(page.locator('[data-join-input="statement"]')).toBeVisible();
    const contribution = page.locator('[data-join-input="contribution"]');
    const heading = page.locator('[data-join-page-heading]');
    const eyebrow = page.locator('[data-join-page-eyebrow]');
    const directoryUi = [
      page.locator('[data-avatar-preview]'),
      page.locator('[data-join-photo]'),
      page.locator('[data-photo-fine-print]'),
      page.locator('[data-privacy-fine-print]'),
    ];
    const expectDirectoryUi = async (visible: boolean) => {
      for (const element of directoryUi) {
        if (visible) await expect(element).toBeVisible();
        else await expect(element).toBeHidden();
      }
      await expect(heading).toHaveText(visible ? joinCopy.title : joinCopy.eyebrow);
      if (visible) await expect(eyebrow).toBeVisible();
      else await expect(eyebrow).toBeHidden();
    };

    await expect(page.locator('[data-directory-only]')).toHaveCount(3);
    await expectDirectoryUi(false);
    await contribution.selectOption('Stay informed as the coalition grows');
    await expectDirectoryUi(false);
    await contribution.selectOption('Lend your name to the statement');
    await expectDirectoryUi(true);
    await contribution.selectOption('All of the above');
    await expectDirectoryUi(true);
    await contribution.selectOption('Contribute expertise, writing, or research');
    await expectDirectoryUi(false);
    await expect(page.locator('[data-join-submit]')).toBeVisible();

    await expect(page.locator('[data-join-input="email"]')).toHaveCount(0);
    await expect(
      page.locator('.cf-turnstile, [data-turnstile-wrap], [data-join-code]')
    ).toHaveCount(0);
    await expect(page.locator('script[src*="challenges.cloudflare.com/turnstile"]')).toHaveCount(0);

    // Photo alert region stays mounted so async errors announce.
    await expect(page.locator('[data-photo-message]')).toBeAttached();
    await expect(page.locator('[data-photo-message]')).toBeHidden();
    await expect(page.locator('[data-photo-message]')).toHaveAttribute('role', 'alert');

    // No nested scrollbar cage on the standalone page.
    const overflow = await page.locator('.join-live').evaluate((el) => {
      const style = getComputedStyle(el);
      return { maxHeight: style.maxHeight, overflow: style.overflow, overflowY: style.overflowY };
    });
    expect(
      overflow.maxHeight === 'none' ||
        overflow.maxHeight === '0px' ||
        Number.isNaN(parseFloat(overflow.maxHeight))
    ).toBeTruthy();
    expect(['visible', 'auto', 'clip', '']).toContain(overflow.overflowY);
    expect(overflow.overflowY).not.toBe('scroll');
  });

  test('submits multipart details and optional portrait in one shot', async ({ page }) => {
    const captures: JoinCapture[] = [];
    await installJoinApiMock(page, { captures });
    await openJoinForm(page);
    await fillDetails(page);

    const sourceBytes = await feedPortraitJpeg(page);
    await expect(page.locator('[data-photo-status]')).toContainText(photoCopy.readyLabel, {
      timeout: 20_000,
    });
    await expect(page.locator('[data-photo-status]')).toContainText('320×320');
    await expect(page.locator('[data-join-form]')).toHaveAttribute('data-portrait-ready', '1');
    await expect(page.locator('[data-avatar-img]')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('[data-photo-remove]')).toBeVisible();

    await page.locator('[data-join-submit]').click();

    await expect.poll(() => captures.length, { timeout: 15_000 }).toBe(1);
    const shot = captures[0]!;
    expect(shot.fields.fullName).toBe('Ada Lovelace');
    expect(shot.fields.affiliation).toBe('Analytical Engine');
    expect(shot.fields.sector).toBe('Research');
    expect(shot.fields.links).toBe('https://example.com/ada');
    expect(shot.fields.statement).toContain('analytical');
    expect(shot.fields.email).toBeUndefined();
    expect(shot.portrait).not.toBeNull();
    expect(shot.portrait!.bytes.length).toBeGreaterThan(0);
    expect(shot.portrait!.bytes.length).toBeLessThanOrEqual(MAX_PORTRAIT_BYTES);
    expect(hasImageMagic(shot.portrait!.bytes)).not.toBeNull();
    expect(shot.portrait!.bytes.length).not.toBe(sourceBytes);
    expect(
      shot.portrait!.contentType === 'image/webp' || shot.portrait!.contentType === 'image/png'
    ).toBe(true);

    const status = page.locator('[data-form-status]');
    await expect(status).toHaveAttribute('data-kind', 'success');
    await expect(page.locator('[data-join-step="details"]')).toHaveAttribute('hidden', '');
  });

  test('keeps the join when the portrait cannot be stored', async ({ page }) => {
    const captures: JoinCapture[] = [];
    await installJoinApiMock(page, {
      captures,
      body: {
        ok: true,
        status: 'pending_review',
        message: 'Thanks — under review.',
        portraitStored: false,
      },
    });
    await openJoinForm(page);
    await fillDetails(page);

    await feedPortraitJpeg(page);
    await expect(page.locator('[data-join-form]')).toHaveAttribute('data-portrait-ready', '1', {
      timeout: 20_000,
    });

    await page.locator('[data-join-submit]').click();

    await expect.poll(() => captures.length, { timeout: 15_000 }).toBe(1);
    expect(captures[0]!.portrait).not.toBeNull();

    const status = page.locator('[data-form-status]');
    await expect(status).toHaveAttribute('data-kind', 'success');
    await expect(status).toContainText(photoCopy.storeFailed);
    await expect(page.locator('[data-join-step="details"]')).toHaveAttribute('hidden', '');
  });

  test('shows updates-only confirmation without review-queue heading', async ({ page }) => {
    const captures: JoinCapture[] = [];
    await installJoinApiMock(page, {
      captures,
      body: {
        ok: true,
        status: 'updates_only',
        message: formCopy.updatesMessage,
      },
    });
    await openJoinForm(page);
    await page.locator('[data-join-input="fullName"]').fill('Updates Only');
    await page.locator('[data-join-input="sector"]').selectOption('Research');
    await page
      .locator('[data-join-input="contribution"]')
      .selectOption('Stay informed as the coalition grows');
    await page.locator('[data-join-submit]').click();

    await expect.poll(() => captures.length, { timeout: 15_000 }).toBe(1);
    expect(captures[0]!.fields.contribution).toBe('Stay informed as the coalition grows');

    const status = page.locator('[data-form-status]');
    await expect(status).toHaveAttribute('data-kind', 'success');
    await expect(status).toContainText(formCopy.updatesTitle);
    await expect(status).toContainText(formCopy.updatesMessage);
    await expect(status).not.toContainText(formCopy.successTitle);
    await expect(status).not.toContainText('review queue');
    await expect(page.locator('[data-join-step="details"]')).toHaveAttribute('hidden', '');
  });

  test('rejects a file the pipeline cannot screen', async ({ page }) => {
    const captures: JoinCapture[] = [];
    await installJoinApiMock(page, { captures });
    await openJoinForm(page);
    await fillDetails(page);

    await feedPlainTextFile(page);

    const photoMessage = page.locator('[data-photo-message]');
    await expect(photoMessage).toBeVisible({ timeout: 10_000 });
    await expect(photoMessage).toContainText(photoCopy.errorMessage);
    await expect(page.locator('[data-join-form]')).toHaveAttribute('data-portrait-ready', '0');
    await expect(page.locator('[data-avatar-img]')).toHaveAttribute('src', /^data:image\/svg\+xml/);

    await page.locator('[data-join-submit]').click();

    await expect.poll(() => captures.length, { timeout: 15_000 }).toBe(1);
    expect(captures[0]!.portrait).toBeNull();
    await expect(page.locator('[data-form-status]')).toHaveAttribute('data-kind', 'success');
  });

  test('removes a screened portrait on request', async ({ page }) => {
    const captures: JoinCapture[] = [];
    await installJoinApiMock(page, { captures });
    await openJoinForm(page);
    await fillDetails(page);

    await feedPortraitJpeg(page);
    await expect(page.locator('[data-join-form]')).toHaveAttribute('data-portrait-ready', '1', {
      timeout: 20_000,
    });
    await expect(page.locator('[data-avatar-img]')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('[data-photo-remove]')).toBeVisible();

    await page.locator('[data-photo-remove]').click();

    await expect(page.locator('[data-join-form]')).toHaveAttribute('data-portrait-ready', '0');
    await expect(page.locator('[data-avatar-img]')).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await expect(page.locator('[data-photo-status]')).toHaveText('');
    await expect(page.locator('[data-photo-remove]')).toBeHidden();
    await expect.poll(async () => page.locator('[data-join-photo]').inputValue()).toBe('');

    await page.locator('[data-join-submit]').click();

    await expect.poll(() => captures.length, { timeout: 15_000 }).toBe(1);
    expect(captures[0]!.portrait).toBeNull();
  });

  test('drops a screened portrait when switching away from directory intent', async ({ page }) => {
    const captures: JoinCapture[] = [];
    await installJoinApiMock(page, {
      captures,
      body: {
        ok: true,
        status: 'updates_only',
        message: formCopy.updatesMessage,
      },
    });
    await openJoinForm(page);
    await fillDetails(page);
    await feedPortraitJpeg(page);
    await expect(page.locator('[data-join-form]')).toHaveAttribute('data-portrait-ready', '1', {
      timeout: 20_000,
    });

    await page
      .locator('[data-join-input="contribution"]')
      .selectOption('Stay informed as the coalition grows');

    await expect(page.locator('[data-avatar-preview]')).toBeHidden();
    await expect(page.locator('[data-photo-field]')).toBeHidden();
    await expect(page.locator('[data-privacy-fine-print]')).toBeHidden();
    await expect(page.locator('[data-join-form]')).toHaveAttribute('data-portrait-ready', '0');
    await expect.poll(async () => page.locator('[data-join-photo]').inputValue()).toBe('');

    await page.locator('[data-join-submit]').click();
    await expect.poll(() => captures.length, { timeout: 15_000 }).toBe(1);
    expect(captures[0]!.fields.contribution).toBe('Stay informed as the coalition grows');
    expect(captures[0]!.portrait).toBeNull();
  });

  test('shows field errors from the Worker without leaving the form', async ({ page }) => {
    await installJoinApiMock(page, {
      status: 400,
      body: {
        ok: false,
        error: 'invalid_input',
        fields: { fullName: 'Name is required' },
      },
    });
    await openJoinForm(page);
    await fillDetails(page);
    await page.locator('[data-join-submit]').click();

    await expect(page.locator('[data-field-error="fullName"]')).toContainText('Name is required');
    await expect(page.locator('[data-join-step="details"]')).toBeVisible();
    await expect(page.locator('[data-form-status]')).toHaveAttribute('data-kind', 'error');
  });

  test('preserves entered details when Access returns an HTML login page', async ({ page }) => {
    await page.route('**/en/join/api**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><title>Sign in · Cloudflare Access</title>',
      })
    );
    await openJoinForm(page);
    await fillDetails(page);
    await page.locator('[data-join-submit]').click();

    await expect(page.locator('[data-form-status]')).toHaveAttribute('data-kind', 'error');
    await expect(page.locator('[data-join-step="details"]')).toBeVisible();
    await expect(page.locator('[data-join-input="fullName"]')).toHaveValue('Ada Lovelace');
    await expect(page.locator('[data-join-input="statement"]')).toHaveValue(
      'Building analytical engines.'
    );
  });

  /*
   * `window.location` is [Unforgeable], so the guard cannot be exercised by
   * stubbing it. Serve the real built page under the real source hostname
   * instead and let the shipped inline script decide.
   */
  const serveJoinPageAs = async (page: Page, host: string, path: string, baseURL: string) => {
    // Playwright matches the most recently registered route first, so the broad
    // asset stub has to be installed before the document route it would shadow.
    await page.route(`https://${host}/**`, (route) => route.fulfill({ status: 204, body: '' }));
    await page.route(`https://${host}${path}`, async (route) => {
      const upstream = await page.request.get(`${baseURL}/en/join/`);
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: await upstream.text(),
      });
    });
  };

  const stubCanonicalJoin = (page: Page) =>
    page.route(`${JOIN_URL}**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><title>protected</title>',
      })
    );

  test('bounces direct source-host visits to the protected join URL', async ({ page, baseURL }) => {
    await serveJoinPageAs(page, 'reversealignment-ai.pages.dev', '/en/join/', baseURL!);
    await stubCanonicalJoin(page);

    await page.goto('https://reversealignment-ai.pages.dev/en/join/');
    await page.waitForURL(JOIN_URL);
    expect(page.url()).toBe(JOIN_URL);
  });

  test('bounces the zh-TW host preview copy to the canonical join URL', async ({
    page,
    baseURL,
  }) => {
    // The multi-locale build still ships /en/join/; only one join form may submit.
    await serveJoinPageAs(page, 'reversealignment.tw', '/en/join/', baseURL!);
    await stubCanonicalJoin(page);

    await page.goto('https://reversealignment.tw/en/join/');
    await page.waitForURL(JOIN_URL);
    expect(page.url()).toBe(JOIN_URL);
  });

  test('stays put on the Access-protected English apex', async ({ page, baseURL }) => {
    // Mutation guard: a bounce that fires here would loop the protected page.
    await serveJoinPageAs(page, 'reversealignment.ai', '/join/', baseURL!);

    await page.goto(JOIN_URL);
    await page.waitForTimeout(300);
    expect(page.url()).toBe(JOIN_URL);
    await expect(page.locator('[data-join-form]')).toBeAttached();
  });
});
