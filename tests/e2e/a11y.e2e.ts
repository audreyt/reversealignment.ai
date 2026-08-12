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
});
