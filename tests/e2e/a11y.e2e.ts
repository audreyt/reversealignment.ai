import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function assertNoSeriousA11y(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical'
  );
  expect(serious, `${label} serious/critical a11y`).toEqual([]);
}

test.describe('multilingual static accessibility', () => {
  test('zh-TW root has no serious or critical violations', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
    await expect(page.locator('[data-directory]')).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
    await assertNoSeriousA11y(page, 'zh-TW desktop');
  });

  test('English mobile route has no serious or critical violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('[data-directory]')).toBeVisible();
    await assertNoSeriousA11y(page, 'en mobile');
  });

  test('English join page has no serious or critical violations', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/en/join/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('[data-join-form]')).toBeVisible();
    await expect(page.locator('[data-join-input="email"]')).toHaveCount(0);
    await assertNoSeriousA11y(page, 'en join');
  });

  test('zh-TW join page has no serious or critical violations', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/join/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
    await expect(page.locator('[data-join-form]')).toBeVisible();
    await expect(page.locator('[data-join-input="email"]')).toHaveCount(0);
    await assertNoSeriousA11y(page, 'zh-TW join');
  });

  test('zh-TW event page has no serious or critical violations', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/events/you-are-here/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
    await expect(page.locator('.event-record .event-record__cta')).toHaveAttribute(
      'href',
      'https://archive.tw/2026-08-29-platform-originals-對齊的另一面'
    );
    await expect(page.locator('.event-answer__chapter a').first()).toHaveAttribute(
      'href',
      'https://archive.tw/2026-08-29-platform-originals-對齊的另一面#s63983970'
    );
    await expect(page.locator('.event-legend__art')).toHaveCount(5);
    await expect(page.locator('.event-quote')).toHaveCount(4);
    await expect(page.locator('.event-principle')).toHaveCount(5);
    await expect(page.locator('.event-answer')).toHaveCount(11);
    await expect(page.locator('a[href*="luma.com"], a[href*="sli.do"]')).toHaveCount(0);
    await assertNoSeriousA11y(page, 'zh-TW event page');
  });

  test('English event page has no serious or critical violations on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/events/you-are-here/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.event-record .event-record__cta')).toHaveAttribute(
      'href',
      'https://archive.tw/2026-08-29-platform-originals-the-other-side-of-al'
    );
    await expect(page.locator('.event-answer__chapter a').first()).toHaveAttribute(
      'href',
      'https://archive.tw/2026-08-29-platform-originals-the-other-side-of-al#s63985755'
    );
    await expect(page.locator('.event-quote')).toHaveCount(0);
    await expect(page.locator('.event-principle')).toHaveCount(5);
    await expect(page.locator('.event-answer')).toHaveCount(11);
    await expect(page.locator('a[href*="luma.com"], a[href*="sli.do"]')).toHaveCount(0);
    await assertNoSeriousA11y(page, 'en event page mobile');
  });
});
