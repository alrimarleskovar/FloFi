// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { openBuilder } from './build-entry-navigation';

// BUILD-BETA-UI-001: copy and colour only. The header CTA keeps its destination.
const retiredNotice = "FloFi is currently in beta testing. Do not use real funds until the official launch announcement is published in the app and on FloFi's official social media channels.";
const betaNotice = 'FloFi Beta Mainnet — Real funds are enabled. Review every transaction before signing.';
const betaNoticePt = 'FloFi Beta Mainnet — Operações com fundos reais estão habilitadas. Revise cada transação antes de assinar.';

test('the landing header CTA reads Launch Beta FloFi on yellow and still opens the product', async ({ page }) => {
  await page.goto('/');
  const header = page.locator('header');
  const cta = header.getByRole('link', { name: 'Launch Beta FloFi', exact: true });
  await expect(cta).toHaveAttribute('href', '/login');
  expect(await cta.evaluate(element => [getComputedStyle(element).backgroundColor, getComputedStyle(element).color])).toEqual(['rgb(250, 204, 21)', 'rgb(4, 27, 61)']);
  // The hero and closing Launch buttons are separate and unchanged.
  await expect(page.locator('main').getByRole('link', { name: 'Launch FloFi', exact: true })).toHaveCount(2);
  await expect(page.locator('main').getByRole('link', { name: 'Launch Beta FloFi', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'PT', exact: true }).click();
  await expect(header.getByRole('link', { name: 'Abrir FloFi Beta', exact: true })).toHaveAttribute('href', '/login');
  await expect(page.locator('main').getByRole('link', { name: 'Abrir FloFi Beta', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await cta.click();
  // BUILD-FLOFI-AUTH-WALLETS-001: the landing opens sign-in first; the builder stays reachable without an account.
  await expect(page).toHaveURL('/login');
  await page.getByRole('link', { name: 'Explore the builder without an account', exact: true }).click();
  await expect(page).toHaveURL('/app');
});

// BUILD-FLOFI-PRODUCT-UX-001: restore the yellow Beta Mainnet notice under the header (real funds enabled, review before signing).
for (const width of [320, 1440]) {
  test(`/app shows the Beta Mainnet notice between the header and the workflow canvas at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openBuilder(page);
    await expect(page.getByText(retiredNotice)).toHaveCount(0);
    const notice = page.locator('.beta-notice');
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveText(betaNotice);
    await expect(notice).toHaveAttribute('role', 'note');
    expect(await notice.evaluate(element => [
      getComputedStyle(element).backgroundColor,
      getComputedStyle(element).color,
    ])).toEqual(['rgb(253, 230, 138)', 'rgb(20, 35, 58)']);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const top = (await page.locator('.top-bar').boundingBox())!;
    const banner = (await notice.boundingBox())!;
    const canvas = (await page.getByRole('region', { name: 'Workflow canvas', exact: true }).boundingBox())!;
    expect(banner.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
    expect(canvas.y).toBeGreaterThanOrEqual(banner.y + banner.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('toolbar', { name: 'Canvas tools' }).getByRole('button', { name: 'Add swap', exact: true })).toBeEnabled();
  });
}

test('/app Beta Mainnet notice follows the language preference', async ({ page }) => {
  await openBuilder(page);
  await expect(page.locator('.beta-notice')).toHaveText(betaNotice);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  // Settings exposes one Language switch (PT/EN are visual labels). The accessible name translates with the locale.
  await page.getByRole('switch', { name: /^(Language|Idioma)$/ }).click();
  await expect(page.locator('.beta-notice')).toHaveText(betaNoticePt);
  await page.getByRole('switch', { name: /^(Language|Idioma)$/ }).click();
  await expect(page.locator('.beta-notice')).toHaveText(betaNotice);
});
