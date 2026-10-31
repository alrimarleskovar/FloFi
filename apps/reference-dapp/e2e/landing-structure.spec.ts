// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';
import { assertConnectedFlow } from './connected-flow-assertions';

const evidence = 'e2e/visual-evidence/final-landing';
for (const width of [320, 375, 390, 430, 768, 1024, 1440, 1920]) {
  test(`landing sections, closing composition, anchors and conversion at ${width}px in EN/PT`, async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', event => { if (event.type() === 'error' || /hydration|did not match/i.test(event.text())) errors.push(event.text()); });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
    await page.addInitScript(() => sessionStorage.setItem('flofi-alive-intro-v1', 'seen'));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    for (const locale of ['en', 'pt']) {
      await page.getByRole('button', { name: locale.toUpperCase(), exact: true }).click();
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      const hero = page.locator('#workflow');
      const headline = page.getByRole('heading', { level: 1 });
      await expect(headline).toHaveCount(1);
      await expect(headline).toContainText(locale === 'en' ? 'Many ways in.' : 'Várias entradas.');
      expect(await page.locator('main > section').evaluateAll(items => items.map(item => item.id))).toEqual(['workflow', 'networks', 'demo', 'assistants', 'developers', 'about']);
      expect(await page.locator('main').evaluate(element => element.nextElementSibling?.tagName)).toBe('FOOTER');
      await expect(page.locator('#product, #scenarios, #review, [data-story-stage]')).toHaveCount(0);
      await expect(page.locator('#about [data-earth]')).toHaveCount(1);
      const launch = hero.getByRole('link', { name: locale === 'en' ? /Launch FloFi/ : /Abrir FloFi/ });
      const docs = hero.getByRole('link', { name: locale === 'en' ? /Explore Docs/ : /Explorar Docs/ });
      await expect(launch).toHaveAttribute('href', '/login');
      await expect(docs).toHaveAttribute('href', '/docs');
      await expect(headline).toBeInViewport({ ratio: 1 });
      await expect(launch).toBeInViewport({ ratio: 1 });
      await expect(docs).toBeInViewport({ ratio: 1 });
      if (process.env.FLOFI_MOTION_EXPECT_ENABLED !== 'false') {
        const perch = hero.locator('[data-mascot-dock="hero"] [data-mascot-perch]');
        expect((await perch.boundingBox())!.width).toBe(width < 600 ? 56 : width < 1024 ? 128 : 160);
        expect(await perch.evaluate(element => {
          const mascot = element.getBoundingClientRect(), heading = document.querySelector('h1')!.getBoundingClientRect();
          const orbit = element.nextElementSibling!.getBoundingClientRect();
          return mascot.left >= 0 && mascot.right <= innerWidth && orbit.left >= 0 && orbit.right <= innerWidth
            && (mascot.bottom <= heading.top || mascot.top >= heading.bottom || mascot.left >= heading.right || mascot.right <= heading.left);
        })).toBe(true);
      }
      await launch.focus(); await expect(launch).toBeFocused();
      expect(await launch.evaluate(element => {
        const box = element.getBoundingClientRect();
        return box.height >= 44 && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
      await expect(hero.locator('[data-story-phase]')).toHaveCount(3);
      await expect(hero.locator('[data-channel-icon]')).toHaveCount(6);
      // Check real text rectangles, not only document overflow hidden by the outer wrapper.
      expect(await page.locator('h1, h2, h3').evaluateAll(items => items.every(element => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth + 1;
      }))).toBe(true);
      expect(await page.locator('main').evaluate(element => [...element.querySelectorAll('*')].every(item => !['fixed', 'sticky'].includes(getComputedStyle(item).position)))).toBe(true);
      for (const nav of [page.locator('header nav'), page.locator('footer nav')]) {
        const anchors = nav.locator('a[href^="#"]');
        for (const link of await anchors.all()) {
          const hash = await link.getAttribute('href');
          await link.click(); await expect(page).toHaveURL(new RegExp(`${hash}$`));
          await expect(page.locator(hash!)).toBeInViewport();
        }
      }
      const diagram = page.locator('[data-flow-diagram="light"]');
      await diagram.scrollIntoViewIfNeeded();
      await expect.poll(async () => { try { await assertConnectedFlow(diagram); return true; } catch { return false; } }).toBe(true);
      await expect(diagram).toContainText('Orca · Solana'); await expect(diagram).toContainText('Aave · Ethereum');
      await expect(page.locator('#networks li')).toHaveCount(6);
      await expect(page.locator('#networks')).toContainText(locale === 'en' ? 'Upcoming' : 'Em breve');
      await expect(page.locator('#networks')).toContainText(locale === 'en' ? 'Network support varies by action.' : 'O suporte de rede varia por ação.');
      await expect(page.locator('#developers > div > a')).toHaveAttribute('href', '/docs/developer-api');
      await expect(page.locator('#documentation strong a')).toHaveAttribute('href', '/docs');
      await expect(page.locator('#documentation > a')).toHaveAttribute('href', '/login');
      const missing = await page.locator('a[href^="#"]').evaluateAll(links => links.filter(link => !document.getElementById(link.getAttribute('href')!.slice(1))).map(link => link.getAttribute('href')));
      expect(missing).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Small wheel movements move the native page immediately; no step gates.
      await hero.evaluate(element => scrollTo({ top: scrollY + element.getBoundingClientRect().top, behavior: 'instant' }));
      await page.mouse.move(width / 2, 650);
      const initial = await page.evaluate(() => scrollY);
      await page.mouse.wheel(0, 150);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(initial + 140);
      await page.locator('footer').scrollIntoViewIfNeeded();
      await expect(page.locator('footer')).toBeInViewport();
      if (process.env.FLOFI_LANDING_EVIDENCE) {
        for (const id of ['workflow', 'networks', 'demo', 'assistants', 'developers', 'about']) {
          const section = page.locator(`#${id}`); await section.scrollIntoViewIfNeeded();
          await section.screenshot({ path: `${evidence}/${id}-${locale}-${width}.png`, animations: 'disabled' });
        }
        if ([390, 1440].includes(width)) await page.screenshot({ path: `${evidence}/full-${locale}-${width}.png`, fullPage: true, animations: 'disabled' });
      }
    }
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Várias entradas.');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Live media changes notify React before its effect cancels event-driven animations.
    if (process.env.FLOFI_MOTION_EXPECT_ENABLED !== 'false') await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-alive', 'still');
    expect(await page.locator('main *').evaluateAll(items => items.flatMap(item => item.getAnimations()).length)).toBe(0);
    await expect(page.getByRole('button', { name: /pause motion|resume motion|pausar animações|retomar animações/i })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('original Earth artwork backs the complete closing section immediately before the footer', async ({ request, page }) => {
  const asset = await request.get('/flofi/closing-horizon-v2.png');
  expect(asset.ok()).toBe(true); expect(asset.headers()['content-type']).toContain('image/png');
  await page.goto('/');
  await expect(page.locator('main > section')).toHaveCount(6);
  await expect(page.locator('main > section:last-child')).toHaveAttribute('id', 'about');
  await expect(page.locator('footer [data-earth]')).toHaveCount(0);
  await expect(page.locator('#about [data-earth-original]')).toHaveAttribute('href', '/flofi/closing-horizon-v2.png');
});
