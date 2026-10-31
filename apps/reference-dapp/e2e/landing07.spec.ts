// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-LANDING07-README-001: Caio's Landing 07 at `/`, exactly as delivered. The only integration changes are the route, the
 * locally served display font and the destination of the eight product-entry links (`/login`, PR #143's entry flow). These tests check
 * the delivered page as it is; they do not ask it to change.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** Read-only and closed: any request outside the app's own origin fails the test (the default and the motion configs alike). */
const test = base.extend<{ guard: string[] }>({
  guard: [async ({ context, baseURL }, use) => {
    const unexpected: string[] = [];
    await context.route('**/*', async route => {
      let origin = '';
      try { origin = new URL(route.request().url()).origin; } catch { /* invalid URL is refused */ }
      if (origin === new URL(baseURL!).origin) await route.continue(); else { unexpected.push(route.request().url()); await route.abort('blockedbyclient'); }
    });
    await use(unexpected);
    expect(unexpected).toEqual([]);
  }, { auto: true }],
});
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }); });

const widths = [320, 375, 390, 430, 768, 1024, 1440, 1920];
// SHA256SUMS.txt of FloFi-Landing-07-Alrimar-2026-10-30.zip (COPY_INTO_REPO and BRAND_REFERENCE): served bytes must stay the package's.
const PACKAGE_ASSETS: Record<string, string> = {
  '/landing07/bubble-reference-v2.png': 'bed026403c94af2ffe67d44416910713d5b12c511a0847ca44e49eeb5148132f',
  '/landing07/clock.webp': 'dbaec3dc60229b75101f5cff2ee2ad11260c3be33aba794c2dd6d93d6648d396',
  '/landing07/mascot-reference-v2.png': 'ac3e12093be0c56345e553d0a43d821a627fb78cb83bd29af3f4b8d64ce2ffcf',
  '/landing07/ribbon-reference-v2.png': '2b0acc79dd59b22bf0fdc504a2286c0b2d65123323f9e187ed91f31f263af14f',
  '/landing07/strategy-sculpture.png': '012891ec99dd89e1a25c5865ad5b64f24ae3ace1ae0e8337f0232d1b0ea4a292',
  '/landing07/swap-sculpture.png': '141465f1157e8947a61eb43ce5b7c832173db113883d6bad348baf59d0fd3278',
  '/landing07/transfer-sculpture.png': '268496fb033fe319783e7ffda5417bf8a5fec9a364f7b190e91e6c3b7d5e64a9',
  '/brand/crypto/ethereum.svg': '86ba3592277849e5bf173705788634e35ee202600cf6e6c029e0fe6b9f1b3eb6',
  '/brand/crypto/usdc.png': '6d14601d0b1109046e366592b8c0f256ffb075f69180b65dddd97ae665d49f9e',
  '/brand/flofi-symbol-dark.svg': '3ad472fc52de192b43a0da61c48cf2a0b2515d84c65ef3341b5451f4e363111b',
  '/brand/flofi-symbol-light.svg': 'fa3865d2b9078a2f8830f9c2ad0d7beeecca823930eb40ca0b68e1ec95b818b6',
  '/brand/flofi-wordmark-dark.png': 'f7d8eb5f3a6190fdbd5fdeed352380f05b33c977644cdcfbac09f9ac5833c5bc',
  '/brand/flofi-wordmark-light.png': '37c278ef3380e8d201161c57a94221f2245b812a1c5a27f9be50ffaa5f24da69',
};
// The eight links the package sent to `/app`, by accessible name; each now opens sign-in.
const ENTRY_LINKS = {
  pt: ['Começar com FloFi', 'Explorar o produto', 'ABRIR FLOFI', 'Explorar trocas no FloFi', 'Explorar transferências no FloFi', 'Explorar estratégias no FloFi', 'Abrir o FloFi'],
  en: ['Start with FloFi', 'Explore the product', 'LAUNCH APP', 'Explore swaps in FloFi', 'Explore transfers in FloFi', 'Explore strategies in FloFi', 'Open FloFi'],
};

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || /hydration|did not match/i.test(message.text())) errors.push(message.text()); });
  return errors;
}
const noOverflow = (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
const stage = (page: Page) => page.locator('[data-demo-stage]').getAttribute('data-demo-stage');

for (const width of widths) {
  test(`Landing 07 renders, links and switches language at ${width}px`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/'); await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveTitle('FloFi — DeFi sem complicação');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('FLOFI');
    // The landing declares its language on its own root. On first load the document element keeps the root layout's language (the
    // package's documented limit, VALIDACAO_E_LIMITES.md); it follows the landing once the visitor switches.
    await expect(page.locator('.landing07-fonts > div')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.locator('.app-shell')).toHaveCount(0);
    for (const heading of ['DeFi sem complicação.', 'Da conversa à estratégia.', 'PRONTO PARA COMEÇAR?']) await expect(page.getByRole('heading', { name: heading })).toHaveCount(1);
    await expect(page.locator('main')).not.toContainText(/devnet|testnet|sepolia|mock|sandbox|synthetic|test.funds/i);
    // Destinations: product entry through sign-in, documentation, the owner's contact, in-page anchors.
    await expect(page.locator('a[href="/app"]')).toHaveCount(0);
    await expect(page.locator('a[href="/login"]')).toHaveCount(8);
    await expect(page.locator('a[href="/docs"]')).toHaveCount(2);
    for (const external of await page.locator('a[href^="http"]').all()) {
      await expect(external).toHaveAttribute('href', 'https://x.com/FloFi_xyz');
      await expect(external).toHaveAttribute('target', '_blank');
      await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
    }
    const missing = await page.locator('a[href^="#"]').evaluateAll(links => links.filter(link => !document.getElementById(link.getAttribute('href')!.slice(1))).map(link => link.getAttribute('href')));
    expect(missing).toEqual([]);
    await page.locator('img').evaluateAll(images => images.forEach(image => { (image as HTMLImageElement).loading = 'eager'; }));
    await expect.poll(() => page.locator('img').evaluateAll(images => images
      .filter(image => !(image as HTMLImageElement).complete || (image as HTMLImageElement).naturalWidth === 0).map(image => image.getAttribute('src')))).toEqual([]);
    await expect(page.locator('header a[href="/login"]')).toBeVisible();
    await noOverflow(page);
    // The PT/EN switch changes only the landing, and the choice survives a reload.
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'DeFi, made clearer.' })).toHaveCount(1);
    await page.reload(); await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { name: 'From conversation to strategy.' })).toHaveCount(1);
    await expect(page.locator('.landing07-fonts > div')).toHaveAttribute('lang', 'en');
    await noOverflow(page);
    await page.getByRole('button', { name: 'PT', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    expect(errors).toEqual([]);
  });
}

test('every product-entry link opens sign-in, and the builder stays reachable without an account', async ({ page }) => {
  await page.goto('/');
  for (const name of ENTRY_LINKS.pt) for (const link of await page.getByRole('link', { name, exact: true }).all()) await expect(link).toHaveAttribute('href', '/login');
  expect(await page.getByRole('link', { name: 'Começar com FloFi', exact: true }).count()).toBe(2); // header and hero
  await page.locator('main').getByRole('link', { name: 'Começar com FloFi', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await page.getByRole('link', { name: 'Explore the builder without an account', exact: true }).click();
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  for (const name of ENTRY_LINKS.en) for (const link of await page.getByRole('link', { name, exact: true }).all()) await expect(link).toHaveAttribute('href', '/login');
  await page.getByRole('link', { name: 'Open FloFi', exact: true }).last().click();
  await expect(page).toHaveURL('/login');
});

test('Docs opens the documentation and /app, /login and /docs keep their own pages and fonts', async ({ page }) => {
  await page.goto('/');
  await page.locator('footer').getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole('heading', { name: 'Documentation', exact: true })).toBeVisible();
  for (const path of ['/app', '/login', '/docs']) {
    expect((await page.goto(path))?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'FLOFI', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => [...document.fonts].some(face => face.family.replaceAll('"', '') === 'Anton'))).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Outfit');
  }
});

test('keyboard: skip link, language group and FAQ disclosures', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(page.getByRole('group', { name: 'Idioma' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PT', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const faq = page.locator('#faq details');
  await expect(faq).toHaveCount(4);
  const first = faq.first();
  await first.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('open', '');
  await expect(first).toContainText('O FloFi é uma interface para estruturar, revisar e simular fluxos DeFi.');
});

test('reduced motion: every block is visible, the illustrative demo shows its last frame and the ribbon stays still', async ({ page }) => {
  await page.goto('/');
  await page.locator('#como-funciona').scrollIntoViewIfNeeded();
  await expect.poll(() => stage(page)).toBe('6');
  const demo = page.getByRole('group', { name: 'Demonstração ilustrativa do FloFi' });
  await expect(demo).toContainText('DEMONSTRAÇÃO ILUSTRATIVA');
  await expect(demo).toContainText('A autorização só ocorre no aplicativo, após sua revisão. Esta cena é ilustrativa.');
  for (const block of await page.locator('[data-landing07-reveal]').all()) expect(await block.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.locator('#main > div').first().evaluate(element => (element as HTMLElement).style.getPropertyValue('--ribbon-shift'))).toBe('0px');
});

test.describe('motion allowed', () => {
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'no-preference' }); });

  test('the illustrative demo plays in view, pauses, resumes and restarts; it never connects a wallet or leaves the app origin', async ({ page }) => {
    await page.goto('/');
    expect(await stage(page)).toBe('0');
    await page.locator('#como-funciona').scrollIntoViewIfNeeded();
    await expect.poll(() => stage(page), { timeout: 15_000 }).toBe('3');
    await page.getByRole('button', { name: 'Pausar demonstração', exact: true }).click();
    const paused = await stage(page);
    await page.waitForTimeout(2_000);
    expect(await stage(page)).toBe(paused);
    await page.getByRole('button', { name: 'Continuar demonstração', exact: true }).click();
    await expect.poll(() => stage(page), { timeout: 15_000 }).toBe('6');
    await expect(page.getByRole('group', { name: 'Demonstração ilustrativa do FloFi' })).toContainText('Confira e autorize na carteira para executar.');
    await page.getByRole('button', { name: 'Reiniciar demonstração', exact: true }).click();
    await expect.poll(() => stage(page)).not.toBe('6');
    await expect.poll(() => stage(page), { timeout: 15_000 }).toBe('6');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('sections reveal while scrolling and the ribbon follows the scroll without trapping it', async ({ page }) => {
    await page.goto('/'); await page.evaluate(() => document.fonts.ready);
    const scene = page.locator('#main > div').first();
    await expect.poll(() => scene.evaluate(element => (element as HTMLElement).style.getPropertyValue('--ribbon-shift'))).toBe('0px');
    await page.mouse.wheel(0, 700);
    await expect.poll(() => scene.evaluate(element => (element as HTMLElement).style.getPropertyValue('--ribbon-shift'))).not.toBe('0px');
    for (const id of ['como-funciona', 'possibilidades', 'faq']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await expect(page.locator(`#${id}`)).toBeInViewport();
    }
    for (const block of await page.locator('[data-landing07-reveal]').all()) {
      await block.scrollIntoViewIfNeeded();
      await expect(block).toHaveAttribute('data-revealed', 'true');
    }
    await noOverflow(page);
  });
});

test('served assets are the package bytes and the display font is local to the landing', async ({ request }) => {
  for (const [path, digest] of Object.entries(PACKAGE_ASSETS)) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(createHash('sha256').update(await response.body()).digest('hex'), path).toBe(digest);
  }
  const manifest = JSON.parse(await readFile('public/fonts/landing07/manifest.json', 'utf8')) as { files: { file: string; sha256: string }[]; preload: string[] };
  for (const entry of manifest.files) {
    const response = await request.get(`/fonts/landing07/${entry.file}`);
    expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(entry.sha256);
  }
  const html = await (await request.get('/')).text();
  expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  for (const file of manifest.preload) expect(html).toContain(`/fonts/landing07/${file}`);
  const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(match => match[1]!);
  const css = (await Promise.all(sheets.map(async href => (await request.get(href)).text()))).join('\n');
  expect(css).toContain('--font-landing-display');
  for (const entry of manifest.files) expect(css).toContain(`/fonts/landing07/${entry.file}`);
});
