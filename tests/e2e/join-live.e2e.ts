import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import content from '../../src/data/content.json' with { type: 'json' };

/**
 * Full-stack join flow against a real Worker: browser halftone → multipart
 * POST /join/api with Access JWT → pending_review → R2 finalization → public directory.
 *
 * Opt-in: vp run test:e2e:live
 */
const LIVE = process.env.E2E_LIVE_API === '1';
const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN || 'local-admin-token-for-live-e2e';
const ACCESS_JWT = process.env.E2E_ACCESS_JWT || '';
const ACCESS_AUD = process.env.E2E_ACCESS_AUD || '';
const ACCESS_ISSUER = process.env.E2E_ACCESS_ISSUER || 'https://erc.cloudflareaccess.com';
const ACCESS_KEY_FILE = process.env.E2E_ACCESS_KEY_FILE || '';
const photoCopy = content.en.join.form.photo;

function syntheticIp(): string {
  return `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${
    Math.floor(Math.random() * 250) + 1
  }`;
}

function mintJwt(email: string): string {
  if (!ACCESS_KEY_FILE || !ACCESS_AUD) {
    if (!ACCESS_JWT) throw new Error('E2E_ACCESS_JWT or key file required');
    return ACCESS_JWT;
  }
  return execFileSync(
    process.execPath,
    [
      resolve('scripts/access-jwt-fixture.mjs'),
      'sign',
      '--aud',
      ACCESS_AUD,
      '--issuer',
      ACCESS_ISSUER,
      '--email',
      email,
      '--key-file',
      ACCESS_KEY_FILE,
    ],
    { encoding: 'utf8' }
  ).trim();
}

async function attachSourcePhoto(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 600, 800);
    gradient.addColorStop(0, '#141414');
    gradient.addColorStop(0.55, '#8d8d8d');
    gradient.addColorStop(1, '#f2f2f2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 600, 800);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(300, 300, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#101010';
    ctx.fillRect(245, 265, 32, 32);
    ctx.fillRect(330, 265, 32, 32);

    const blob = await new Promise<Blob | null>((resolveBlob) =>
      canvas.toBlob(resolveBlob, 'image/jpeg', 0.92)
    );
    if (!blob) throw new Error('source encode failed');
    const file = new File([blob], 'me.jpg', { type: 'image/jpeg' });
    const input = document.querySelector<HTMLInputElement>('[data-join-photo]')!;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return blob.size;
  });
}

test.describe('live join submit flow (Worker + D1 + R2 + Access JWT)', () => {
  test.skip(!LIVE, 'needs wrangler dev — run vp run test:e2e:live');

  test('screens a photo, posts multipart with Access JWT, then publishes the stored portrait', async ({
    page,
    request,
    context,
  }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const fullName = `Live Probe ${stamp}`;
    const email = `live-probe-${stamp}@example.com`;
    const jwt = mintJwt(email);
    await context.setExtraHTTPHeaders({
      'CF-Connecting-IP': syntheticIp(),
      'Cf-Access-Jwt-Assertion': jwt,
    });

    type Call = {
      status: number;
      body: Record<string, unknown>;
      uploadBytes: number;
      contentType: string;
    };
    const calls: Call[] = [];
    await page.route('**/join/api**', async (route) => {
      const res = await route.fetch();
      const text = await res.text();
      calls.push({
        status: res.status(),
        body: JSON.parse(text) as Record<string, unknown>,
        uploadBytes: route.request().postDataBuffer()?.byteLength ?? 0,
        contentType: route.request().headers()['content-type'] || '',
      });
      await route.fulfill({ response: res, body: text });
    });

    await page.goto('/join/');
    await expect(page.locator('[data-join-form]')).toBeVisible();

    await page.locator('[data-join-input="fullName"]').fill(fullName);
    await page.locator('[data-join-input="affiliation"]').fill('Reverse Alignment E2E');
    await page.locator('[data-join-input="sector"]').selectOption('Research');
    await page
      .locator('[data-join-input="contribution"]')
      .selectOption('Lend your name to the statement');

    const sourceBytes = await attachSourcePhoto(page);
    await expect(page.locator('[data-join-form]')).toHaveAttribute('data-portrait-ready', '1');
    await expect(page.locator('[data-photo-status]')).toContainText(photoCopy.readyLabel);
    await expect(page.locator('[data-photo-status]')).toContainText('320×320');
    await expect(page.locator('[data-photo-remove]')).toBeVisible();

    const screened = await page.evaluate(async () => {
      const img = document.querySelector<HTMLImageElement>('[data-avatar-img]')!;
      const blob = await (await fetch(img.src)).blob();
      const buf = new Uint8Array(await blob.arrayBuffer());
      return {
        src: img.src,
        bytes: buf.byteLength,
        magic: [...buf.subarray(0, 4)].map((b) => String.fromCharCode(b)).join(''),
        type: blob.type,
      };
    });
    expect(screened.src.startsWith('blob:')).toBe(true);
    expect(screened.magic).toBe('RIFF');
    expect(screened.type).toBe('image/webp');
    expect(screened.bytes).not.toBe(sourceBytes);

    await page.locator('[data-join-submit]').click();
    await expect(page.locator('[data-form-status]')).toHaveAttribute('data-kind', 'success');
    await expect.poll(() => calls.length).toBe(1);

    const joinCall = calls[0]!;
    expect(joinCall.status).toBe(200);
    expect(joinCall.contentType).toMatch(/multipart\/form-data/i);
    expect(joinCall.body).toMatchObject({
      ok: true,
      status: 'pending_review',
      portraitStored: true,
    });
    // Multipart body includes fields + portrait bytes (overhead > screened alone).
    expect(joinCall.uploadBytes).toBeGreaterThan(screened.bytes);
    const memberId = String(joinCall.body.memberId);
    expect(memberId).toMatch(/^mbr_[0-9a-f]{32}$/);

    await expect(page.locator('[data-form-status]')).not.toContainText(photoCopy.storeFailed);

    const beforePublish = await (await request.get('/api/members?limit=200')).json();
    expect(
      (beforePublish.members as Array<{ fullName: string }>).some((m) => m.fullName === fullName)
    ).toBe(false);

    const published = await request.post('/api/admin/members', {
      headers: { 'X-Admin-Token': ADMIN_TOKEN, 'Content-Type': 'application/json' },
      data: { id: memberId, action: 'publish' },
    });
    expect(published.status()).toBe(200);

    const listed = await (await request.get('/api/members?limit=200')).json();
    const row = (
      listed.members as Array<{
        fullName: string;
        avatar: string;
        imageKey: string | null;
        portraitUrl: string | null;
        source: string;
      }>
    ).find((m) => m.fullName === fullName);
    expect(row).toBeTruthy();
    expect(row!.source).toBe('community');
    expect(row!.avatar).toBe('photo');
    expect(row!.imageKey).toMatch(/^portraits\/[0-9a-f]{64}\.webp$/);
    expect(row!.portraitUrl).toBe(`/api/portrait/${row!.imageKey!.replace('portraits/', '')}`);

    const served = await request.get(row!.portraitUrl!);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/webp');
    expect(served.headers()['cache-control']).toContain('immutable');
    expect(served.headers()['x-content-type-options']).toBe('nosniff');
    expect((await served.body()).byteLength).toBe(screened.bytes);

    const missing = await request.get(`/api/portrait/${'0'.repeat(64)}.webp`);
    expect(missing.status()).toBe(404);
  });

  test('joins without a photo and keeps the monogram', async ({ page, request, context }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const fullName = `Mono Probe ${stamp}`;
    const email = `mono-probe-${stamp}@example.com`;
    await context.setExtraHTTPHeaders({
      'CF-Connecting-IP': syntheticIp(),
      'Cf-Access-Jwt-Assertion': mintJwt(email),
    });

    const posts: Array<Record<string, unknown>> = [];
    await page.route('**/join/api**', async (route) => {
      const res = await route.fetch();
      const text = await res.text();
      posts.push(JSON.parse(text) as Record<string, unknown>);
      await route.fulfill({ response: res, body: text });
    });

    await page.goto('/join/');
    await page.locator('[data-join-input="fullName"]').fill(fullName);
    await page.locator('[data-join-input="sector"]').selectOption('Media');
    await page.locator('[data-join-input="contribution"]').selectOption('All of the above');
    await expect(page.locator('[data-avatar-img]')).toHaveAttribute('src', /^data:image\/svg\+xml/);

    await page.locator('[data-join-submit]').click();
    await expect(page.locator('[data-form-status]')).toHaveAttribute('data-kind', 'success');

    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).not.toHaveProperty('portraitStored');
    expect(posts[0]).toMatchObject({ ok: true, status: 'pending_review' });

    const memberId = String(posts[0]!.memberId);
    const published = await request.post('/api/admin/members', {
      headers: { 'X-Admin-Token': ADMIN_TOKEN, 'Content-Type': 'application/json' },
      data: { id: memberId, action: 'publish' },
    });
    expect(published.status()).toBe(200);

    const listed = await (await request.get('/api/members?limit=200')).json();
    const row = (
      listed.members as Array<{ fullName: string; avatar: string; portraitUrl: string | null }>
    ).find((m) => m.fullName === fullName);
    expect(row).toMatchObject({ avatar: 'monogram', portraitUrl: null });
  });

  test('enforces Access JWT and upload contract; public APIs stay public', async ({ request }) => {
    const ip = syntheticIp();

    // Public directory needs no JWT.
    const members = await request.get('/api/members');
    expect(members.status()).toBe(200);
    expect((await members.json()).total).toBeGreaterThan(0);

    // Missing JWT
    const missing = await request.post('/join/api', {
      headers: { 'CF-Connecting-IP': ip },
      multipart: { fullName: 'No Auth', sector: 'Research' },
    });
    expect(missing.status()).toBe(401);
    expect((await missing.json()).error).toMatch(/access_/);

    // Invalid JWT
    const invalid = await request.post('/join/api', {
      headers: {
        'CF-Connecting-IP': ip,
        'Cf-Access-Jwt-Assertion': 'not.a.jwt',
      },
      multipart: { fullName: 'Bad Jwt', sector: 'Research' },
    });
    expect(invalid.status()).toBe(401);

    // Oversized portrait with valid JWT
    const email = `shape-${Date.now()}@example.com`;
    const oversized = await request.post('/join/api', {
      headers: {
        'CF-Connecting-IP': syntheticIp(),
        'Cf-Access-Jwt-Assertion': mintJwt(email),
      },
      multipart: {
        fullName: 'Too Big',
        sector: 'Research',
        portrait: {
          name: 'big.webp',
          mimeType: 'image/webp',
          buffer: Buffer.alloc(200_000, 0x41),
        },
      },
    });
    expect(oversized.status()).toBe(413);
    expect((await oversized.json()).error).toBe('payload_too_large');

    // Unsupported type
    const badType = await request.post('/join/api', {
      headers: {
        'CF-Connecting-IP': syntheticIp(),
        'Cf-Access-Jwt-Assertion': mintJwt(`shape2-${Date.now()}@example.com`),
      },
      multipart: {
        fullName: 'Not Image',
        sector: 'Research',
        portrait: {
          name: 'x.webp',
          mimeType: 'image/webp',
          buffer: Buffer.from('this is not an image'),
        },
      },
    });
    expect(badType.status()).toBe(415);
    expect((await badType.json()).error).toBe('portrait_unsupported_type');

    // Duplicate is idempotent
    const dupEmail = `dup-${Date.now()}@example.com`;
    const jwt = mintJwt(dupEmail);
    const first = await request.post('/join/api', {
      headers: { 'CF-Connecting-IP': syntheticIp(), 'Cf-Access-Jwt-Assertion': jwt },
      multipart: {
        fullName: 'Dup Probe',
        sector: 'Research',
        contribution: 'Lend your name to the statement',
        portrait: {
          name: 'p.webp',
          mimeType: 'image/webp',
          buffer: readFileSync('tests/fixtures/portrait-halftone.webp'),
        },
      },
    });
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ ok: true, status: 'pending_review', portraitStored: true });

    const second = await request.post('/join/api', {
      headers: { 'CF-Connecting-IP': syntheticIp(), 'Cf-Access-Jwt-Assertion': jwt },
      multipart: { fullName: 'Dup Probe Again', sector: 'Research' },
    });
    expect(second.status()).toBe(200);
    expect(await second.json()).toMatchObject({
      ok: true,
      status: 'already_recorded',
      memberId: firstBody.memberId,
    });
  });
});
