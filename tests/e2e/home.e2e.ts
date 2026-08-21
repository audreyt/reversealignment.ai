import { expect, test, type Page } from '@playwright/test';

const EN_JOIN_URL = 'https://reversealignment.ai/join/';
const FOUNDING_COUNT = 26;
const MEMBERS_API_ROUTE = 'https://join.reversealignment.tw/api/members?**';
const LIVE_COMMUNITY_NAMES = [
  'Aba Quill',
  'Bex Meridian',
  'Cato Ember',
  'Dara Vellum',
  'Elio Nimbus',
  'Fia Solace',
  'Gio Lantern',
  'Hana Orbit',
  'Ivo Juniper',
  'Juno Vale',
  'Kato Prism',
  'Luma Cipher',
  'Miro Tessell',
  'Nia Harbor',
  'Oren Quasar',
  'Pia Rook',
  'Quin Marlow',
  'Rhea Circuit',
  'Sora Meadow',
  'Tavi Comet',
  'Uma Pollen',
  'Vero Atlas',
  'Wren Kestrel',
  'Zyra Zenith',
] as const;
const LIVE_SECTORS = [
  'Research',
  'Entertainment',
  'Technology',
  'Government',
  'Philanthropy',
  'Civil Society',
  'Business',
  'Media',
] as const;
const LIVE_COMMUNITY = LIVE_COMMUNITY_NAMES.map((fullName, index) => ({
  id: `mbr_fixture_${String(index + 1).padStart(2, '0')}`,
  fullName,
  role: 'Synthetic fixture member',
  affiliation: 'Test Fixture Guild',
  sector: LIVE_SECTORS[index % LIVE_SECTORS.length],
  source: 'community' as const,
  imageKey: null,
  avatar: 'monogram' as const,
  portraitUrl: null,
  sortIndex: 1000 + index,
  publishedAt: '2026-08-08T00:00:00.000Z',
}));
const DIRECTORY_TOTAL = FOUNDING_COUNT + LIVE_COMMUNITY.length;
const LIVE_ENTERTAINMENT_COUNT = LIVE_COMMUNITY.filter(
  ({ sector }) => sector === 'Entertainment'
).length;
const LIVE_ALPHABETICAL_FIRST = LIVE_COMMUNITY_NAMES[0];
const LIVE_ALPHABETICAL_LAST = LIVE_COMMUNITY_NAMES[LIVE_COMMUNITY_NAMES.length - 1];

async function routeLiveMembers(page: Page, members: readonly Record<string, unknown>[]) {
  await page.route(MEMBERS_API_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ total: members.length, count: members.length, members }),
    })
  );
}

// zh-TW hosts its own join form; the brochure locales link out to the English one.
const locales = [
  { path: '/', lang: 'zh-TW', sortLabel: '排序', joinUrl: 'https://reversealignment.tw/join/' },
  { path: '/en/', lang: 'en', sortLabel: 'Sort', joinUrl: EN_JOIN_URL },
  { path: '/es/', lang: 'es', sortLabel: 'Ordenar', joinUrl: EN_JOIN_URL },
  { path: '/pt-BR/', lang: 'pt-BR', sortLabel: 'Ordenar', joinUrl: EN_JOIN_URL },
] as const;

async function waitForDirectoryHydration(page: Page) {
  // Settle when the live API roster is rendered and the tally matches the cards.
  await expect
    .poll(async () => {
      const rendered = await page.locator('[data-person]').count();
      const tally = await page.locator('[data-dir-count]').textContent();
      return tally?.includes(String(rendered)) ? rendered : 0;
    })
    .toBe(DIRECTORY_TOTAL);
}

test.describe('static multilingual site', () => {
  test.beforeEach(async ({ page }) => {
    await routeLiveMembers(page, LIVE_COMMUNITY);
  });

  test('keeps zh-TW at the root with a hydrating directory and no join form', async ({ page }) => {
    const apiRequests: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/') || path.startsWith('/en/join/api'))
        apiRequests.push(request.url());
    });

    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('我們造 AI 的速度');
    await expect(page.locator('[data-directory]')).toBeVisible();
    await expect(page.locator('label[for="directory-sort"]')).toHaveText('排序');
    await expect(page.locator('form, [data-join-form]')).toHaveCount(0);

    // The founding 25 are the SSR/offline baseline; the live API is the only
    // source for community members.
    await expect(page.locator('[data-person][data-source="canonical"]')).toHaveCount(
      FOUNDING_COUNT
    );
    await waitForDirectoryHydration(page);
    await expect(page.locator('[data-person][data-source="community"]')).toHaveCount(
      LIVE_COMMUNITY.length
    );
    await expect(page.locator('[data-person]')).toHaveCount(DIRECTORY_TOTAL);
    await expect(page.locator('[data-dir-count]')).toHaveText(
      `顯示 ${DIRECTORY_TOTAL} / ${DIRECTORY_TOTAL}`
    );
    await expect(page.getByText('Tenzin Yangtso', { exact: true })).toHaveCount(1);
    await expect(page.getByText(LIVE_ALPHABETICAL_FIRST, { exact: true })).toHaveCount(1);
    await expect(page.getByText(LIVE_ALPHABETICAL_LAST, { exact: true })).toHaveCount(1);

    const html = await page.content();
    expect(html).not.toContain('challenges.cloudflare.com/turnstile');
    // The live members API is the sole community-roster request.
    expect(apiRequests.filter((url) => url.includes('/api/members'))).toHaveLength(1);
  });

  test('every locale join CTA opens its own join host', async ({ page }) => {
    const apiRequests: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/') || path.endsWith('/join/api')) apiRequests.push(request.url());
    });

    for (const locale of locales) {
      apiRequests.length = 0;
      await page.goto(locale.path);

      const join = page.locator('#join');
      await expect(join).toHaveCount(1);
      await expect(join.locator('form, [data-join-form]')).toHaveCount(0);
      await expect(join.locator('.cf-turnstile, [data-turnstile-wrap]')).toHaveCount(0);

      const cta = join.locator('.join-panel a');
      await expect(cta).toHaveAttribute('href', locale.joinUrl);
      await expect(cta).toHaveAttribute('target', '_blank');
      await expect(cta).toHaveAttribute('rel', /noopener/);

      expect(apiRequests.filter((url) => !url.includes('/api/members'))).toEqual([]);
      expect(apiRequests.filter((url) => url.includes('/api/members'))).toHaveLength(1);
    }
  });

  test('contains the whole roster inside the coalition sheet', async ({ page }) => {
    await page.goto('/en/');
    await waitForDirectoryHydration(page);

    const card = page.locator('[data-person][data-name="Vitalik Buterin"]');
    await expect(card).toHaveCount(1);
    await card.scrollIntoViewIfNeeded();
    // `complete` is also true for a failed load, so assert the decode.
    await expect(card.locator('img')).not.toHaveJSProperty('naturalWidth', 0);

    // The last row must not spill past the section into the closing band.
    const spill = await page.evaluate(() => {
      const edge = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect().bottom;
      return Math.round(edge('.people-grid') - edge('#coalition'));
    });
    expect(spill).toBeLessThanOrEqual(0);
  });
  test('reveals recovered biographies on hover and keyboard focus', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/');

    const card = page.locator('[data-person][data-name="Audrey Tang"]');
    const bio = card.locator('[data-person-bio]');
    await card.scrollIntoViewIfNeeded();
    await expect(bio).toHaveCSS('opacity', '0');

    await card.hover();
    await expect(bio).toHaveCSS('opacity', '1');
    await expect(bio).toContainText('Civic hacker');

    await page.mouse.move(0, 0);
    await expect(bio).toHaveCSS('opacity', '0');

    await bio.focus();
    await expect(bio).toHaveCSS('opacity', '1');
    await page.keyboard.press('Escape');
    await expect(bio).not.toBeFocused();
    await expect(bio).toHaveCSS('opacity', '0');

    await waitForDirectoryHydration(page);
    await expect(
      page.locator('[data-person][data-name="Aba Quill"] [data-person-bio]')
    ).toHaveCount(0);
  });

  /*
   * #join is a pixel-pinned brochure panel. With the live form gone, the CTA
   * button must still clear the mono lead and stay inside the green sheet.
   */
  test('desktop join keeps the CTA clear of the pinned mono lead', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/');

    const overlap = await page.evaluate(() => {
      const lead = document.querySelector('.join-panel > .body--mono')!.getBoundingClientRect();
      const cta = document.querySelector('.join-panel > .btn')!.getBoundingClientRect();
      return {
        x: Math.min(lead.right, cta.right) - Math.max(lead.left, cta.left),
        y: Math.min(lead.bottom, cta.bottom) - Math.max(lead.top, cta.top),
      };
    });
    // They share the right-hand column, so they may overlap horizontally; what must
    // never happen is both at once, which is what paints one on top of the other.
    expect(Math.min(overlap.x, overlap.y)).toBeLessThanOrEqual(0);
  });

  test('desktop join CTA stays inside the green join sheet', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/');

    const geometry = await page.evaluate(() => {
      const section = document.querySelector<HTMLElement>('#join')!;
      const panel = section.querySelector<HTMLElement>('.join-panel')!;
      const sectionRect = section.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const ctaRect = section.querySelector('.join-panel > .btn')!.getBoundingClientRect();
      const runOut = getComputedStyle(section, '::after');
      const footer = getComputedStyle(panel, '::after');
      const seam = sectionRect.top + Number.parseFloat(runOut.top);
      const footerBottom =
        panelRect.top + Number.parseFloat(footer.top) + Number.parseFloat(footer.height);

      return {
        ctaSpill: Math.round(ctaRect.bottom - seam),
        footerMismatch: Math.round(footerBottom - seam),
        runOutHeight: Math.round(sectionRect.bottom - seam),
      };
    });

    expect(geometry.ctaSpill).toBeLessThanOrEqual(0);
    expect(Math.abs(geometry.footerMismatch)).toBeLessThanOrEqual(1);
    expect(geometry.runOutHeight).toBe(437);
  });

  for (const width of [1440, 390]) {
    test(`join CTA is not clipped by its section at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/en/');

      const spill = await page.evaluate(() => {
        const edge = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect().bottom;
        return Math.round(edge('.join-panel > .btn') - edge('#join'));
      });
      expect(spill).toBeLessThanOrEqual(0);
    });
  }

  for (const locale of locales) {
    test(`${locale.path} renders its localized sorting control`, async ({ page }) => {
      await page.goto(locale.path);

      await expect(page.locator('html')).toHaveAttribute('lang', locale.lang);
      await expect(page.locator('[data-directory]')).toBeVisible();
      await expect(page.locator('label[for="directory-sort"]')).toHaveText(locale.sortLabel);
      await expect(page.locator('[data-dir-sort] option')).toHaveCount(4);

      // Wait until the live API roster is rendered and its tally is settled.
      await waitForDirectoryHydration(page);

      await expect(page.locator('[data-person]')).toHaveCount(DIRECTORY_TOTAL);
      await expect(page.locator('[data-dir-count]')).toContainText(`${DIRECTORY_TOTAL}`);
      // One visible control per sector the roster fills, plus "all".
      const present = new Set(
        await page
          .locator('[data-person]')
          .evaluateAll((people) => people.map((person) => person.getAttribute('data-sector')))
      );
      await expect(page.locator('[data-dir-sector]:not([hidden])')).toHaveCount(present.size + 1);
      for (const sector of present) {
        await expect(
          page.locator(`[data-dir-sector][data-sector="${sector}"]:not([hidden])`)
        ).toHaveCount(1);
      }
    });
  }

  test('surfaces the Entertainment control only where the roster fills it', async ({ page }) => {
    const entertainment = '[data-dir-sector][data-sector="Entertainment"]';

    // Entertainment is absent from the founding 25; the live API fixture reveals it.
    await page.goto('/en/');
    await waitForDirectoryHydration(page);
    await expect
      .poll(async () => page.locator(entertainment).evaluate((el) => !el.hasAttribute('hidden')))
      .toBe(true);
    await expect(page.locator(entertainment)).toHaveCount(1);
    await expect(page.locator(entertainment)).toBeVisible();
    const cards = page.locator('[data-person][data-sector="Entertainment"]');
    await expect(cards).toHaveCount(LIVE_ENTERTAINMENT_COUNT);

    await page.locator(entertainment).click();
    await expect(page).toHaveURL(/sector=Entertainment/);
    // Auto-retrying counts, so the assertion waits for the filter to settle.
    await expect(
      page.locator('[data-person][data-sector="Entertainment"]:not([hidden])')
    ).toHaveCount(LIVE_ENTERTAINMENT_COUNT);
    await expect(
      page.locator('[data-person]:not([data-sector="Entertainment"]):not([hidden])')
    ).toHaveCount(0);

    // zh-TW / es retain the founding 25 as their offline baseline; the live API
    // fixture reveals Entertainment once hydration finishes.
    for (const path of ['/', '/es/']) {
      await page.goto(path);
      await waitForDirectoryHydration(page);
      await expect
        .poll(async () => page.locator(entertainment).evaluate((el) => !el.hasAttribute('hidden')))
        .toBe(true);
      await expect(page.locator('[data-person][data-sector="Entertainment"]')).toHaveCount(
        LIVE_ENTERTAINMENT_COUNT
      );
    }
  });

  test('indexes whole-domain locales and keeps brochure subpaths noindex', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://reversealignment.tw/'
    );

    for (const path of ['/en/', '/es/', '/pt-BR/']) {
      await page.goto(path);
      await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex, follow'
      );
    }

    // Multi-locale English is still a noindex preview; the official English home
    // is the reversealignment.ai apex deployment (SITE_LOCALE=en).
    await page.goto('/en/');
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://reversealignment.ai/'
    );
    await expect(page.locator('head link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      'href',
      'https://reversealignment.ai/'
    );
    await expect(page.locator('head meta[property="og:image"]')).toHaveAttribute(
      'content',
      'https://reversealignment.tw/en/assets/images/og-image.jpg'
    );

    // Every join page sits behind Cloudflare Access, including the zh-TW one on a
    // locale that is otherwise indexable — each must opt out explicitly or the
    // login wall becomes a search result.
    for (const path of ['/join/', '/en/join/']) {
      await page.goto(path);
      await expect(page.locator('head meta[name="robots"]'), path).toHaveAttribute(
        'content',
        'noindex, nofollow'
      );
    }
  });

  test('sorts and filters the hydrated English directory client-side', async ({ page }) => {
    await page.goto('/en/');

    // Wait for the live community roster so sorting covers both API and SSR rows.
    await waitForDirectoryHydration(page);

    await page.locator('[data-dir-sort]').selectOption('name');
    await expect(page).toHaveURL(/sort=name/);
    await expect(page.locator('[data-person]:not([hidden])').first()).toHaveAttribute(
      'data-name',
      LIVE_ALPHABETICAL_FIRST
    );

    await page.locator('[data-dir-q]').fill('Glen');
    await expect(page).toHaveURL(/q=Glen/);
    await expect(page.locator('[data-dir-count]')).toHaveText(`Showing 1 of ${DIRECTORY_TOTAL}`);
    await expect(page.locator('[data-person]:not([hidden])')).toHaveCount(1);
    await expect(page.locator('[data-person]:not([hidden])')).toHaveAttribute(
      'data-name',
      'Eric Glen Weyl'
    );

    await page.locator('[data-dir-q]').fill('');
    await page.locator('[data-dir-sector][data-sector="Research"]').click();
    await expect(page).toHaveURL(/sector=Research/);
    const research = await page.locator('[data-person][data-sector="Research"]').count();
    await expect(page.locator('[data-person]:not([hidden])')).toHaveCount(research);
    const sectors = await page
      .locator('[data-person]:not([hidden])')
      .evaluateAll((people) => people.map((person) => person.getAttribute('data-sector')));
    expect(sectors).toEqual(Array(research).fill('Research'));
  });

  test('ships no placeholder scale-preview rows on any locale', async ({ page }) => {
    for (const path of ['/en/', '/']) {
      await page.goto(path);
      await waitForDirectoryHydration(page);
      await expect(
        page.locator('[data-person][data-role="Placeholder entry, scale preview"]')
      ).toHaveCount(0);
      await expect(page.getByText('Placeholder entry, scale preview')).toHaveCount(0);
    }
  });

  test('restores sort state from a localized route query string', async ({ page }) => {
    await page.goto('/pt-BR/?sort=name-desc');

    await expect(page.locator('[data-dir-sort]')).toHaveValue('name-desc');
    // Wait for the live roster so Z–A covers both API and SSR rows.
    await waitForDirectoryHydration(page);
    await expect(page.locator('[data-person]')).toHaveCount(DIRECTORY_TOTAL);

    const names = await page
      .locator('[data-person]:not([hidden])')
      .evaluateAll((people) => people.map((person) => person.getAttribute('data-name') || ''));
    // Same comparator the directory client uses (localeCompare, base sensitivity).
    const expected = [...names].sort((a, b) =>
      b.localeCompare(a, undefined, { sensitivity: 'base' })
    );
    expect(names[0]).toBe(LIVE_ALPHABETICAL_LAST);
    expect(names).toEqual(expected);
  });

  test('keeps the desktop directory inside the coalition page margin', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/');

    // The hairline under the title is the reference art's page margin.
    const rule = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('.coalition-head')!, '::after');
      const left = Number.parseFloat(style.left);
      return { left: Math.round(left), right: Math.round(left + Number.parseFloat(style.width)) };
    });

    const title = await page.locator('#coalition-title').boundingBox();
    expect(Math.round(title!.x)).toBe(rule.left);

    for (const selector of ['[data-directory]', '.sectors__row', '.people-grid']) {
      const rect = await page.locator(selector).first().boundingBox();
      expect(Math.round(rect!.x), `${selector} starts at the page margin`).toBe(rule.left);
      expect(Math.round(rect!.x + rect!.width), `${selector} ends at the page margin`).toBe(
        rule.right
      );
    }
  });
});
