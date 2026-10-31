// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const enabled = process.env.FLOFI_MOTION_EXPECT_ENABLED !== 'false';
const widths = [320, 375, 390, 430, 768, 1024, 1440, 1920];
const errors = new WeakMap<Page, string[]>();
const evidence = 'e2e/visual-evidence/build-brand-motion-001';

test.beforeEach(async ({ context, page, baseURL }) => {
  const failures: string[] = [];
  errors.set(page, failures);
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === new URL(baseURL!).origin) await route.continue();
    else { failures.push(`External request: ${route.request().url()}`); await route.abort(); }
  });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function overflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function clearIntro(page: Page) {
  await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-intro', /playing|complete|skipped/);
  const skip = page.getByRole('button', { name: 'Skip intro', exact: true });
  if (await skip.isVisible()) await skip.click();
  await expect(skip).toHaveCount(0);
}
async function activeScene(page: Page, scene: string, index = 0) {
  const docks = page.locator(`[data-mascot-dock="${scene}"]`);
  const dock = await docks.all();
  const visible = [];
  for (const item of dock) if (await item.isVisible()) visible.push(item);
  const destination = visible[index]!;
  await destination.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(destination).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-mascot-journey]')).toHaveAttribute('data-scene', scene);
  return destination;
}

for (const width of widths) {
  test(`official mascot journey and usable landing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Many ways in.');
    await expect(page.getByRole('link', { name: 'Launch Beta FloFi', exact: true })).toBeVisible();
    if (!enabled) {
      await expect(page.locator('[data-mascot-dock], [data-mascot-journey]')).toHaveCount(0);
      await page.getByRole('link', { name: 'Networks', exact: true }).first().click();
      await expect(page).toHaveURL(/#networks$/);
      await overflow(page);
      return;
    }
    await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-intro', 'playing');
    const duration = await page.locator('[data-mascot-body]').evaluateAll(elements => elements.flatMap(element => element.getAnimations().filter(animation => animation.effect?.getTiming().duration === (innerWidth <= 760 ? 1800 : 2600)).map(animation => animation.effect!.getTiming().duration)));
    expect(duration).toContain(width <= 760 ? 1800 : 2600);
    const introBody = page.locator(width <= 760 ? '[data-mascot-dock="hero"] [data-mascot-body]' : '[data-mascot-traveler] [data-mascot-body]');
    const firstPose = await introBody.evaluate(element => getComputedStyle(element).transform);
    const headlineBox = await page.getByRole('heading', { level: 1 }).boundingBox();
    await expect.poll(() => introBody.evaluate(element => getComputedStyle(element).transform)).not.toBe(firstPose);
    expect(await page.getByRole('heading', { level: 1 }).boundingBox()).toEqual(headlineBox);
    // Navigation and CTAs remain available during the intro; no dialog or loading screen.
    const launch = page.getByRole('link', { name: 'Launch Beta FloFi', exact: true });
    await launch.focus();
    await expect(launch).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (process.env.FLOFI_MOTION_EVIDENCE && [390,1440].includes(width)) await page.screenshot({ path: `${evidence}/intro-${width}.png` });
    await clearIntro(page);
    await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-intro', 'complete');
    for (const scene of ['hero', 'networks', 'infrastructure', 'cta']) {
      const dock = await activeScene(page, scene);
      // A character is actually painted at the dock, not only a state flag on an empty illustration.
      const character = width <= 760 ? dock.locator('[data-mascot-character]') : page.locator('[data-mascot-traveler] [data-mascot-character]');
      await expect(character).toBeVisible();
      await expect.poll(async () => {
        const target = (await dock.locator('[data-mascot-perch]').boundingBox())!;
        const actual = (await character.boundingBox())!;
        return Math.hypot(actual.x - target.x, actual.y - target.y);
      }).toBeLessThan(12);
      await overflow(page);
      if (process.env.FLOFI_MOTION_EVIDENCE && ['hero', 'networks', 'infrastructure', 'cta'].includes(scene) && [390,768,1440].includes(width)) {
        await page.screenshot({ path: `${evidence}/${scene}-${width}.png`, animations: 'disabled' });
      }
    }
    await expect(page.locator(width <= 760 ? '[data-mascot-dock="cta"] [data-mascot-character]' : '[data-mascot-traveler] [data-mascot-character]')).toHaveAttribute('data-variant', 'white');
    const cta = page.locator('#about [data-mascot-cta]');
    await cta.scrollIntoViewIfNeeded();
    await cta.focus();
    await expect(cta).toBeFocused();
    const reachable = await cta.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    });
    expect(reachable).toBe(true);
    await expect(cta).toHaveAttribute('href', '/login');
    await expect(page.getByRole('button', { name: 'Authorize workflow', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-story-phase="Review"]')).toContainText('Your explicit approval');
    await expect(page.locator('[data-story-phase="Execute"]')).toContainText('Your wallet signature');
    await expect(page.locator('main')).not.toContainText(/devnet|testnet|mock|sandbox|synthetic/i);
    await expect(page.locator('#networks')).toContainText('Upcoming');
    // Both original official mascot assets remain available to every character.
    const images = await page.locator('[data-mascot-body] img').evaluateAll(items => [...new Set(items.map(item => item.getAttribute('src')))].sort());
    expect(images).toEqual(['/brand/flofi-symbol-dark.svg', '/brand/flofi-symbol-light.svg']);
  });
}

test('intro plays once per tab, remains skippable and does not replay on navigation', async ({ page }) => {
  test.skip(!enabled, 'Flag-off has no intro.');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Skip intro', exact: true })).toBeVisible();
  await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-intro', 'complete', { timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Skip intro', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-intro', 'skipped');
  await page.getByRole('link', { name: 'Networks', exact: true }).first().click();
  await expect(page).toHaveURL(/#networks$/);
  await page.getByRole('link', { name: 'FloFi home', exact: true }).first().click();
  await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-intro', 'skipped');
});

test('pointer reactions, explicit workflow authorization without a pause control', async ({ page }) => {
  test.skip(!enabled, 'Flag-off has no character interactions.');
  await page.goto('/');
  await clearIntro(page);
  const hero = await activeScene(page, 'hero');
  await expect(page.locator('[data-mascot-traveler] [data-mascot-character]')).toHaveAttribute('data-state', 'idle');
  await page.mouse.move(0, 0); // Leave the card after activeScene's initial hover.
  await page.waitForTimeout(1600); // Deliberate interaction cooldown, not an animation-completion assertion.
  await hero.hover();
  await expect(page.locator('[data-mascot-traveler] [data-mascot-character]')).toHaveAttribute('data-state', 'look');
  const story = page.locator('#workflow');
  await story.scrollIntoViewIfNeeded();
  await expect(story.locator('[data-story-phase]')).toHaveCount(3);
  for (const card of await story.locator('[data-story-phase]').all()) {
    await expect(card).toHaveAttribute('data-story-seen', 'true');
    await expect(card.locator('[data-mascot-local] [data-mascot-character]')).toBeVisible();
  }
  await expect(story).toContainText('Your explicit approval');
  await expect(story).toContainText('Your wallet signature');
  await expect.poll(() => story.locator('[data-mascot-local] [data-mascot-body]').evaluateAll(items => items.every(item => item.getAnimations().every(animation => animation.playState === 'finished')))).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await expect(page.getByRole('button', { name: /pause motion|resume motion|pausar animações|retomar animações/i })).toHaveCount(0);
  await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-alive', 'running');
  await expect(page.locator('[data-mascot-journey] button')).toHaveCount(0);
});

test('reduced motion, live preference changes and PT presentation', async ({ page }) => {
  test.skip(!enabled, 'Flag-off has no character animations.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-alive', 'still');
  await expect(page.getByRole('button', { name: 'Skip intro', exact: true })).toHaveCount(0);
  expect(await page.locator('[data-mascot-body], [data-mascot-shadow]').evaluateAll(items => items.reduce((count, item) => count + item.getAnimations().length, 0))).toBe(0);
  await page.getByRole('button', { name: 'PT', exact: true }).click();
  await expect(page.locator('#workflow')).toContainText('Sua aprovação explícita');
  await expect(page.locator('main')).not.toContainText(/devnet|testnet|mock|sandbox|synthetic/i);
  await overflow(page);
  if (process.env.FLOFI_MOTION_EVIDENCE) await page.screenshot({ path: `${evidence}/reduced-motion-1440.png` });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-alive', 'running');
  await expect(page.getByRole('button', { name: /pausar animações|retomar animações/i })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-alive', 'still');
  expect(await page.locator('[data-mascot-body], [data-mascot-shadow]').evaluateAll(items => items.reduce((count, item) => count + item.getAnimations().length, 0))).toBe(0);
});

test('official artwork remains byte identical to verified source assets', async ({ request }) => {
  for (const variant of ['light', 'dark']) {
    const asset = await request.get(`/brand/flofi-symbol-${variant}.svg`);
    expect(asset.ok()).toBe(true);
    expect(await asset.body()).toEqual(await readFile(`public/brand/flofi-symbol-${variant}.svg`));
  }
});

test('scroll skips intro, keyboard controls and mobile workflow stay usable', async ({ page }) => {
  test.skip(!enabled, 'Flag-off has no motion controls.');
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Skip intro', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  // Existing skip-to-content remains the first focus target during the nonblocking intro.
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await page.evaluate(() => scrollTo(0, 500));
  await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-intro', 'complete');
  await expect(page.getByRole('button', { name: 'Skip intro', exact: true })).toHaveCount(0);
  for (let index = 0; index < 3; index++) {
    const card = page.locator('#workflow [data-story-phase]').nth(index);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute('data-story-seen', 'true');
    const dock = card.locator('[data-mascot-local]');
    await expect(dock.locator('[data-mascot-character]')).toBeVisible();
    await overflow(page);
  }
  await expect(page.locator('[data-story-phase="Review"]')).toContainText('Your explicit approval');
  await expect(page.locator('[data-story-phase="Execute"]')).toContainText('Your wallet signature');
  await expect(page.getByRole('button', { name: 'Authorize workflow', exact: true })).toHaveCount(0);
});
