// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { articles } from '../src/components/docs/content';

const capture = !!process.env.FLOFI_DOCS_EVIDENCE;
const evidence = 'e2e/visual-evidence/native-docs-earth';
const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, context, baseURL }) => {
  const errors: string[] = []; failures.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error' || /hydration|did not match/i.test(event.text())) errors.push(event.text()); });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

test('direct docs routes, article links, anchors and published contract are valid', async ({ page, request }) => {
  await page.goto('/docs'); await expect(page.getByRole('heading', { name: 'Documentation', exact: true })).toBeVisible();
  for (const article of articles) {
    for (const source of article.sources) expect(() => readFileSync(`../../${source}`)).not.toThrow();
    const response = await page.goto(`/docs/${article.slug}`); expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: article.title })).toBeVisible();
    await expect(page).toHaveTitle(`${article.title} · FloFi Docs`);
    await expect(page.getByRole('navigation', { name: 'Documentation', exact: true }).first().getByRole('link', { name: article.title, exact: true })).toHaveAttribute('aria-current', 'page');
    for (const section of article.sections) await expect(page.locator(`#${section.id}`)).toHaveCount(1);
    const missing = await page.locator('main a[href^="#"]').evaluateAll(links => links.filter(link => !document.getElementById(link.getAttribute('href')!.slice(1))).map(link => link.getAttribute('href')));
    expect(missing).toEqual([]);
    const nativeLinks = await page.locator('main a[href^="/docs/"]').evaluateAll(links => links.map(link => link.getAttribute('href')!));
    for (const href of nativeLinks) {
      const [path, anchor] = href.split('#');
      if (path === '/docs/api-reference.json') continue;
      const linked = articles.find(item => `/docs/${item.slug}` === path); expect(linked, href).toBeDefined();
      if (anchor) expect(linked?.sections.some(section => section.id === anchor), href).toBe(true);
    }
  }
  const contract = await request.get('/docs/api-reference.json'); expect(contract.status()).toBe(200);
  expect(await contract.json()).toEqual(JSON.parse(readFileSync('../../docs/developer/openapi.json', 'utf8')));
  const missing = await request.get('/docs/unknown-guide'); expect(missing.status()).toBe(404);
  await page.goto('/docs/supported-networks'); await expect(page.getByRole('row').filter({ hasText: 'Tempo' })).toContainText('Upcoming');
});

test('search finds article body text, supports keyboard and handles no results', async ({ page }) => {
  await page.goto('/docs');
  await expect(page.locator('[data-docs-ready]')).toHaveAttribute('data-docs-ready', 'true');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search documentation' }); await expect(dialog).toBeVisible();
  const input = dialog.getByRole('combobox'); await expect(input).toBeFocused();
  await input.fill('nonce'); await expect(dialog.getByRole('option').first()).toContainText(/Manifest|Verification/);
  await input.fill('webhook'); await expect(dialog.getByRole('option').first()).toContainText(/SDK|API/);
  await page.keyboard.press('ArrowDown'); await expect(dialog.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  const destination = await dialog.getByRole('option').nth(1).getAttribute('href');
  await page.keyboard.press('Enter'); await expect(page).toHaveURL(new RegExp(`${destination!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)); await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
  await input.fill('noresultxyz'); await expect(dialog.getByText('No matching articles')).toBeVisible(); await expect(dialog.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Search documentation', exact: true })).toBeFocused();
});

test('code copies exact source and highlighting is rendered', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/docs/typescript-sdk');
  const source = await page.locator('pre code').first().textContent();
  expect(await page.locator('pre code span').first().textContent()).toBe('import');
  await page.getByRole('button', { name: 'Copy code' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'Code copied to clipboard' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);
});

test('desktop TOC, previous/next and skip link navigate real content', async ({ page }) => {
  await page.goto('/docs/strategy-manifest');
  await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('main')).toBeFocused();
  await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'What requires a fresh review?' }).click();
  await expect(page).toHaveURL(/#invalidation$/); await expect(page.locator('#invalidation')).toBeInViewport();
  await page.getByRole('navigation', { name: 'Article navigation' }).getByRole('link', { name: /Next/ }).click();
  await expect(page).toHaveURL(/\/docs\/wallet-authorization$/);
  await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toContainText('Wallet Authorization');
});

// BUILD-FLOFI-LANDING07-README-001: Landing 07 links the native Docs from its header and footer; it has no developer-API link of its own.
test('landing uses native Docs while product entry opens sign-in', async ({ page }) => {
  await page.goto('/');
  const docs = page.getByRole('link', { name: 'Docs', exact: true }); expect(await docs.count()).toBe(2);
  for (const link of await docs.all()) await expect(link).toHaveAttribute('href', '/docs');
  await expect(page.locator('a[href="/app"]')).toHaveCount(0);
  for (const link of await page.getByRole('link', { name: /Começar com FloFi|Abrir o FloFi/ }).all()) await expect(link).toHaveAttribute('href', '/login');
  await docs.first().click(); await expect(page).toHaveURL(/\/docs$/); await expect(page.getByRole('heading', { name: 'Documentation', exact: true })).toBeVisible();
});

for (const width of [390, 768, 1440]) {
  test(`docs home and article are readable in both themes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/docs', '/docs/developer-api']) {
      await page.goto(path); await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('[data-docs-ready]')).toHaveAttribute('data-docs-ready', 'true');
      for (const theme of ['light', 'dark']) {
        const current = await page.locator('[data-docs-theme]').evaluate(element => getComputedStyle(element).colorScheme);
        if ((current ?? 'light') !== theme) await page.getByRole('button', { name: `Switch to ${theme} theme` }).click();
        await expect.poll(() => page.locator('[data-docs-theme]').evaluate(element => getComputedStyle(element).colorScheme)).toBe(theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const wrong = await page.locator('main h1, main h2, main p').evaluateAll(elements => elements.filter(element => { const rect = element.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth; }).map(element => element.textContent)); expect(wrong).toEqual([]);
        if (capture) await page.screenshot({ path: `${evidence}/${path === '/docs' ? 'docs-home' : 'docs-api'}-${theme}-${width}.png`, fullPage: true });
      }
    }
    if (width < 901) {
      await page.getByRole('button', { name: /Browse docs/ }).click();
      const drawer = page.getByRole('dialog', { name: 'Browse documentation' }); await expect(drawer).toBeVisible();
      await page.keyboard.press('Shift+Tab');
      expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await drawer.getByRole('link', { name: 'Security', exact: true }).click(); await expect(page).toHaveURL(/\/docs\/security$/); await expect(drawer).not.toBeVisible();
      await page.getByRole('button', { name: /Browse docs/ }).click(); await page.keyboard.press('Escape'); await expect(drawer).not.toBeVisible();
      await page.getByText('On this page', { exact: true }).first().click();
      await page.getByRole('navigation', { name: 'Article sections' }).getByRole('link', { name: 'Scope reads and handoffs' }).click();
      await expect(page).toHaveURL(/#data-and-identity$/); await expect(page.locator('#data-and-identity')).toBeInViewport();
    }
    await page.reload(); await expect(page.locator('[data-docs-theme]')).toHaveAttribute('data-docs-theme', 'dark');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.locator('main').evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  });
}

test('system theme, text contrast, landmarks and modal keyboard containment', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await page.goto('/docs/security');
  await expect(page.locator('[data-docs-ready]')).toHaveAttribute('data-docs-ready', 'true');
  await expect(page.locator('[data-docs-theme]')).toHaveAttribute('data-docs-theme', 'system');
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1); await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click();
    const contrast = await page.locator('[data-docs-theme]').evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => { const values = color.match(/\d+/g)!.slice(0,3).map(Number).map(v => { const s = v/255; return s <= .04045 ? s/12.92 : ((s+.055)/1.055)**2.4; }); return .2126*values[0]!+.7152*values[1]!+.0722*values[2]!; };
      const background = luminance(style.backgroundColor);
      return ['--ink','--muted','--blue'].map(token => { const foreground = document.createElement('span'); foreground.style.color = `var(${token})`; element.append(foreground); const lum = luminance(getComputedStyle(foreground).color); foreground.remove(); return (Math.max(lum, background)+.05)/(Math.min(lum,background)+.05); });
    });
    contrast.forEach(value => expect(value).toBeGreaterThanOrEqual(4.5));
  }
  await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search documentation' });
  for (let i=0;i<15;i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
});
