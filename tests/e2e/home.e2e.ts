import { expect, test } from '@playwright/test';

test.describe('home page', () => {
  test('desktop renders key sections and local assets', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'We are building AI faster'
    );
    await expect(page.locator('#idea')).toBeVisible();
    await expect(page.locator('#building')).toBeVisible();
    await expect(page.locator('#claim')).toBeVisible();
    await expect(page.locator('#papers')).toBeVisible();
    await expect(page.locator('#grants')).toBeVisible();
    await expect(page.locator('#coalition')).toBeVisible();
    await expect(page.locator('#join')).toBeVisible();

    const title = page.locator('#grants-title');
    await expect(title).toContainText(/Fast-grants/i);
    await expect(title).not.toContainText(/FAST-RANTS/i);

    const heroGravity = page.locator('[data-hero-gravity]');
    await expect(heroGravity).toBeVisible();
    await expect(heroGravity.locator('.hero-particle')).toHaveCount(58);
    await expect(page.locator('video')).toHaveCount(0);

    for (const asset of [
      'assets/images/hero-diagram',
      'assets/images/intro-collage',
      'assets/images/history-strip',
      'assets/images/failures-panel',
      'assets/images/building-bg',
      'assets/images/claim-bg',
      'assets/images/papers-bg',
      'assets/images/coalition-texture',
      'assets/images/join-bg',
      'assets/images/closing-bg',
    ]) {
      await expect(page.locator(`img[src*="${asset}"]`).first()).toHaveCount(1);
    }

    const notify = page.locator('#notify');
    await expect(notify).toHaveAttribute('action', /mailto:/);
    await expect(notify).toHaveAttribute('method', /post/i);
    await expect(notify).toHaveAttribute('enctype', 'text/plain');
    await expect(notify).not.toHaveAttribute('action', '#');
    await expect(notify.locator('[data-form-note]')).toContainText(/mail client|email client/i);

    const joinForm = page.locator('#join-form');
    await expect(joinForm).toHaveAttribute('method', /post/i);
    await expect(joinForm).toHaveAttribute('enctype', 'text/plain');

    // Labels associate via stable slug ids (not raw human field names)
    for (const formSel of ['#notify', '#join-form']) {
      const form = page.locator(formSel);
      const labels = form.locator('label[for]');
      const count = await labels.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const forId = await labels.nth(i).getAttribute('for');
        expect(forId).toBeTruthy();
        expect(forId).toMatch(/^[A-Za-z][\w-]*$/);
        expect(forId).not.toMatch(/\s/);
        await expect(form.locator(`#${forId!}`)).toHaveCount(1);
      }
    }

    // Sticky chrome matches live: brand + JOIN only (no section link row)
    await expect(page.locator('.site-header .brand')).toBeVisible();
    await expect(page.locator('.site-header .btn--join')).toHaveText(/join/i);
    await expect(page.locator('.nav a')).toHaveCount(0);
    await expect(page.locator('[data-nav-toggle]')).toHaveCount(0);

    const remoteFonts = await page.locator('link[href*="fonts.googleapis.com"]').count();
    expect(remoteFonts).toBe(0);

    // hreflang present for default locale
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveCount(1);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
  });

  test('vector hero follows an accelerating orbital inspiral', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const trajectory = await page.locator('[data-hero-gravity]').evaluate((element) => {
      if (!(element instanceof SVGSVGElement)) return null;
      const particle = element.querySelector('.hero-particle');
      const motion = particle?.querySelector('animateMotion');
      const opacity = particle?.querySelector('animate[attributeName="opacity"]');
      if (!(particle instanceof SVGCircleElement) || !motion || !opacity) return null;

      const centerPoint = element.createSVGPoint();
      centerPoint.x = 107.4;
      centerPoint.y = 67;
      const screenMatrix = element.getScreenCTM();
      if (!screenMatrix) return null;
      const center = centerPoint.matrixTransform(screenMatrix);
      const duration = Number.parseFloat(motion.getAttribute('dur') ?? '');
      const begin = Number.parseFloat(motion.getAttribute('begin') ?? '');
      const phases = [0.02, 0.2, 0.4, 0.6, 0.8, 0.95, 0.99];

      element.pauseAnimations();
      const points = phases.map((phase) => {
        element.setCurrentTime(Math.max(0, begin + phase * duration));
        const rect = particle.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        return {
          x,
          y,
          distance: Math.hypot(x - center.x, y - center.y),
        };
      });
      element.unpauseAnimations();

      return {
        fieldPaths: element.querySelectorAll('.hero-field path').length,
        keyPoints: (motion.getAttribute('keyPoints') ?? '').split(';').length,
        keyTimes: (motion.getAttribute('keyTimes') ?? '').split(';').length,
        opacityValues: opacity.getAttribute('values'),
        pathSegments: (motion.getAttribute('path')?.match(/L/g) ?? []).length,
        points,
      };
    });

    expect(trajectory).not.toBeNull();
    if (!trajectory) throw new Error('Orbital animation is unavailable');

    expect(trajectory.fieldPaths).toBe(41);
    expect(trajectory.keyPoints).toBe(181);
    expect(trajectory.keyTimes).toBe(181);
    expect(trajectory.pathSegments).toBe(180);
    expect(trajectory.opacityValues).toMatch(/^0;.+;.+;0$/);

    const xValues = trajectory.points.map(({ x }) => x);
    const yValues = trajectory.points.map(({ y }) => y);
    expect(Math.max(...xValues) - Math.min(...xValues)).toBeGreaterThan(100);
    expect(Math.max(...yValues) - Math.min(...yValues)).toBeGreaterThan(100);
    expect(trajectory.points.at(-1)!.distance).toBeLessThan(trajectory.points[0].distance * 0.15);
  });

  test('intro collage spans the paper pane as a background', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const layout = await page.locator('#idea .sheet__content').evaluate((content) => {
      const background = content.querySelector('.idea__background');
      const lead = content.querySelector('.idea-lead-grid');
      if (!(background instanceof HTMLElement) || !(lead instanceof HTMLElement)) return null;

      const contentRect = content.getBoundingClientRect();
      const backgroundRect = background.getBoundingClientRect();
      const leadRect = lead.getBoundingClientRect();
      return {
        backgroundPosition: getComputedStyle(background).position,
        backgroundWidth: backgroundRect.width,
        contentWidth: contentRect.width,
        overlapsLead:
          backgroundRect.left < leadRect.right &&
          backgroundRect.right > leadRect.left &&
          backgroundRect.top < leadRect.bottom &&
          backgroundRect.bottom > leadRect.top,
        oldAsideCount: content.querySelectorAll('.media-frame--collage').length,
      };
    });

    expect(layout).not.toBeNull();
    if (!layout) throw new Error('Intro background is unavailable');
    expect(layout.backgroundPosition).toBe('absolute');
    expect(layout.backgroundWidth / layout.contentWidth).toBeGreaterThan(0.98);
    expect(layout.overlapsLead).toBe(true);
    expect(layout.oldAsideCount).toBe(0);
  });

  test('desktop idea bands retain source geometry after media decode', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.querySelectorAll<HTMLImageElement>('#idea img')].map((image) =>
          image.decode().catch(() => undefined)
        )
      );
    });

    const geometry = await page.locator('#idea').evaluate((section) => {
      const history = section.querySelector('.idea-band--history');
      const failures = section.querySelector('.idea-band--failures');
      const close = section.querySelector('.idea-band--close');
      const intro = [...section.querySelectorAll('.idea-band--failures .stack-sm .lede')];
      const rows = [...section.querySelectorAll('.failure')];
      if (!history || !failures || !close || intro.length !== 2 || rows.length !== 3) return null;

      const globalRect = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {
          top: rect.top + window.scrollY,
          bottom: rect.bottom + window.scrollY,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      };

      return {
        section: globalRect(section),
        history: globalRect(history),
        failures: globalRect(failures),
        close: globalRect(close),
        intro: intro.map(globalRect),
        rows: rows.map((row) => ({
          row: globalRect(row),
          number: globalRect(row.querySelector('.eyebrow')!),
          title: globalRect(row.querySelector('.failure__title')!),
          body: globalRect(row.querySelector('.failure__body')!),
        })),
      };
    });

    expect(geometry).not.toBeNull();
    if (!geometry) throw new Error('Desktop idea geometry is unavailable');
    expect(geometry.section.top).toBeCloseTo(1149, 0);
    expect(geometry.section.bottom).toBeCloseTo(3204, 0);
    expect(geometry.history.top).toBeCloseTo(1904, 0);
    expect(geometry.history.height).toBeCloseTo(274, 0);
    expect(geometry.failures.top).toBeCloseTo(2178, 0);
    expect(geometry.failures.height).toBeCloseTo(532, 0);
    expect(geometry.close.top).toBeCloseTo(2710, 0);
    expect(geometry.close.bottom).toBeCloseTo(3204, 0);
    expect(geometry.intro[1].top - geometry.intro[0].bottom).toBeLessThanOrEqual(1);

    for (const row of geometry.rows) {
      expect(row.number.top).toBeCloseTo(row.title.top, 0);
      expect(row.body.bottom).toBeLessThan(geometry.failures.bottom);
    }
    expect(geometry.rows[2].body.bottom).toBeLessThan(geometry.close.top);
  });

  test('coalition header follows the source canvas', async ({ page }) => {
    for (const width of [1440, 1568]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);

      const geometry = await page.locator('#coalition').evaluate((section) => {
        const scale = window.innerWidth / 1024;
        const sectionRect = section.getBoundingClientRect();
        const relativeRect = (selector: string) => {
          const rect = section.querySelector(selector)!.getBoundingClientRect();
          return {
            left: rect.left / scale,
            top: (rect.top - sectionRect.top) / scale,
            width: rect.width / scale,
            height: rect.height / scale,
          };
        };
        return {
          title: relativeRect('#coalition-title'),
          lead: relativeRect('.coalition-head .lede'),
          body: relativeRect('.coalition-head > .body--mono'),
          sectors: relativeRect('.sectors'),
          firstPerson: relativeRect('article.person'),
          paper: relativeRect('.coalition-paper'),
          edge: relativeRect('.coalition-edge'),
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });

      const expectRectClose = (
        actual: { left: number; top: number; width: number; height: number },
        expected: { left: number; top: number; width: number; height: number }
      ) => {
        expect(actual.left).toBeCloseTo(expected.left, 1);
        expect(actual.top).toBeCloseTo(expected.top, 1);
        expect(actual.width).toBeCloseTo(expected.width, 1);
        expect(actual.height).toBeCloseTo(expected.height, 1);
      };

      expectRectClose(geometry.title, { left: 28, top: 57.75, width: 606, height: 48 });
      expectRectClose(geometry.lead, { left: 28, top: 153.5, width: 304, height: 54 });
      expectRectClose(geometry.body, { left: 608, top: 153.75, width: 388, height: 112 });
      expectRectClose(geometry.sectors, { left: 28, top: 227.07, width: 968, height: 41 });
      expectRectClose(geometry.firstPerson, { left: 28, top: 320.31, width: 221, height: 274 });
      expectRectClose(geometry.paper, { left: -11, top: 0, width: 1046, height: 741 });
      expectRectClose(geometry.edge, { left: -7, top: -102.25, width: 1038, height: 520 });
      expect(geometry.documentWidth).toBe(geometry.viewportWidth);
    }
  });

  test('Noema cover hover and desktop type match the source scale', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const card = page.locator('[data-paper-id="noema"]');
    const cover = card.locator('.paper-card__media img');
    await card.scrollIntoViewIfNeeded();
    await expect(cover).toHaveCSS('opacity', '1');

    const supportsHover = await page.evaluate(() => matchMedia('(hover: hover)').matches);
    if (supportsHover) {
      await card.hover();
      await expect(cover).toHaveCSS('opacity', '0.8');
      await page.mouse.move(1400, 80);
      await expect(cover).toHaveCSS('opacity', '1');
    }

    await card.locator('.btn').focus();
    await expect(cover).toHaveCSS('opacity', '0.8');
    await expect(card.locator('.paper-card__title')).toHaveCSS('font-family', /IBM Plex Mono/);
    await expect(card.locator('.paper-card__title')).toHaveCSS('font-size', '33.489px');
    await expect(card.locator(':scope > .body')).toHaveCSS('font-size', '16.744px');
    await expect(page.locator('.challenge-card__title').first()).toHaveCSS('font-size', '22.325px');
    await expect(page.locator('.challenge-card__number').first()).toHaveCSS(
      'font-size',
      '16.744px'
    );
    await expect(page.locator('.site-header .brand')).toHaveCSS('font-size', '11.163px');
  });

  test('all challenge cards reveal their text only on hover or focus', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const desktopCards = page.locator('.challenge-card');
    const desktopBodies = page.locator('.challenge-card__body');
    await expect(desktopCards).toHaveCount(12);
    await desktopCards.first().scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        desktopBodies.evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).opacity)
        )
      )
      .toEqual(Array(12).fill('0'));

    for (let index = 0; index < 12; index += 1) {
      const card = desktopCards.nth(index);
      const body = desktopBodies.nth(index);
      await card.hover();
      await expect(body).toHaveCSS('opacity', '1');
      await page.mouse.move(1400, 80);
      await expect(body).toHaveCSS('opacity', '0');
    }

    await desktopCards.first().focus();
    await expect(desktopBodies.first()).toHaveCSS('opacity', '1');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const mobileCard = page.locator('.challenge-card').first();
    const mobileBody = mobileCard.locator('.challenge-card__body');
    await mobileCard.scrollIntoViewIfNeeded();
    await expect(mobileBody).toHaveCSS('opacity', '0');
    await mobileCard.focus();
    await expect(mobileBody).toHaveCSS('opacity', '1');
  });

  test('join intro and disclosure stay clear of the form controls', async ({ page }) => {
    await page.setViewportSize({ width: 1386, height: 922 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    const geometry = await page.locator('#join .join-panel').evaluate((panel) => {
      const bounds = (selector: string) => {
        const rect = panel.querySelector(selector)!.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      };
      return {
        intro: bounds(':scope > .body--mono'),
        firstField: bounds('.form__field'),
        button: bounds('.form > .btn'),
        note: bounds('.form__note'),
        noteColor: getComputedStyle(panel.querySelector('.form__note')!).color,
      };
    });

    expect(geometry.intro.bottom).toBeLessThanOrEqual(geometry.firstField.top);
    expect(geometry.button.bottom).toBeLessThanOrEqual(geometry.note.top);
    expect(geometry.noteColor).toBe('rgb(244, 243, 243)');
  });

  test('local slide viewers preserve source geometry and keyboard navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('a[href*="drive.google"], a[href*="dropbox"]')).toHaveCount(0);

    const playbookTrigger = page.locator('[data-slideshow-open="playbook"]').first();
    await playbookTrigger.click();
    const playbook = page.locator('#slideshow-playbook');
    await expect(playbook).toBeVisible();
    await expect(playbook.locator('.slideshow__status')).toHaveText('Slide 1 of 20');
    await expect(playbook.locator('[data-slide-index]')).toHaveCount(20);

    const playbookImage = playbook.locator('[data-slideshow-image]');
    await expect(playbookImage).toHaveAttribute('src', /assets\/slides\/playbook\/slide-01\.jpg$/);
    const imageGeometry = await playbookImage.evaluate((image) => {
      if (!(image instanceof HTMLImageElement)) return null;
      return {
        naturalRatio: image.naturalWidth / image.naturalHeight,
        objectFit: getComputedStyle(image).objectFit,
      };
    });
    expect(imageGeometry).not.toBeNull();
    if (!imageGeometry) throw new Error('Playbook slide image is unavailable');
    expect(imageGeometry.naturalRatio).toBeCloseTo(16 / 9, 5);
    expect(imageGeometry.objectFit).toBe('contain');

    await page.keyboard.press('End');
    await expect(playbook.locator('.slideshow__status')).toHaveText('Slide 20 of 20');
    await expect(playbook.locator('[data-slideshow-next]')).toBeDisabled();
    await playbook.locator('[data-slideshow-close]').click();
    await expect(playbookTrigger).toBeFocused();

    await page.locator('[data-slideshow-open="deck"]').click();
    const deck = page.locator('#slideshow-deck');
    await expect(deck).toBeVisible();
    await expect(deck.locator('[data-slide-index]')).toHaveCount(12);
    await expect(deck.locator('.slideshow__download')).toHaveAttribute(
      'href',
      /assets\/documents\/grand-challenges-deck\.pdf$/
    );
  });

  test('grants content stays separated and aligned', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const geometry = await page.locator('#grants').evaluate((section) => {
      const eyebrow = section.querySelector('.grants-copy > .eyebrow');
      const copyContainer = section.querySelector('.grants-copy');
      const copy = section.querySelector('.grants-copy__body');
      const form = section.querySelector('.grants-copy > form');
      const panel = section.querySelector('.grants-panel');
      const title = section.querySelector('#grants-title');
      const body = section.querySelector('.grants-panel__body');
      if (!eyebrow || !copyContainer || !copy || !form || !panel || !title || !body) return null;

      const eyebrowRect = eyebrow.getBoundingClientRect();
      const copyContainerRect = copyContainer.getBoundingClientRect();
      const copyRect = copy.getBoundingClientRect();
      const formRect = form.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const panelDivider = Number.parseFloat(getComputedStyle(panel, '::after').top);
      const copyDivider = Number.parseFloat(getComputedStyle(copyContainer, '::after').top);
      return {
        panelAboveHeading: eyebrowRect.top - panelRect.top,
        titleBodyGap: bodyRect.top - titleRect.bottom,
        dividerAfterTitle: panelRect.top + panelDivider - titleRect.bottom,
        bodyAfterDivider: bodyRect.top - (panelRect.top + panelDivider),
        copyAfterDivider: copyRect.top - (copyContainerRect.top + copyDivider),
        formAfterCopy: formRect.top - copyRect.bottom,
      };
    });

    expect(geometry).not.toBeNull();
    if (!geometry) throw new Error('Grants geometry is unavailable');
    expect(geometry.panelAboveHeading).toBeGreaterThan(30);
    expect(geometry.titleBodyGap).toBeGreaterThan(30);
    expect(geometry.dividerAfterTitle).toBeGreaterThan(10);
    expect(geometry.bodyAfterDivider).toBeGreaterThan(20);
    expect(geometry.copyAfterDivider).toBeGreaterThan(20);
    expect(geometry.formAfterCopy).toBeGreaterThan(40);
  });

  test('mobile slideshow fills the viewport without cropping its slides', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.locator('[data-slideshow-open="playbook"]').first().click();

    const viewer = page.locator('#slideshow-playbook');
    await expect(viewer).toBeVisible();
    const geometry = await viewer.evaluate((dialog) => {
      const shell = dialog.querySelector('.slideshow__shell');
      const image = dialog.querySelector('[data-slideshow-image]');
      const footer = dialog.querySelector('.slideshow__footer');
      if (!shell || !(image instanceof HTMLImageElement) || !footer) return null;
      const shellRect = shell.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        shell: [shellRect.left, shellRect.top, shellRect.right, shellRect.bottom],
        image: [imageRect.left, imageRect.top, imageRect.right, imageRect.bottom],
        footerBottom: footerRect.bottom,
        naturalRatio: image.naturalWidth / image.naturalHeight,
        objectFit: getComputedStyle(image).objectFit,
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    });

    expect(geometry).not.toBeNull();
    if (!geometry) throw new Error('Mobile slideshow geometry is unavailable');
    expect(geometry.shell).toEqual([0, 0, 390, 844]);
    expect(geometry.image[0]).toBeGreaterThanOrEqual(0);
    expect(geometry.image[1]).toBeGreaterThanOrEqual(0);
    expect(geometry.image[2]).toBeLessThanOrEqual(390);
    expect(geometry.image[3]).toBeLessThanOrEqual(844);
    expect(geometry.footerBottom).toBeLessThanOrEqual(844);
    expect(geometry.naturalRatio).toBeCloseTo(16 / 9, 5);
    expect(geometry.objectFit).toBe('contain');
    expect(geometry.bodyOverflow).toBe('hidden');
  });

  test('mobile paper resources stay complete above the Safari viewport edge', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 699 });
    await page.goto('/');

    const geometry = await page.evaluate(async () => {
      const shell = document.querySelector('.page');
      const header = document.querySelector('.site-header');
      const lastPaper = document.querySelector('#papers .paper-card:nth-child(2)');
      const storyTitle = document.querySelector('#story-title');
      const resources = [...document.querySelectorAll('#papers .resource')];
      if (!shell || !header || !lastPaper || !storyTitle || resources.length !== 2) return null;

      shell.scrollTop = 6940;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const rect = (element: Element) => {
        const bounds = element.getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom };
      };

      return {
        bodyOverflow: getComputedStyle(document.body).overflow,
        windowScroll: window.scrollY,
        shell: rect(shell),
        shellScroll: shell.scrollTop,
        shellScrollHeight: shell.scrollHeight,
        header: rect(header),
        lastPaper: rect(lastPaper),
        storyTitle: rect(storyTitle),
        resources: resources.map((resource) => ({
          row: rect(resource),
          title: rect(resource.querySelector('h3')!),
          body: rect(resource.querySelector('.body')!),
          button: rect(resource.querySelector('.btn')!),
        })),
      };
    });

    expect(geometry).not.toBeNull();
    if (!geometry) throw new Error('Mobile paper resource geometry is unavailable');
    expect(geometry.bodyOverflow).toBe('hidden');
    expect(geometry.windowScroll).toBe(0);
    expect(geometry.shell).toEqual({ top: 0, bottom: 699 });
    expect(geometry.shellScroll).toBe(6940);
    expect(geometry.shellScrollHeight).toBeGreaterThan(15_000);
    expect(geometry.lastPaper.bottom).toBeLessThanOrEqual(geometry.header.bottom);
    expect(geometry.storyTitle.top).toBeGreaterThanOrEqual(geometry.shell.bottom);

    for (const resource of geometry.resources) {
      expect(resource.row.top).toBeGreaterThanOrEqual(geometry.header.bottom);
      expect(resource.row.bottom).toBeLessThanOrEqual(geometry.shell.bottom);
      for (const content of [resource.title, resource.body, resource.button]) {
        expect(content.top).toBeGreaterThanOrEqual(resource.row.top);
        expect(content.bottom).toBeLessThanOrEqual(resource.row.bottom);
      }
    }
  });

  test('mobile sticky chrome is brand + JOIN without hamburger menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('.site-header .brand')).toBeVisible();
    await expect(page.locator('.site-header .btn--join')).toBeVisible();
    await expect(page.locator('[data-nav-toggle]')).toHaveCount(0);
    await expect(page.locator('[data-mobile-nav]')).toHaveCount(0);
  });
});
