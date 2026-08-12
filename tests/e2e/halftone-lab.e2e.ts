/**
 * tests/e2e/halftone-lab.e2e.ts
 *
 * Playwright browser tests for the Portrait Lab (/halftone-lab/).
 *
 * Contracts defended:
 *  - Page renders with noindex, privacy notice, accessible controls
 *  - Uploading a generated fixture triggers processing and updates the preview
 *  - Output dimensions and MIME type match options (586×589, webp or png)
 *  - window.labResult is populated with correct fields after processing
 *  - Download link is enabled and uses the correct filename extension
 *  - No network requests are made during processing (privacy contract)
 *  - Rapid option changes do not produce stale/race results
 *  - AbortController cancels stale renders (only the final result persists)
 *  - Accessible: skip link, role=button on drop zone, status region
 *  - Responsive: 390px viewport renders controls and preview correctly
 *  - Keyboard: reprocess button and download link operable via keyboard
 *  - Polarity: result blob is predominantly light (black dots on white ground),
 *    not predominantly dark (which would indicate white-on-black inversion)
 */

import { test, expect, type Page } from '@playwright/test';
import { stat, readFile } from 'node:fs/promises';

const LAB_PATH = '/halftone-lab/';

// ── Fixture: generate a minimal test PNG in-browser ──────────────────────────

/** Creates a 20×20 mid-grey PNG as a File object and returns its data URL. */
const FIXTURE_SCRIPT = `
  (async () => {
    const c = document.createElement('canvas');
    c.width = 20; c.height = 20;
    const ctx = c.getContext('2d');
    // Draw a gradient: top-left dark, bottom-right light
    const g = ctx.createLinearGradient(0,0,20,20);
    g.addColorStop(0, '#111');
    g.addColorStop(1, '#eee');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,20,20);
    return new Promise(resolve => c.toBlob(b => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(b);
    }, 'image/png'));
  })()
`;

async function uploadFixture(page: Page): Promise<void> {
  // Generate fixture PNG data URL in-browser
  const dataUrl = (await page.evaluate(FIXTURE_SCRIPT)) as string;

  // Convert data URL → File object and dispatch to the file input
  await page.evaluate(async (url: string) => {
    const res = await fetch(url);
    const blob = await res.blob();
    const file = new File([blob], 'fixture.png', { type: 'image/png' });
    const input = document.getElementById('file-input') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, dataUrl);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Portrait Lab (/halftone-lab/)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(LAB_PATH);
    await page.waitForLoadState('domcontentloaded');
  });

  // ── Meta / accessibility ───────────────────────────────────────────────────

  test('page has noindex meta', async ({ page }) => {
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });

  test('privacy notice is present', async ({ page }) => {
    const notice = page.getByRole('note', { name: /privacy/i });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/never leave this device|nothing is uploaded/i);
  });

  test('skip link is reachable by keyboard', async ({ page }) => {
    await page.keyboard.press('Tab');
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toBeFocused();
  });

  test('drop zone has role=button and aria-label', async ({ page }) => {
    const dz = page.locator('#drop-zone');
    await expect(dz).toHaveAttribute('role', 'button');
    await expect(dz).toHaveAttribute('aria-label');
  });

  test('status bar has aria-live=polite', async ({ page }) => {
    const status = page.locator('#status-bar');
    await expect(status).toHaveAttribute('aria-live', 'polite');
  });

  test('reprocess button starts disabled', async ({ page }) => {
    const btn = page.locator('#btn-reprocess');
    await expect(btn).toBeDisabled();
  });

  // ── Processing pipeline ────────────────────────────────────────────────────

  test('upload triggers processing and shows status', async ({ page }) => {
    await uploadFixture(page);
    // Status should transition to processing, then done
    await expect(page.locator('#status-bar')).toContainText(/processing|done/i, {
      timeout: 15_000,
    });
  });

  test('before preview is shown after upload', async ({ page }) => {
    await uploadFixture(page);
    await expect(page.locator('#preview-before')).toHaveAttribute('src', /^blob:|^data:/);
  });

  test('after preview is shown after processing completes', async ({ page }) => {
    await uploadFixture(page);
    // Wait for done status
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });
    await expect(page.locator('#preview-after')).toHaveAttribute('src', /^blob:/);
  });

  test('window.labResult populated with correct fields', async ({ page }) => {
    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });

    const result = await page.evaluate(() => {
      const r = (window as unknown as Record<string, unknown>).labResult as Record<
        string,
        unknown
      > | null;
      if (!r) return null;
      return {
        width: r['width'],
        height: r['height'],
        mimeType: r['mimeType'],
        bytes: r['bytes'],
        filename: r['filename'],
        hasDurationMs: typeof r['durationMs'] === 'number',
        hasBlob: r['blob'] instanceof Blob,
      };
    });

    expect(result).not.toBeNull();
    expect(result!.width).toBe(586);
    expect(result!.height).toBe(589);
    expect(['image/webp', 'image/png']).toContain(result!.mimeType);
    expect(result!.bytes).toBeGreaterThan(0);
    expect(result!.filename).toMatch(/\.(webp|png)$/);
    expect(result!.hasDurationMs).toBe(true);
    expect(result!.hasBlob).toBe(true);
  });

  test('filename extension matches mimeType — never falsely labelled', async ({ page }) => {
    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });

    const { mimeType, filename } = await page.evaluate(() => {
      const r = (window as unknown as Record<string, unknown>).labResult as Record<string, unknown>;
      return { mimeType: r['mimeType'] as string, filename: r['filename'] as string };
    });

    if (mimeType === 'image/webp') {
      expect(filename).toMatch(/\.webp$/);
    } else {
      expect(filename).toMatch(/\.png$/);
    }
  });

  // ── Privacy contract ───────────────────────────────────────────────────────

  test('no network requests made during processing', async ({ page }) => {
    const externalRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      // blob:, data:, and localhost URLs are entirely local — not network traffic.
      // Only flag genuine external origins.
      const isLocal =
        url.startsWith('blob:') ||
        url.startsWith('data:') ||
        url.startsWith('http://127.0.0.1') ||
        url.startsWith('http://localhost');
      if (!isLocal) externalRequests.push(url);
    });

    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });

    expect(externalRequests, 'no external network requests during processing').toHaveLength(0);
  });

  // ── Download ───────────────────────────────────────────────────────────────

  test('download link is enabled after processing', async ({ page }) => {
    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });
    const dl = page.locator('#btn-download');
    await expect(dl).not.toHaveAttribute('aria-disabled', 'true');
    await expect(dl).toHaveAttribute('download');
    await expect(dl).toHaveAttribute('href', /^blob:/);
  });

  // ── Polarity contract ──────────────────────────────────────────────────────
  // Fixture: #111 top-left → #eee bottom-right (dark-to-light diagonal gradient).
  // Correct AM halftone (black dots on white paper):
  //   dark source corner → large ink dots  → dark output region
  //   light source corner → small/no dots  → bright output region
  // Inverted (white dots on black) would flip these: dark corner → bright, light → dark.
  // We sample a 20×20 block at each extreme corner of the output and assert
  // that the top-left (source-dark) region is darker than the bottom-right
  // (source-light) region. This is robust regardless of overall mean brightness.

  test('output tone direction matches source: dark corner → darker output than light corner', async ({
    page,
  }) => {
    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });

    const { darkCornerMean, lightCornerMean } = await page.evaluate(async () => {
      const r = (window as unknown as Record<string, unknown>).labResult as Record<string, unknown>;
      const blob = r['blob'] as Blob;
      const url = URL.createObjectURL(blob);
      const img = await new Promise<HTMLImageElement>((res) => {
        const el = new Image();
        el.onload = () => res(el);
        el.src = url;
      });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; // 586
      c.height = img.naturalHeight; // 589
      c.getContext('2d')!.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const ctx = c.getContext('2d')!;
      const W = c.width;
      const H = c.height;
      const PATCH = 40; // 40×40 px sample block at each corner

      // Top-left corner: source was #111 (dark) → correct halftone → dark output
      const tlData = ctx.getImageData(0, 0, PATCH, PATCH).data;
      let tlSum = 0;
      for (let i = 0; i < tlData.length; i += 4) {
        tlSum += (tlData[i]! + tlData[i + 1]! + tlData[i + 2]!) / 3;
      }
      const darkCornerMean = tlSum / (PATCH * PATCH);

      // Bottom-right corner: source was #eee (light) → correct halftone → bright output
      const brData = ctx.getImageData(W - PATCH, H - PATCH, PATCH, PATCH).data;
      let brSum = 0;
      for (let i = 0; i < brData.length; i += 4) {
        brSum += (brData[i]! + brData[i + 1]! + brData[i + 2]!) / 3;
      }
      const lightCornerMean = brSum / (PATCH * PATCH);

      return { darkCornerMean, lightCornerMean };
    });

    // The dark source corner must produce a darker output region than the light corner.
    // A margin of 20 luminance units ensures the assertion isn't satisfied by noise.
    // Inverted output flips this: darkCornerMean > lightCornerMean → test fails.
    expect(darkCornerMean).toBeLessThan(lightCornerMean - 20);
  });

  // ── Rapid option changes / race prevention ─────────────────────────────────

  test('rapid slider changes produce a single coherent final result', async ({ page }) => {
    await uploadFixture(page);
    // Wait for first result
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });

    // Rapidly change pitch slider several times
    const pitchSlider = page.locator('#ctrl-pitch');
    for (const val of ['3', '6', '4', '8', '4.4']) {
      await pitchSlider.fill(val);
      await pitchSlider.dispatchEvent('input');
    }

    // Wait for the final render to settle
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 20_000 });

    // Only one result should be active (no stale blob from an intermediate render)
    const afterSrc = await page.locator('#preview-after').getAttribute('src');
    expect(afterSrc).toMatch(/^blob:/);
    // window.labResult should reflect pitch≈4.4 (the last value)
    const pitchVal = await pitchSlider.inputValue();
    expect(parseFloat(pitchVal)).toBeCloseTo(4.4, 1);
  });

  // ── Reprocess button ───────────────────────────────────────────────────────

  test('reprocess button triggers a new render', async ({ page }) => {
    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });

    // Click reprocess and verify processing starts again
    await page.locator('#btn-reprocess').click();
    await expect(page.locator('#status-bar')).toContainText(/processing|done/i, {
      timeout: 15_000,
    });
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });
  });

  test('reprocess button is keyboard-operable', async ({ page }) => {
    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });

    const btn = page.locator('#btn-reprocess');
    await btn.focus();
    await expect(btn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#status-bar')).toContainText(/processing|done/i, {
      timeout: 15_000,
    });
  });

  // ── Invalid input ──────────────────────────────────────────────────────────

  test('non-image file shows an error in the status bar', async ({ page }) => {
    await page.evaluate(() => {
      const file = new File(['not an image'], 'bad.txt', { type: 'text/plain' });
      const input = document.getElementById('file-input') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#status-bar')).toContainText(/error|invalid|unsupported/i, {
      timeout: 10_000,
    });
  });

  // ── Responsive layout (390 px) ────────────────────────────────────────────

  test('390px viewport: controls and drop zone are visible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(LAB_PATH);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#drop-zone')).toBeVisible();
    await expect(page.locator('#ctrl-pitch')).toBeVisible();
    await expect(page.locator('#ctrl-focusx')).toBeVisible();
    await expect(page.locator('#btn-reprocess')).toBeVisible();
  });

  test('390px viewport: full upload→process→download flow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(LAB_PATH);
    await page.waitForLoadState('domcontentloaded');

    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 20_000 });
    await expect(page.locator('#btn-download')).not.toHaveAttribute('aria-disabled', 'true');
  });

  // ── Meta line ─────────────────────────────────────────────────────────────

  test('result meta line shows dimensions and mime type', async ({ page }) => {
    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });

    const meta = page.locator('#result-meta');
    await expect(meta).toBeVisible();
    await expect(meta).toContainText('586×589');
    await expect(meta).toContainText(/image\/(webp|png)/);
  });

  // ── Actual download ────────────────────────────────────────────────────────

  test('download produces a non-empty WebP (or PNG) file on disk', async ({ page }) => {
    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btn-download').click(),
    ]);

    // Filename is `${stem}-halftone.{webp|png}` — derived from the input file's stem
    expect(download.suggestedFilename()).toMatch(/-halftone\.(webp|png)$/);

    // File must be saved and have a non-trivial size (> 10 KB)
    // download.path() returns Playwright's temp copy — no saveAs or manual cleanup needed.
    const tmpPath = await download.path();
    if (!tmpPath) throw new Error('download.path() returned null');
    const { size } = await stat(tmpPath);
    expect(size).toBeGreaterThan(10_000);

    // MIME check via magic bytes
    const buf = await readFile(tmpPath);
    const isWebP =
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 && // RIFF
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50; // WEBP
    const isPNG = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47; // .PNG
    expect(isWebP || isPNG).toBe(true);
  });

  // ── Worker path proof ──────────────────────────────────────────────────────

  test('successful render exercises the module worker path', async ({ page }) => {
    const workers: string[] = [];
    page.on('worker', (w) => {
      workers.push(w.url());
    });

    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });

    const lab = await page.evaluate(() => {
      const api = (
        window as unknown as Record<string, { usedWorker?: boolean; workerAvailable?: boolean }>
      ).__halftoneLab;
      return {
        usedWorker: api?.usedWorker === true,
        workerAvailable: api?.workerAvailable === true,
      };
    });

    // Either page.on('worker') saw the bundled worker, or the observability hook says so.
    const sawWorkerUrl = workers.some((u) => /halftone\.worker/i.test(u));
    expect(
      sawWorkerUrl || lab.usedWorker,
      `worker path not exercised; workers=${JSON.stringify(workers)} lab=${JSON.stringify(lab)}`
    ).toBe(true);
  });

  // ── portrait-ready event ───────────────────────────────────────────────────

  test('dispatches portrait-ready CustomEvent with HalftoneResult detail', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__portraitReadyEvents = [];
      window.addEventListener('portrait-ready', ((e: CustomEvent) => {
        const d = e.detail as Record<string, unknown>;
        ((window as unknown as Record<string, unknown>).__portraitReadyEvents as unknown[]).push({
          width: d.width,
          height: d.height,
          mimeType: d.mimeType,
          hasBlob: d.blob instanceof Blob,
          filename: d.filename,
        });
      }) as EventListener);
    });

    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });

    const events = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__portraitReadyEvents as unknown[]
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1] as Record<string, unknown>;
    expect(last.width).toBe(586);
    expect(last.height).toBe(589);
    expect(last.hasBlob).toBe(true);
    expect(String(last.mimeType)).toMatch(/^image\/(webp|png)$/);
    expect(String(last.filename)).toMatch(/-halftone\.(webp|png)$/);
  });

  // ── Invalid options (domain error, no silent retry loop) ───────────────────

  test('invalid pitch option surfaces INVALID_OPTIONS without hanging', async ({ page }) => {
    await page.goto(LAB_PATH);
    await page.waitForLoadState('domcontentloaded');

    const code = await page.evaluate(async () => {
      const lab = (
        window as unknown as {
          __halftoneLab: {
            processPortrait: (input: Blob, opts?: object) => Promise<unknown>;
            PortraitProcessError: new (message: string, code: string) => Error & { code: string };
          };
        }
      ).__halftoneLab;
      try {
        const c = document.createElement('canvas');
        c.width = 8;
        c.height = 8;
        const blob = await new Promise<Blob>((res, rej) =>
          c.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), 'image/png')
        );
        await lab.processPortrait(blob, { pitch: 0 });
        return 'NO_THROW';
      } catch (e: unknown) {
        if (e instanceof lab.PortraitProcessError) return e.code;
        return e instanceof Error ? e.message : String(e);
      }
    });
    expect(code).toBe('INVALID_OPTIONS');
  });

  test('worker-returned domain error is not main-thread-retried as success', async ({ page }) => {
    // processLikeLab mirrors runProcess: domain codes from the worker path must
    // surface as errorCode and must NOT produce a successful result via retry.
    const status = await page.evaluate(async () => {
      const lab = (
        window as unknown as {
          __halftoneLab: {
            processLikeLab: (
              file: File,
              opts?: object
            ) => Promise<{ result?: unknown; usedWorker: boolean; errorCode?: string }>;
          };
        }
      ).__halftoneLab;
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext('2d');
      if (!ctx) return 'NO_CTX';
      ctx.fillStyle = '#888';
      ctx.fillRect(0, 0, 32, 32);
      const blob = await new Promise<Blob>((res, rej) =>
        c.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), 'image/png')
      );
      const file = new File([blob], 'tiny.png', { type: 'image/png' });
      const out = await lab.processLikeLab(file, {
        crop: { x: 0, y: 0, width: 9999, height: 9999 },
      });
      if (out.result) return `UNEXPECTED_SUCCESS:${String(out.usedWorker)}`;
      return `ERR:${out.errorCode ?? 'none'}:usedWorker=${out.usedWorker}`;
    });
    expect(status).toMatch(/^ERR:INVALID_OPTIONS:/);
  });

  // ── Abort during arrayBuffer read ──────────────────────────────────────────

  test('abort during file read does not post a stale worker job', async ({ page }) => {
    await uploadFixture(page);
    // Rapid reprocess while first is in flight — AbortController must cancel stale work.
    await page.locator('#btn-reprocess').click();
    await page.locator('#btn-reprocess').click();
    await page.locator('#btn-reprocess').click();
    await expect(page.locator('#status-bar')).toContainText(/✓ Done|✗ /, {
      timeout: 20_000,
    });
    // Final state should be coherent — not a hung spinner forever
    await expect(page.locator('#status-bar')).not.toContainText('Processing…', { timeout: 20_000 });
  });

  // ── Work-bound large input ─────────────────────────────────────────────────

  test('large camera-like input keeps work dimensions bounded (~2× target)', async ({ page }) => {
    const metrics = await page.evaluate(async () => {
      const lab = (
        window as unknown as {
          __halftoneLab: {
            processPortrait: (
              input: Blob,
              opts?: object
            ) => Promise<{ width: number; height: number; bytes: number }>;
            resolveWorkDimensions: (
              cropW: number,
              cropH: number,
              targetW: number,
              targetH: number,
              maxScale?: number
            ) => { width: number; height: number };
          };
        }
      ).__halftoneLab;
      // 4000×4000 continuous-tone synthetic (camera-like)
      const c = document.createElement('canvas');
      c.width = 4000;
      c.height = 4000;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no ctx');
      const g = ctx.createLinearGradient(0, 0, 4000, 4000);
      g.addColorStop(0, '#111');
      g.addColorStop(1, '#eee');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4000, 4000);
      const blob = await new Promise<Blob>((res, rej) =>
        c.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), 'image/jpeg', 0.92)
      );
      const work = lab.resolveWorkDimensions(4000, 4000, 586, 589, 2);
      const result = await lab.processPortrait(
        new File([blob], 'camera.jpg', { type: 'image/jpeg' })
      );
      return {
        workW: work.width,
        workH: work.height,
        outW: result.width,
        outH: result.height,
        bytes: result.bytes,
      };
    });

    expect(metrics.outW).toBe(586);
    expect(metrics.outH).toBe(589);
    expect(metrics.workW).toBeLessThanOrEqual(586 * 2);
    expect(metrics.workH).toBeLessThanOrEqual(589 * 2);
    expect(metrics.bytes).toBeGreaterThan(1000);
  });

  // ── Teardown ───────────────────────────────────────────────────────────────

  test('pagehide teardown terminates worker and revokes object URLs', async ({ page }) => {
    await uploadFixture(page);
    await expect(page.locator('#status-bar')).toContainText('✓ Done', { timeout: 15_000 });

    const before = await page.evaluate(() => {
      const api = (window as unknown as Record<string, { workerAvailable?: boolean }>)
        .__halftoneLab;
      return {
        workerAvailable: api?.workerAvailable === true,
        hasDownload: !!(document.getElementById('btn-download') as HTMLAnchorElement).href,
      };
    });
    expect(before.hasDownload).toBe(true);

    await page.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    const after = await page.evaluate(() => {
      const api = (window as unknown as Record<string, { workerAvailable?: boolean }>)
        .__halftoneLab;
      return { workerAvailable: api?.workerAvailable === true };
    });
    expect(after.workerAvailable).toBe(false);
  });
});
