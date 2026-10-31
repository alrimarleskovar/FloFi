// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, assertNoFinancialCanvasAction, sendChatCommand } from './fixtures';
import { assertConnectedFlow } from './connected-flow-assertions';
import { openBuilder, reloadBuilder } from './build-entry-navigation';

const widths = [320, 375, 390, 430, 768, 1024, 1440];
async function noOverflow(page: import('@playwright/test').Page) {
  // Right after a client-side navigation one frame can still be mid-transition; the settled layout must not overflow.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function connectedInfrastructure(page: import('@playwright/test').Page) {
  const diagram = page.locator('[data-flow-diagram="light"]');
  await diagram.scrollIntoViewIfNeeded();
  await assertConnectedFlow(diagram);
}

for (const width of widths) {
  test(`landing, keyboard navigation and product entry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Many ways in.');
    await expect(page.locator('main')).toContainText('Strategy Manifest');
    await expect(page.locator('.app-shell')).toHaveCount(0);
    await expect(page.locator('[data-story-phase="Review"]')).toContainText('Your explicit approval');
    await expect(page.locator('[data-story-phase="Execute"]')).toContainText('Your wallet signature');
    await expect(page.getByRole('button', { name: 'Authorize workflow', exact: true })).toHaveCount(0);
    expect(await page.locator('main > section').evaluateAll(items => items.map(item => item.id))).toEqual(['workflow', 'networks', 'demo', 'assistants', 'developers', 'about']);
    await expect(page.locator('#product, #scenarios, #review')).toHaveCount(0);
    for (const channel of ['Chat', 'Canvas', 'GPT', 'Claude', 'WhatsApp', 'Telegram']) await expect(page.locator('#workflow')).toContainText(channel);
    await expect(page.locator('#evidence')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/devnet|testnet|sepolia|mock|sandbox|synthetic|simulated.only|test.funds/i);
    await expect(page.locator('a[href*="cluster=devnet"]')).toHaveCount(0);
    const networks = page.getByRole('region', { name: 'Supported networks', exact: true });
    for (const network of ['Ethereum', 'Base', 'Arbitrum', 'Solana', 'Robinhood Chain']) await expect(networks).toContainText(network);
    await expect(networks).toContainText('Tempo');
    await expect(networks).toContainText('Upcoming');
    await expect(networks).not.toContainText(/live|launched|rolling out/i);
    await expect(networks.getByRole('listitem')).toHaveCount(6);
    await page.locator('main img').evaluateAll(images => images.forEach(img => { (img as HTMLImageElement).loading = 'eager'; }));
    await expect.poll(() => page.locator('main img').evaluateAll(images => images
      .filter(img => !(img as HTMLImageElement).complete || (img as HTMLImageElement).naturalWidth === 0)
      .map(img => img.getAttribute('src')))).toEqual([]);
    await expect(page.getByRole('link', { name: 'Docs', exact: true }).first()).toHaveAttribute('href', '/docs');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    await connectedInfrastructure(page);
    await expect(page.locator('[data-flow-diagram="light"]')).toContainText('Onchain protocols');
    await noOverflow(page);
    if (process.env.FLOFI_BRAND_EVIDENCE && [320,390,768,1024,1440].includes(width)) await page.locator('[data-flow-diagram="light"]').screenshot({ path: `e2e/visual-evidence/build-brand-ux-001/after-infrastructure-${width}.png` });
    if (process.env.FLOFI_BRAND_EVIDENCE && [390,1440].includes(width)) await page.screenshot({ path: `e2e/visual-evidence/build-brand-ux-001/after-landing-${width}.png`, fullPage: true });
    if (process.env.FLOFI_BRAND_EVIDENCE && width === 1440) {
      await page.locator('#workflow').screenshot({ path: 'e2e/visual-evidence/build-brand-ux-001/after-landing-hero-1440.png' });
      await networks.screenshot({ path: 'e2e/visual-evidence/build-brand-ux-001/after-networks-1440.png' });
    }
    await page.getByRole('button', { name: 'PT', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await reloadBuilder(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Várias entradas.');
    await expect(page.locator('main')).not.toContainText(/devnet|testnet|sepolia|mock|sandbox|synthetic|fundos de teste/i);
    await expect(page.getByRole('region', { name: 'Redes compatíveis', exact: true })).toContainText('Em breve');
    await connectedInfrastructure(page);
    await expect(page.locator('[data-flow-diagram="light"]')).toContainText('Protocolos onchain');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Launch Beta FloFi', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Launch Beta FloFi', exact: true }).click();
    // BUILD-FLOFI-AUTH-WALLETS-001: the landing opens sign-in first; the builder stays reachable without an account.
    await expect(page).toHaveURL('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await noOverflow(page);
    await page.getByRole('link', { name: 'Explore the builder without an account', exact: true }).click();
    await expect(page).toHaveURL('/app');
    await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await noOverflow(page);
    expect(errors).toEqual([]);
  });
}

for (const width of [320, 375, 390, 430]) {
  test(`touch controls, proposal and wallet dismissal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await openBuilder(page);
    const tools = page.getByRole('toolbar', { name: 'Canvas tools' });
    const pool = tools.getByRole('button', { name: 'Add pool', exact: true });
    await expect(pool).toBeVisible();
    const poolBox = (await pool.boundingBox())!;
    expect(poolBox.width).toBeGreaterThanOrEqual(44);
    expect(poolBox.height).toBeGreaterThanOrEqual(44);
    expect(poolBox.x + poolBox.width).toBeLessThanOrEqual(width);
    const shortcuts = page.getByRole('navigation', { name: 'Build workspace navigation' });
    await shortcuts.getByRole('button', { name: 'Copilot', exact: true }).click();
    const input = page.getByLabel('Describe your flow');
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS('font-size', '16px');
    await input.fill('Swap 2 USDC to WETH on Base Sepolia slippage 50 bps');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    // BUILD-FLOFI-CONVERSATIONAL-001: the chat commits the request at once (no proposal to apply).
    await expect(page.getByRole('log', { name: 'Conversation' }).locator('.message').last()).toContainText('Swap added to your workflow: 2 USDC');
    await shortcuts.getByRole('button', { name: 'Canvas', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Workflow canvas', exact: true })).toBeFocused();
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    const cardBox = (await page.locator('.build-flow-surface .composer-card').boundingBox())!;
    expect(cardBox.width).toBeGreaterThanOrEqual(180);
    const utilities = tools.getByRole('group', { name: 'Workflow utilities' });
    const utilityBoxes = await utilities.getByRole('button').evaluateAll(buttons => buttons.map(button => {
      const { x, y, width, height } = button.getBoundingClientRect();
      return { x, y, width, height };
    }));
    for (let index = 1; index < utilityBoxes.length; index++) {
      const previous = utilityBoxes[index - 1]!, current = utilityBoxes[index]!;
      expect(current.y >= previous.y + previous.height || current.x >= previous.x + previous.width).toBe(true);
    }
    if (process.env.FLOFI_BRAND_EVIDENCE && [320,390].includes(width)) await page.screenshot({ path: `e2e/visual-evidence/build-brand-ux-001/after-build-${width}.png`, fullPage: true });
    await noOverflow(page);
    await page.getByRole('button', { name: 'Connect Wallet', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect a wallet', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('never approves a transaction');
    const dialogBox = (await dialog.boundingBox())!;
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Delete');
    await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(1);
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.build-flow-surface .composer-card')).toHaveClass(/active/);
    await expect(page.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
    const stages = page.getByRole('navigation', { name: 'Workflow stages' });
    await stages.getByRole('button', { name: 'Simulate', exact: true }).click();
    await expect(page.getByRole('main', { name: 'Simulation workspace', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Simulation workspace navigation', exact: true }).getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.locator('.simulation-summary')).toBeFocused();
    await noOverflow(page);
    await stages.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByRole('main', { name: 'Execution workspace', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Execution workspace navigation', exact: true }).getByRole('button', { name: 'Execution Summary', exact: true }).click();
    await expect(page.locator('.execution-summary')).toBeFocused();
    await assertNoFinancialCanvasAction(page);
    await noOverflow(page);
  });
}

test('reduced motion exposes all three workflow phases without pinning', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#workflow [data-story-phase]')).toHaveCount(3);
  for (const card of await page.locator('#workflow [data-story-phase]').all()) {
    await expect(card).toBeVisible();
    expect(await card.evaluate(element => getComputedStyle(element).position)).not.toBe('sticky');
  }
  const animated = await page.locator('main').evaluate(element => [...element.querySelectorAll('*')].filter(item => getComputedStyle(item).animationName !== 'none').length);
  expect(animated).toBe(0);
});

test('desktop workflow showcase uses the actual builder', async ({ page }) => {
  await openBuilder(page);
  await sendChatCommand(page, 'Swap 2 USDC to WETH on Base Sepolia slippage 50 bps');
  await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  if (process.env.FLOFI_BRAND_EVIDENCE) await page.screenshot({ path: 'e2e/visual-evidence/build-brand-ux-001/after-build-1440.png', fullPage: true });
});

test('desktop three-step story is readable together and scrolls naturally', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const story = page.locator('#workflow');
  const cards = story.locator('[data-story-phase]');
  expect(await cards.evaluateAll(items => items.map(item => item.getAttribute('data-story-phase')))).toEqual(['Build', 'Review', 'Execute']);
  for (const card of await cards.all()) await expect(card).toBeVisible();
  expect((await story.boundingBox())!.height).toBeLessThan(1100);
  await page.locator('#networks').scrollIntoViewIfNeeded();
  await expect(page.locator('#networks')).toBeInViewport();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await connectedInfrastructure(page);
  }
  await noOverflow(page);
});

test('all migrated product routes remain accessible and sensitive routes retain their headers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const path of ['/app', '/app/agents', '/app/credentials', '/app/dashboard',
    '/app/dashboard/runs/recovery-audit', '/app/passkeys', '/app/workflows']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /Many ways in/ })).toHaveCount(0);
  }
  for (const path of ['/approve', '/connections']) {
    const response = (await page.goto(path))!;
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(headers['cache-control']).toContain('no-store');
    await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Workflow canvas', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Authorize in wallet', exact: true })).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
