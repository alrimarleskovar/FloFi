// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { assertConnectedFlow } from './connected-flow-assertions';

const evidence = 'e2e/visual-evidence/cinematic-closing';
const capture = !!process.env.FLOFI_EARTH_EVIDENCE;

for (const width of [390, 768, 1440, 1920]) {
  test(`complete cinematic closing, Earth surface and accessibility at ${width}px`, async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', event => { if (event.type() === 'error' || /hydration|did not match/i.test(event.text())) errors.push(event.text()); });
    const brokenImages: string[] = [];
    page.on('response', response => { if (response.request().resourceType() === 'image' && !response.ok()) brokenImages.push(response.url()); });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => sessionStorage.setItem('flofi-alive-intro-v1', 'seen'));
    await page.goto('/'); await page.evaluate(() => document.fonts.ready);
    if (process.env.FLOFI_MOTION_EXPECT_ENABLED === 'false') {
      await expect(page.locator('[data-mascot-motion="true"], [data-mascot-journey]')).toHaveCount(0);
    }
    const footer = page.locator('footer');
    const closing = page.locator('#about');
    const earth = closing.locator('[data-earth]');
    const surface = earth.locator('[data-earth-surface]');
    await expect(earth).toHaveAttribute('data-earth-active', 'false');
    await closing.scrollIntoViewIfNeeded();
    await expect(earth).toHaveAttribute('data-earth-active', 'true');
    await expect(earth.locator('[data-earth-original]')).toHaveAttribute('href', '/flofi/closing-horizon-v2.png');
    await expect(footer.getByRole('img', { name: 'FloFi', exact: true })).toBeVisible();
    await expect(footer.getByRole('heading')).toHaveCount(0);
    expect(await page.locator('main > section').evaluateAll(items => items.map(item => item.id))).toEqual(['workflow', 'networks', 'demo', 'assistants', 'developers', 'about']);
    expect(await page.locator('main').evaluate(element => element.nextElementSibling?.tagName)).toBe('FOOTER');
    for (const locale of ['en', 'pt'] as const) {
      await page.getByRole('button', { name: locale.toUpperCase(), exact: true }).click();
      await closing.scrollIntoViewIfNeeded();
      await expect(closing.getByRole('heading', { level: 2 })).toHaveText(locale === 'en'
        ? 'Agents can understand intent.FloFi makes it executable.' : 'Agentes entendem intenções.FloFi as torna executáveis.');
      await expect(closing).toContainText(locale === 'en' ? 'THE ROAD AHEAD' : 'O PRÓXIMO PASSO');
      await expect(closing).toContainText(locale === 'en'
        ? 'A trade, a bridge, a lending strategy. The direction is one clear workflow across your crypto, with FloFi as an execution layer behind wallets, dapps and intelligent agents. Broader coverage remains on the roadmap.'
        : 'Uma troca, um bridge, uma estratégia de empréstimo. A direção é um fluxo claro entre seus ativos, com FloFi como camada de execução por trás de carteiras, dapps e agentes inteligentes. A cobertura mais ampla continua no roadmap.');
      await expect(closing).toContainText(locale === 'en' ? 'From financial intent to verifiable onchain execution.' : 'Da intenção financeira à execução onchain verificável.');
      await expect(closing.getByRole('link', { name: locale === 'en' ? 'Launch FloFi' : 'Abrir FloFi' })).toHaveAttribute('href', '/login');
      await expect(closing.getByRole('link', { name: locale === 'en' ? 'Build with FloFi' : 'Construir com FloFi' })).toHaveAttribute('href', '/docs/developer-api');
      const diagram = closing.locator('[data-flow-diagram="dark"]');
      await expect.poll(async () => { try { await assertConnectedFlow(diagram, 1); return true; } catch { return false; } }).toBe(true);
      await expect(diagram.locator('[data-flow-core] img')).toHaveAttribute('src', '/brand/flofi-symbol-dark.svg');
      await expect(diagram).toContainText(locale === 'en' ? 'Execution layer' : 'Camada de execução');
      await expect(diagram).toContainText(locale === 'en' ? 'Onchain finance' : 'Finanças onchain');
      expect(await closing.evaluate(element => {
        const section = element.getBoundingClientRect();
        const footer = document.querySelector('footer')!.getBoundingClientRect();
        const text = element.querySelector('h2')!.getBoundingClientRect();
        const diagram = element.querySelector('[data-flow-diagram]')!.getBoundingClientRect();
        return section.bottom <= footer.top + 1 && (innerWidth > 1050 ? text.right < diagram.left : text.bottom < diagram.top);
      })).toBe(true);
      expect(await closing.locator('h2, p, a').evaluateAll(items => items.every(element => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth + 1;
      }))).toBe(true);
      // Connection ports extend outside the cards; their actual content stays inside.
      expect(await diagram.locator('[data-flow-source], [data-flow-core], [data-flow-destination]').evaluateAll(items => items.every(element => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && [...element.children].filter(child => !child.hasAttribute('data-flow-port')).every(child => {
          const content = child.getBoundingClientRect();
          return content.left >= box.left && content.right <= box.right;
        });
      }))).toBe(true);
      await expect.poll(() => closing.evaluate(element => element.querySelector('[class*="closingGrid"]')!.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
      await expect(earth).toHaveAttribute('data-earth-active', 'true');
      if (capture) await closing.screenshot({ path: `${evidence}/closing-${locale}-${width}.png` });
    }
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await closing.scrollIntoViewIfNeeded();
    // Native scrolling passes through the scene; nothing intercepts wheel input.
    await closing.evaluate(element => scrollTo({ top: scrollY + element.getBoundingClientRect().top - 200, behavior: 'instant' }));
    await page.mouse.move(width / 2, 500);
    const beforeWheel = await page.evaluate(() => scrollY);
    const frameTimes = page.evaluate(() => new Promise<number[]>(resolve => {
      const times: number[] = [];
      let previous = performance.now();
      let frame = 0;
      const sample = (now: number) => {
        times.push(now - previous); previous = now;
        frame = requestAnimationFrame(sample);
      };
      const finish = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('flofi-test-scroll-finished', finish);
        resolve(times.slice(1));
      };
      window.addEventListener('flofi-test-scroll-finished', finish);
      frame = requestAnimationFrame(sample);
    }));
    // BUILD-FLOFI-UX-UI-002 (UX/UI-007): scrolling pauses the clocks but keeps every lit layer painted at its current opacity, so the
    // planet's luminance cannot jump while scrolling down, reversing or resuming (the reported flicker hid these layers while scrolling).
    const layers = () => earth.evaluate(element => [...element.querySelectorAll('[data-earth-surface], [data-earth-surface-secondary], [data-earth-lighting], [data-earth-atmosphere]')]
      .map(layer => ({ visibility: getComputedStyle(layer).visibility, opacity: Number(getComputedStyle(layer).opacity) })));
    const idle = await layers();
    expect(idle.map(layer => layer.visibility)).toEqual(['visible', 'visible', 'visible', 'visible']);
    for (const direction of [1, 1, 1, 1, 1, 1, 1, -1, -1, 1]) {
      await page.mouse.wheel(0, 20 * direction);
      await expect(earth).toHaveAttribute('data-earth-active', 'false');
      const scrolling = await layers();
      expect(scrolling.map(layer => layer.visibility)).toEqual(['visible', 'visible', 'visible', 'visible']);
      // Slow 60 s cycles move opacity by well under 0.05 in the few hundred milliseconds of this loop.
      scrolling.forEach((layer, i) => expect(Math.abs(layer.opacity - idle[i]!.opacity)).toBeLessThan(.05));
      await page.waitForTimeout(80);
    }
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(beforeWheel + 100);
    await page.evaluate(() => window.dispatchEvent(new Event('flofi-test-scroll-finished')));
    const frames = (await frameTimes).sort((a, b) => a - b);
    await expect(earth).toHaveAttribute('data-earth-active', 'true');
    await closing.scrollIntoViewIfNeeded();
    const box = (await closing.boundingBox())!;
    const layout = await closing.evaluate(element => ({ top: element.getBoundingClientRect().top + scrollY, height: element.clientHeight }));
    expect(box.width).toBe(width); expect(box.height).toBeGreaterThan(600);
    const transition = await closing.evaluate(element => ({ gradient: getComputedStyle(element).backgroundImage, precedingColor: getComputedStyle(document.querySelector('#developers')!).backgroundColor }));
    expect(transition.gradient).toContain(transition.precedingColor);
    expect(await earth.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
    expect(await earth.locator('[data-earth-original]').evaluate(element => element.getAnimations().length)).toBe(0);

    const initial = await surface.evaluate(element => ({ time: Number(element.getAnimations()[0]!.currentTime), transform: getComputedStyle(element).transform }));
    const measurements = [];
    const images: Buffer[] = [];
    if (capture) mkdirSync(evidence, { recursive: true });
    for (const seconds of [0, 5, 10]) {
      if (seconds) await expect.poll(() => surface.evaluate((element, time) => Number(element.getAnimations()[0]!.currentTime) - time, initial.time), { timeout: 13000, intervals: [100] }).toBeGreaterThanOrEqual(seconds * 1000);
      measurements.push(await surface.evaluate((element, seconds) => ({ seconds, clock: element.getAnimations()[0]!.currentTime, transform: getComputedStyle(element).transform, opacity: getComputedStyle(element).opacity }), seconds));
      images.push(await closing.screenshot(capture ? { path: `${evidence}/closing-${width}-t${seconds}.png` } : {}));
      expect(await closing.evaluate(element => ({ top: element.getBoundingClientRect().top + scrollY, height: element.clientHeight }))).toEqual(layout);
    }
    // These are actual rendered pixels at elapsed times, plus measured surface travel.
    expect(images[0]!.equals(images[1]!)).toBe(false); expect(images[1]!.equals(images[2]!)).toBe(false);
    const movement = await surface.evaluate((element, transform) => {
      const a = new DOMMatrix(transform), b = new DOMMatrix(getComputedStyle(element).transform);
      return { distance: Math.hypot(a.e - b.e, a.f - b.f), matrix: [b.a,b.b,b.c,b.d], duration: element.getAnimations()[0]!.effect!.getTiming().duration };
    }, initial.transform);
    expect(movement.distance).toBeGreaterThan(40);
    expect(movement.matrix).toEqual([1,0,0,1]); expect(movement.duration).toBe(60000);
    if (capture) {
      writeFileSync(`${evidence}/motion-${width}.json`, JSON.stringify({ width, box, measurements, movement, scrollFrames: { median: frames[Math.floor(frames.length / 2)], p95: frames[Math.floor(frames.length * .95)], max: frames.at(-1) } }, null, 2) + '\n');
      await page.screenshot({ path: `${evidence}/transition-${width}.png` });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await footer.scrollIntoViewIfNeeded();
    expect(await footer.locator('a').evaluateAll(links => links.every(link => {
      const rect = link.getBoundingClientRect();
      return rect.height >= 44 && rect.left >= 0 && rect.right <= innerWidth && link.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }))).toBe(true);
    await expect(footer.locator('a[href="/docs"]')).toHaveCount(1);
    await expect(footer.locator('a[href="https://github.com/alrimarleskovar/gryloo"]')).toHaveCount(1);
    await expect(footer.locator('a[href$="/LICENSE"]')).toHaveCount(1);
    await footer.locator('nav a').first().focus();
    await expect(footer.locator('nav a').first()).toBeFocused();
    await expect(page.getByRole('button', { name: /pause motion|resume motion/i })).toHaveCount(0);

    // Pausing visibility preserves the same animation clock; no remount or restart.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(earth).toHaveAttribute('data-earth-active', 'false');
    // CSS reports "paused" before the browser commits its pending pause task.
    // Wait for every Earth layer to settle before checking exact clock stability.
    await expect.poll(() => earth.evaluate(element => {
      const animations = element.getAnimations({ subtree: true });
      return animations.length === 4 && animations.every(animation => animation.playState === 'paused' && !animation.pending);
    })).toBe(true);
    const paused = await surface.evaluate(element => Number(element.getAnimations()[0]!.currentTime));
    await page.waitForTimeout(150);
    expect(await surface.evaluate(element => Number(element.getAnimations()[0]!.currentTime))).toBe(paused);
    await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(earth).toHaveAttribute('data-earth-active', 'true');
    await expect.poll(() => surface.evaluate(element => Number(element.getAnimations()[0]!.currentTime))).toBeGreaterThan(paused);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await expect(earth).toHaveAttribute('data-earth-active', 'false');
    const offscreen = await surface.evaluate(element => Number(element.getAnimations()[0]!.currentTime));
    await closing.scrollIntoViewIfNeeded(); await expect(earth).toHaveAttribute('data-earth-active', 'true');
    expect(await surface.evaluate(element => Number(element.getAnimations()[0]!.currentTime))).toBeGreaterThanOrEqual(offscreen);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => earth.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
    expect(await surface.evaluate(element => getComputedStyle(element).opacity)).toBe('0');
    await closing.scrollIntoViewIfNeeded();
    if (capture) await closing.screenshot({ path: `${evidence}/closing-${width}-reduced.png` });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => surface.evaluate(element => element.getAnimations().length)).toBe(1);
    await expect(earth).toHaveAttribute('data-earth-active', 'true');
    expect(errors).toEqual([]); expect(brokenImages).toEqual([]);
  });
}

test('surface passes cover the original artwork through both invisible cycle resets', async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/'); await page.locator('#about').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-earth]')).toHaveAttribute('data-earth-active', 'true');
    for (const time of [0, 15000, 29990, 30010, 45000, 59990, 60010]) {
      const coverage = await page.locator('[data-earth]').evaluate((element, time) => {
        for (const animation of element.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = time; }
        return [...element.querySelectorAll<SVGImageElement>('[data-earth-surface], [data-earth-surface-secondary]')].map(image => {
          const matrix = new DOMMatrix(getComputedStyle(image).transform);
          return {
            left: image.x.baseVal.value + matrix.e, top: image.y.baseVal.value + matrix.f,
            right: image.x.baseVal.value + image.width.baseVal.value + matrix.e,
            bottom: image.y.baseVal.value + image.height.baseVal.value + matrix.f,
            opacity: Number(getComputedStyle(image).opacity),
          };
        });
      }, time);
      for (const pass of coverage) {
        expect(pass.left).toBeLessThan(0); expect(pass.top).toBeLessThan(0);
        expect(pass.right).toBeGreaterThan(1672); expect(pass.bottom).toBeGreaterThan(941);
      }
      if (time === 29990 || time === 30010) {
        expect(coverage[1]!.opacity).toBeLessThan(.001); expect(coverage[0]!.opacity).toBeGreaterThan(.7);
      }
      if (time === 59990 || time === 60010) {
        expect(coverage[0]!.opacity).toBeLessThan(.001); expect(coverage[1]!.opacity).toBeGreaterThan(.7);
      }
      if (capture && [29990, 30010, 59990, 60010].includes(time)) {
        await page.locator('#about').screenshot({ path: `${evidence}/seam-${width}-${time}.png` });
      }
    }
  }
});

for (const width of [390, 1440]) {
  test(`closing CTAs open the product and native developer API at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => sessionStorage.setItem('flofi-alive-intro-v1', 'seen'));
    for (const [label, destination] of [['Launch FloFi', '/login'], ['Build with FloFi', '/docs/developer-api']] as const) {
      await page.goto('/');
      const link = page.locator('#about').getByRole('link', { name: label, exact: true });
      await link.scrollIntoViewIfNeeded();
      await link.focus(); await expect(link).toBeFocused();
      expect(await link.evaluate(element => {
        const box = element.getBoundingClientRect();
        return box.height >= 44 && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${destination}$`));
      await expect(page.locator(destination === '/login' ? 'h1' : '#docs-content')).toBeVisible();
    }
  });
}
