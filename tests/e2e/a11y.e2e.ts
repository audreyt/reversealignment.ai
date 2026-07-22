import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function assertNoSeriousA11y(page: Page, label: string, navigate = true) {
  if (navigate) {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical'
  );
  if (serious.length) {
    console.log(
      `a11y violations (${label}):\n`,
      serious.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        help: v.help,
        targets: v.nodes.slice(0, 8).map((n) => n.target),
      }))
    );
  }
  expect(serious, `${label} serious/critical a11y`).toEqual([]);
}

test.describe('accessibility (axe-core)', () => {
  test('desktop home has no serious or critical a11y violations', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await assertNoSeriousA11y(page, 'desktop');
  });

  test('mobile home has no serious or critical a11y violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoSeriousA11y(page, 'mobile');
  });

  test('open slideshow has no serious or critical a11y violations', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.locator('[data-slideshow-open="playbook"]').first().click();
    await expect(page.locator('#slideshow-playbook')).toBeVisible();
    await assertNoSeriousA11y(page, 'open slideshow', false);
  });
});
