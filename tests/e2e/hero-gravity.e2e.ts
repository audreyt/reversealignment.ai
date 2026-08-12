import { expect, test, type Page } from '@playwright/test';
import {
  HERO_FIELD,
  angularTravelAtProgress,
  fieldPoint,
  opacityAtProgress,
  particlePoint,
  radiusAtProgress,
} from '../../src/lib/hero-field';

type HeroProbe = { x: number; y: number; diameter: number } | null;
type HeroCensus = {
  litFraction: number;
  limeFraction: number;
  violetFraction: number;
} | null;

declare global {
  interface Window {
    __heroGravity?: {
      readonly mode: string | undefined;
      readonly frames: number;
      probePoint(radius: number, angle: number, size?: number): HeroProbe;
      probeParticlePoint(radius: number, bearing: number, size?: number): HeroProbe;
      probeParticle(index: number, atTime: number): HeroProbe;
      sample(): HeroCensus;
    };
  }
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

const particleAt = (serialized: number[], index: number) => {
  const [phase, radiusStart, duration, velocity, angleStart, , opacity, , fadeStart] =
    serialized.slice(index * 9, index * 9 + 9);
  return {
    phase: phase!,
    radiusStart: radiusStart!,
    duration: duration!,
    velocity: velocity!,
    angleStart: angleStart!,
    opacity: opacity!,
    fadeStart: fadeStart!,
  };
};

test.describe('hero gravity field', () => {
  test('renders WebGL balls over the cleaned mesh without the preview trace', async ({ page }) => {
    await page.goto('/');
    const field = page.locator('[data-hero-gravity]');
    await field.scrollIntoViewIfNeeded();
    await expect(field).toHaveAttribute('data-gravity-mode', 'gpu');
    await expect(field).toHaveAttribute('aria-hidden', 'true');

    const reference = field.locator('.hero__gravity-reference');
    await expect(reference).toBeVisible();
    await expect(reference).toHaveAttribute(
      'src',
      /^(?:\.\/|\/)assets\/images\/hero-mesh-clean\.png$/
    );
    expect(await reference.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1900);
    expect(await reference.evaluate((image: HTMLImageElement) => image.naturalHeight)).toBe(1150);
    const minimumRimLuma = await reference.evaluate((image: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(1895, 399, 5, 173).data;
      let minimum = 255;
      for (let row = 0; row < 173; row += 1) {
        let brightest = 0;
        for (let column = 0; column < 5; column += 1) {
          const offset = (row * 5 + column) * 4;
          const luma = (pixels[offset]! + pixels[offset + 1]! + pixels[offset + 2]!) / 3;
          brightest = Math.max(brightest, luma);
        }
        minimum = Math.min(minimum, brightest);
      }
      return minimum;
    });
    expect(minimumRimLuma).toBeGreaterThan(50);

    await expect(field.locator('.hero-field--trace, .hero-field--glow, path')).toHaveCount(0);
    const canvas = field.locator('[data-gravity-canvas]');
    await expect(canvas).toBeVisible();
    const backing = await canvas.evaluate((element: HTMLCanvasElement) => ({
      width: element.width,
      height: element.height,
    }));
    expect(backing.width).toBeGreaterThan(300);
    expect(backing.height).toBeGreaterThan(150);

    await settle(page);
    const first = await page.evaluate(() => window.__heroGravity?.frames ?? 0);
    await expect
      .poll(() => page.evaluate(() => window.__heroGravity?.frames ?? 0), {
        timeout: 5000,
        message: 'the hero WebGL loop never advanced',
      })
      .toBeGreaterThan(first);

    const census = await page.evaluate(() => window.__heroGravity?.sample() ?? null);
    expect(census).not.toBeNull();
    expect(census!.litFraction).toBeGreaterThan(0.0002);
    expect(census!.limeFraction).toBeGreaterThan(0);
    expect(census!.violetFraction).toBeGreaterThan(0);
  });

  test('uses the same corrected projection in TypeScript and GLSL', async ({ page }) => {
    await page.goto('/');
    const field = page.locator('[data-hero-gravity]');
    await field.scrollIntoViewIfNeeded();
    await expect(field).toHaveAttribute('data-gravity-mode', 'gpu');
    await settle(page);

    const geometry = await field.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const scale = Math.min(box.width / 165.217, box.height / 100);
      return {
        scale,
        offsetX: (box.width - 165.217 * scale) / 2,
        offsetY: (box.height - 100 * scale) / 2,
      };
    });

    for (const [radius, angle] of [
      [1, Math.PI / 2],
      [0.55, 2.2],
      [0.25, 4.4],
      [0, 0],
    ] as const) {
      const probe = await page.evaluate(
        ([probeRadius, probeAngle]) =>
          window.__heroGravity?.probePoint(probeRadius, probeAngle) ?? null,
        [radius, angle] as const
      );
      expect(probe, `probe r=${radius} a=${angle}`).not.toBeNull();
      const expected = fieldPoint(radius, angle);
      const expectedX = expected.x * geometry.scale + geometry.offsetX;
      const expectedY = expected.y * geometry.scale + geometry.offsetY;
      expect(Math.hypot(probe!.x - expectedX, probe!.y - expectedY)).toBeLessThan(2);
    }

    for (const [radius, bearing] of [
      [1, 0.4],
      [0.55, 2.2],
      [0.352, 4.4],
      [0.2244, 1.7],
      [0.15, 5.1],
      [0.055, 3.2],
    ] as const) {
      const probe = await page.evaluate(
        ([probeRadius, probeBearing]) =>
          window.__heroGravity?.probeParticlePoint(probeRadius, probeBearing) ?? null,
        [radius, bearing] as const
      );
      expect(probe, `particle probe r=${radius} b=${bearing}`).not.toBeNull();
      const expected = particlePoint(radius, bearing);
      const expectedX = expected.x * geometry.scale + geometry.offsetX;
      const expectedY = expected.y * geometry.scale + geometry.offsetY;
      expect(Math.hypot(probe!.x - expectedX, probe!.y - expectedY)).toBeLessThan(2);
    }
  });

  test('moves the actual shader particles counterclockwise at reference speed', async ({
    page,
  }) => {
    await page.goto('/');
    const field = page.locator('[data-hero-gravity]');
    await field.scrollIntoViewIfNeeded();
    await expect(field).toHaveAttribute('data-gravity-mode', 'gpu');
    await settle(page);

    const serialized = await field
      .locator('script[data-gravity-particles]')
      .evaluate((node) => JSON.parse(node.textContent ?? '[]') as number[]);
    const count = Number(await field.getAttribute('data-particle-count'));
    expect(serialized).toHaveLength(count * 9);

    const geometry = await field.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const scale = Math.min(box.width / 165.217, box.height / 100);
      return {
        scale,
        offsetX: (box.width - 165.217 * scale) / 2,
        offsetY: (box.height - 100 * scale) / 2,
      };
    });
    const expectedAt = (particle: ReturnType<typeof particleAt>, time: number) => {
      const progress = (particle.phase + time / particle.duration) % 1;
      const radius = radiusAtProgress(particle.radiusStart, progress);
      const angle =
        particle.angleStart -
        angularTravelAtProgress(
          particle.radiusStart,
          particle.duration,
          particle.velocity,
          progress
        );
      const point = particlePoint(radius, angle);
      return {
        x: point.x * geometry.scale + geometry.offsetX,
        y: point.y * geometry.scale + geometry.offsetY,
      };
    };

    const throat = {
      x: HERO_FIELD.throatX * geometry.scale + geometry.offsetX,
      y: HERO_FIELD.throatY * geometry.scale + geometry.offsetY,
    };
    // Sample the outer, middle, and final visible approach bands.
    const regressions = [
      { index: 16, progress: 0.4, interval: 1 },
      { index: 28, progress: 0.695, interval: 1 },
      { index: 32, progress: 0.79, interval: 0.5 },
    ];
    expect(count).toBeGreaterThan(regressions.at(-1)!.index);

    for (const regression of regressions) {
      const particle = particleAt(serialized, regression.index);
      const startTime = ((regression.progress - particle.phase + 1) % 1) * particle.duration;
      const before = await page.evaluate(
        ([particleIndex, time]) => window.__heroGravity?.probeParticle(particleIndex, time) ?? null,
        [regression.index, startTime] as const
      );
      const after = await page.evaluate(
        ([particleIndex, time]) => window.__heroGravity?.probeParticle(particleIndex, time) ?? null,
        [regression.index, startTime + regression.interval] as const
      );
      expect(before).not.toBeNull();
      expect(after).not.toBeNull();
      const expectedBefore = expectedAt(particle, startTime);
      const expectedAfter = expectedAt(particle, startTime + regression.interval);
      expect(Math.hypot(before!.x - expectedBefore.x, before!.y - expectedBefore.y)).toBeLessThan(
        2
      );
      expect(Math.hypot(after!.x - expectedAfter.x, after!.y - expectedAfter.y)).toBeLessThan(2);

      const bearingBefore = Math.atan2(before!.y - throat.y, before!.x - throat.x);
      const bearingAfter = Math.atan2(after!.y - throat.y, after!.x - throat.x);
      let screenBearingDelta = bearingAfter - bearingBefore;
      if (screenBearingDelta > Math.PI) screenBearingDelta -= Math.PI * 2;
      if (screenBearingDelta < -Math.PI) screenBearingDelta += Math.PI * 2;
      // Negative bearing on the browser's y-down canvas is counterclockwise.
      expect(screenBearingDelta).toBeLessThan(0);
      const degreesPerSecond = (-screenBearingDelta / regression.interval) * (180 / Math.PI);
      expect(degreesPerSecond).toBeGreaterThan(7);
      expect(degreesPerSecond).toBeLessThan(20);
    }
  });

  test('rapidly fades shader particles that reach the throat', async ({ page }) => {
    await page.goto('/');
    const field = page.locator('[data-hero-gravity]');
    await field.scrollIntoViewIfNeeded();
    await expect(field).toHaveAttribute('data-gravity-mode', 'gpu');
    await settle(page);

    const serialized = await field
      .locator('script[data-gravity-particles]')
      .evaluate((node) => JSON.parse(node.textContent ?? '[]') as number[]);
    const particle = particleAt(serialized, 33);
    for (let index = 0; index < serialized.length / 9; index += 1) {
      const generated = particleAt(serialized, index);
      expect(opacityAtProgress(generated.opacity, 1, generated.fadeStart, generated.duration)).toBe(
        0
      );
    }

    const visibleProgress = particle.fadeStart - 0.002;
    const visibleTime = ((visibleProgress - particle.phase + 1) % 1) * particle.duration;
    expect(
      opacityAtProgress(particle.opacity, visibleProgress, particle.fadeStart, particle.duration)
    ).toBeGreaterThan(0.5);
    expect(
      await page.evaluate(
        ([particleIndex, time]) => window.__heroGravity?.probeParticle(particleIndex, time) ?? null,
        [33, visibleTime] as const
      )
    ).not.toBeNull();

    const targetProgress =
      particle.fadeStart + HERO_FIELD.throatFadeSeconds / particle.duration + 0.002;
    expect(targetProgress).toBeLessThan(1);
    const targetTime = ((targetProgress - particle.phase + 1) % 1) * particle.duration;
    expect(
      opacityAtProgress(particle.opacity, targetProgress, particle.fadeStart, particle.duration)
    ).toBe(0);
    expect(
      await page.evaluate(
        ([particleIndex, time]) => window.__heroGravity?.probeParticle(particleIndex, time) ?? null,
        [33, targetTime] as const
      )
    ).toBeNull();
  });

  test('keeps a static field and particles under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const field = page.locator('[data-hero-gravity]');
    await expect(field).toHaveAttribute('data-gravity-mode', 'fallback');
    await expect(field.locator('.hero__gravity-reference')).toBeVisible();

    const count = Number(await field.getAttribute('data-particle-count'));
    const circles = field.locator('.hero-particles--fallback .hero-particle');
    await expect(circles).toHaveCount(count);
    const serialized = await field
      .locator('script[data-gravity-particles]')
      .evaluate((node) => JSON.parse(node.textContent ?? '[]') as number[]);
    const positions = await circles.evaluateAll((nodes) =>
      nodes.map((node) => [Number(node.getAttribute('cx')), Number(node.getAttribute('cy'))])
    );
    const opacities = await circles.evaluateAll((nodes) =>
      nodes.map((node) => Number(node.getAttribute('opacity')))
    );
    for (let index = 0; index < count; index += 1) {
      const particle = particleAt(serialized, index);
      const angle =
        particle.angleStart -
        angularTravelAtProgress(
          particle.radiusStart,
          particle.duration,
          particle.velocity,
          particle.phase
        );
      const expected = particlePoint(radiusAtProgress(particle.radiusStart, particle.phase), angle);
      expect(positions[index]![0]).toBeCloseTo(expected.x, 2);
      expect(positions[index]![1]).toBeCloseTo(expected.y, 2);
      expect(opacities[index]).toBeCloseTo(
        opacityAtProgress(particle.opacity, particle.phase, particle.fadeStart, particle.duration),
        2
      );
    }

    expect(await page.evaluate(() => window.__heroGravity?.frames ?? 0)).toBe(0);
    expect(
      await field.locator('[data-gravity-canvas]').evaluate((element: HTMLCanvasElement) => ({
        width: element.width,
        height: element.height,
      }))
    ).toEqual({ width: 300, height: 150 });
    expect(
      await field.evaluate((element) =>
        element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === 'running')
      )
    ).toHaveLength(0);
  });
});
