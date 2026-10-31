// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-UX-UI-002: community links, the "How it works" story, the "connect once, then ask" MCP section and the restored mascot journey on the real
 * landing. Read-only: every request outside the app origin is refused, nothing connects a wallet and nothing is sent.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { DEMO_CUES, DEMO_END } from '../src/components/marketing/demo-timeline';
import { landingText } from '../src/components/marketing/landing-copy';

const evidence = process.env.FLOFI_UX_EVIDENCE ? 'e2e/visual-evidence/flofi-ux-ui-002' : null;
if (evidence) mkdirSync(evidence, { recursive: true });
const SOCIAL = [
  ['x', 'https://x.com/FloFi_xyz', 'FloFi on X (opens in a new tab)', 'FloFi no X (abre em nova aba)'],
  ['discord', 'https://discord.gg/36rEhdUa', 'FloFi community on Discord (opens in a new tab)', 'Comunidade FloFi no Discord (abre em nova aba)'],
  ['linkedin', 'https://www.linkedin.com/company/flofixyz/home/', 'FloFi on LinkedIn (opens in a new tab)', 'FloFi no LinkedIn (abre em nova aba)'],
  ['telegram', 'https://t.me/FloFiAppBot', 'Chat with FloFi on Telegram (opens in a new tab)', 'Converse com a FloFi no Telegram (abre em nova aba)'],
] as const;

async function guard(page: Page, baseURL: string | undefined) {
  const external: string[] = [], actions: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error' || /hydration|did not match/i.test(event.text())) errors.push(event.text()); });
  await page.context().route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) { external.push(request.url()); return route.abort(); }
    // The landing makes no server-action or API call; record any so the demo can prove it sends nothing.
    if (request.method() !== 'GET' || request.headers()['next-action'] || new URL(request.url()).pathname.startsWith('/api/')) actions.push(`${request.method()} ${request.url()}`);
    return route.continue();
  });
  // Every storage write is recorded; the demo must add none.
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as unknown as { __storageWrites: string[] }).__storageWrites = writes;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) { writes.push(key); return original.call(this, key, value); };
    sessionStorage.setItem('flofi-alive-intro-v1', 'seen');
  });
  return { external, actions, errors };
}
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __storageWrites: string[] }).__storageWrites.filter(key => key !== 'flofi-alive-intro-v1'));

const CUE_ORDER = ['idle', ...Object.keys(DEMO_CUES)];
const CLOCK_START = new Date('2026-10-16T12:00:00Z').getTime();
type DemoSnapshot = { at: number; cue: string; state: string; stage: string; typed: number; supply: string; borrow: string; connector: string;
  supplyLine: string; borrowLine: string; simulateLine: string; thinking: string; mascot: string };

/** Records every distinct frame of the How it works stage, so a test can show that one ordered timeline drove the chat and the Canvas. */
async function recordDemo(page: Page) {
  await page.evaluate(() => {
    const store = window as unknown as { __demo: Record<string, unknown>[] };
    const stage = document.querySelector<HTMLElement>('#demo [data-demo-cue]')!;
    const attr = (selector: string, name: string) => stage.querySelector(selector)?.getAttribute(name) ?? '';
    store.__demo = [];
    const take = () => {
      const composing = attr('[data-demo-composer]', 'data-composing') === 'true';
      const dock = document.querySelector<HTMLElement>('[data-mascot-dock="demo"]');
      const character = innerWidth <= 760 ? dock?.querySelector<HTMLElement>('[data-mascot-character]') : document.querySelector<HTMLElement>('[data-mascot-traveler] [data-mascot-character]');
      const frame: Record<string, unknown> = { cue: stage.dataset.demoCue, state: stage.dataset.demoState, stage: stage.dataset.demoStage,
        typed: composing ? stage.querySelector('[data-demo-composer]')!.textContent!.length : -1,
        supply: attr('[data-demo-card="supply"]', 'data-state'), borrow: attr('[data-demo-card="borrow"]', 'data-state'), connector: attr('[data-demo-connector]', 'data-shown'),
        supplyLine: attr('[data-demo-line="supply"]', 'data-status'), borrowLine: attr('[data-demo-line="borrow"]', 'data-status'),
        simulateLine: attr('[data-demo-line="simulate"]', 'data-status'), thinking: attr('[data-demo-thinking]', 'data-shown'),
        mascot: dock?.dataset.active === 'true' ? character?.dataset.state ?? '' : 'inactive' };
      const last = store.__demo.at(-1);
      if (!last || Object.entries(frame).some(([key, value]) => last[key] !== value)) store.__demo.push({ at: performance.now(), ...frame });
    };
    take();
    new MutationObserver(take).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['data-demo-cue', 'data-demo-state', 'data-state', 'data-status', 'data-shown', 'data-composing', 'data-active'] });
  });
}
const recorded = (page: Page) => page.evaluate(() => (window as unknown as { __demo: unknown[] }).__demo) as Promise<DemoSnapshot[]>;

function expectOneSynchronizedStory(frames: DemoSnapshot[], promptLength: number) {
  const played = frames.filter(frame => frame.state !== 'static');
  // Every cue once, in the owner order: one timeline, never two overlapping or restarting ones.
  expect(played.map(frame => frame.cue).filter((cue, i, all) => cue !== all[i - 1])).toEqual(CUE_ORDER);
  // The request is typed character by character into the composer.
  const typed = played.map(frame => frame.typed).filter(length => length >= 0);
  expect(typed[0]).toBeLessThanOrEqual(2);
  expect(typed.at(-1)).toBe(promptLength);
  expect(typed.every((length, i) => i === 0 || length >= typed[i - 1]!)).toBe(true);
  expect(new Set(typed).size).toBeGreaterThan(25);
  expect(played.some(frame => frame.thinking === 'true')).toBe(true);
  for (const frame of played) {
    // Each chat update and its Canvas change are one frame.
    expect(frame.supplyLine !== 'pending', JSON.stringify(frame)).toBe(frame.supply !== 'hidden');
    expect(frame.borrowLine !== 'pending', JSON.stringify(frame)).toBe(frame.borrow !== 'hidden');
    expect(frame.simulateLine === 'active', JSON.stringify(frame)).toBe(frame.stage === 'simulate');
    if (frame.connector === 'true') expect(frame.borrow, JSON.stringify(frame)).toBe('shown');
  }
}

for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
  test(`community links near the hero CTAs and in the footer are recognizable, safe and usable at ${width}px (EN/PT)`, async ({ page, baseURL }) => {
    const seen = await guard(page, baseURL);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/'); await page.evaluate(() => document.fonts.ready);
    for (const locale of ['en', 'pt'] as const) {
      await page.getByRole('button', { name: locale.toUpperCase(), exact: true }).click();
      for (const area of ['hero', 'footer'] as const) {
        const group = page.locator(`[data-social-links="${area}"]`);
        await group.scrollIntoViewIfNeeded();
        // Icons only: no visible label and no space left for one, but the list keeps its localized accessible name.
        await expect(group.getByRole('list', { name: locale === 'en' ? 'FloFi community' : 'Comunidade FloFi', exact: true })).toBeVisible();
        expect((await group.innerText()).trim()).toBe('');
        await expect(group.locator(':scope > :not(ul)')).toHaveCount(0);
        for (const [id, href, en, pt] of SOCIAL) {
          const link = group.getByRole('link', { name: locale === 'en' ? en : pt, exact: true });
          await expect(link).toHaveAttribute('href', href);
          await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
          await expect(link).toHaveAttribute('target', '_blank');
          await expect(link.locator('img')).toHaveJSProperty('complete', true);
          expect(await link.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
          expect(await link.evaluate(element => {
            const box = element.getBoundingClientRect();
            return box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= innerWidth && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          }), `${area} ${id}`).toBe(true);
        }
        // Distinct from the product CTAs: no button styling, never inside the CTA row.
        expect(await group.evaluate(element => !element.closest('[class*="heroActions"]') && !element.querySelector('[class*="primaryButton"], [class*="secondaryButton"]'))).toBe(true);
      }
      // Balanced beside the hero CTAs: centred on them when on one line; when wrapped below, the first mark lines up with their edge.
      const balance = await page.locator('#workflow [class*="heroCtaRow"]').evaluate(row => {
        const actions = row.querySelector('[class*="heroActions"]')!.getBoundingClientRect(), list = row.querySelector('[data-social-links] ul')!.getBoundingClientRect();
        const mark = row.querySelector('[data-social-mark="x"]')!.getBoundingClientRect();
        return { wrapped: list.top >= actions.bottom, centre: Math.abs((list.top + list.bottom) / 2 - (actions.top + actions.bottom) / 2), gap: mark.left - actions.right, edge: Math.abs(mark.left - actions.left) };
      });
      if (balance.wrapped) expect(balance.edge, JSON.stringify(balance)).toBeLessThanOrEqual(1);
      else { expect(balance.centre, JSON.stringify(balance)).toBeLessThanOrEqual(2); expect(balance.gap, JSON.stringify(balance)).toBeGreaterThanOrEqual(20); expect(balance.gap, JSON.stringify(balance)).toBeLessThanOrEqual(40); }
      // Keyboard order: the hero CTAs, then the community links.
      await page.locator('#workflow').getByRole('link', { name: locale === 'en' ? /Explore Docs/ : /Explorar Docs/ }).focus();
      await page.keyboard.press('Tab');
      await expect(page.locator('[data-social-links="hero"] a[data-social="x"]')).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (evidence && [390, 1440].includes(width)) {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.locator('#workflow').screenshot({ path: `${evidence}/hero-social-${locale}-${width}.png`, animations: 'disabled' });
        await page.locator('footer').screenshot({ path: `${evidence}/footer-social-${locale}-${width}.png`, animations: 'disabled' });
      }
    }
    expect(seen.external).toEqual([]); expect(seen.errors).toEqual([]);
  });
}

for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
  test(`the MCP section is one compact card, connect beside ask, readable with usable controls at ${width}px (EN/PT, Claude and ChatGPT)`, async ({ page, baseURL }) => {
    const seen = await guard(page, baseURL);
    // The complete final frame (reduced motion) so every message is laid out.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.goto('/'); await page.evaluate(() => document.fonts.ready);
    const section = page.locator('#assistants');
    for (const locale of ['en', 'pt'] as const) {
      await page.getByRole('button', { name: locale.toUpperCase(), exact: true }).click();
      for (const host of ['Claude', 'ChatGPT'] as const) {
        await section.getByRole('tab', { name: host }).click();
        await section.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await expect(section.locator('[data-assistant-step]')).toHaveAttribute('data-assistant-step', '4');
        const layout = await section.evaluate(element => {
          const panel = element.querySelector('[class*="assistantPanel"]')!.getBoundingClientRect();
          const connect = element.querySelector('[class*="assistantConnect"]')!.getBoundingClientRect(), chat = element.querySelector('[data-assistant-step]')!.getBoundingClientRect();
          const shown = [...element.querySelectorAll<HTMLElement>('[class*="assistantPanel"] :is(h3, p, li, button, code, strong, span)')].filter(item => item.getBoundingClientRect().width > 0 && item.closest('[data-shown="false"]') === null);
          const outside = shown.filter(item => { const box = item.getBoundingClientRect(); return box.left < panel.left - 1 || box.right > panel.right + 1 || box.top < panel.top - 1 || box.bottom > panel.bottom + 1; }).map(item => item.textContent!.slice(0, 40));
          const clipped = shown.filter(item => item.scrollWidth > item.clientWidth + 1 && getComputedStyle(item).overflowX !== 'visible').map(item => item.textContent!.slice(0, 40));
          const code = element.querySelector('code')!;
          const title = element.querySelector('h2')!.getBoundingClientRect(), dock = element.querySelector('[data-mascot-dock]')?.getBoundingClientRect();
          const targets = [...element.querySelectorAll<HTMLElement>('[role="tab"], [class*="assistantUrl"] button')].map(item => {
            const box = item.getBoundingClientRect();
            return box.height >= 44 && box.width >= 44 && item.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          });
          return { outside, clipped, targets, height: element.getBoundingClientRect().height, cards: element.querySelectorAll('[class*="assistantPanel"]').length,
            url: code.textContent, urlOneLine: code.getBoundingClientRect().height < 40, sideBySide: connect.right <= chat.left + 1 && Math.abs(connect.top - chat.top) < 2,
            stacked: connect.bottom <= chat.top + 1, mascotClear: !dock || dock.width === 0 || dock.right <= title.left || dock.left >= title.right || dock.bottom <= title.top || dock.top >= title.bottom,
            mascotInside: !dock || (dock.left >= 0 && dock.right <= innerWidth), overflow: document.documentElement.scrollWidth > innerWidth };
        });
        const label = `${locale} ${host}`;
        expect(layout.outside, label).toEqual([]);
        expect(layout.clipped, label).toEqual([]);
        expect(layout.targets, label).toEqual([true, true, true]);
        expect(layout.cards, label).toBe(1);
        expect(layout.url, label).toBe('https://flofi.xyz/api/mcp');
        expect(layout.urlOneLine, label).toBe(true);
        expect(width >= 1024 ? layout.sideBySide : layout.stacked, label).toBe(true);
        expect(layout.mascotClear && layout.mascotInside, label).toBe(true);
        expect(layout.overflow, label).toBe(false);
        // Much shorter than the documentation-style section it replaces (1,425px at 1440px; 2,171px at 390px).
        expect(layout.height, label).toBeLessThanOrEqual(width >= 1024 ? 760 : width >= 600 ? 1_050 : 1_250);
        if (evidence && [390, 1440].includes(width) && (locale === 'en' || host === 'Claude')) await section.screenshot({ path: `${evidence}/assistants-${host.toLowerCase()}${locale === 'pt' ? '-pt' : ''}-${width}.png` });
        if (evidence && width === 320 && locale === 'en' && host === 'ChatGPT') await section.screenshot({ path: `${evidence}/assistants-chatgpt-320.png` });
      }
    }
    expect(seen.actions).toEqual([]); expect(seen.external).toEqual([]); expect(seen.errors).toEqual([]);
  });
}

test.describe('motion allowed', () => {
  test.use({ reducedMotion: 'no-preference' });

  for (const width of [390, 1440]) {
    test(`How it works plays one synchronized story in real time: typed request, FloFi thinks and answers while the Canvas builds, simulates and reaches Execute at ${width}px`, async ({ page, baseURL }) => {
      test.setTimeout(75_000);
      const seen = await guard(page, baseURL);
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await page.goto('/'); await page.evaluate(() => document.fonts.ready);
      const demo = page.locator('#demo'), stage = demo.locator('[data-demo-cue]');
      // Until it is seen, it waits on an empty chat and an empty Canvas.
      await expect(stage).toHaveAttribute('data-demo-cue', 'idle');
      await expect(stage).toHaveAttribute('data-demo-state', 'waiting');
      await expect(demo.locator('[data-demo-card][data-state="hidden"]')).toHaveCount(2);
      await recordDemo(page);
      const dock = demo.locator('[data-mascot-dock="demo"]');
      await dock.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await expect(stage).toHaveAttribute('data-demo-state', 'playing');
      await expect(dock).toHaveAttribute('data-active', 'true');
      await expect(stage).toHaveAttribute('data-demo-cue', 'done', { timeout: DEMO_END + 10_000 });
      const frames = await recorded(page);
      expectOneSynchronizedStory(frames, landingText.en.demoPrompt.length);
      // Natural, readable timing: the full story takes its scripted time, not a flash.
      const played = frames.filter(frame => frame.state === 'playing' || frame.state === 'done');
      expect(played.at(-1)!.at - played[0]!.at).toBeGreaterThanOrEqual(DEMO_END - 100);
      expect(played.at(-1)!.at - played[0]!.at).toBeLessThan(DEMO_END + 5_000);
      // The existing mascot controller reacted to the story: the jump is requested only when the workflow is ready.
      expect(frames.slice(frames.findIndex(frame => frame.cue === 'ready')).some(frame => frame.mascot === 'jump')).toBe(true);
      // The final state stays; it never loops.
      await page.waitForTimeout(1_500);
      await expect(stage).toHaveAttribute('data-demo-cue', 'done');
      await expect(stage).toHaveAttribute('data-demo-state', 'done');
      const execute = demo.locator('[data-panel="execute"]');
      await expect(execute).toBeVisible();
      for (const step of ['Strategy review', 'Wallet authorization', 'Execution', 'Status and reconciliation']) await expect(execute).toContainText(step);
      await expect(execute.locator('li[data-status="active"]')).toHaveCount(0);
      await expect(demo.locator('[data-demo-card][data-state="shown"]')).toHaveCount(2);
      const cta = demo.getByRole('link', { name: /Try it in FloFi/ });
      await expect(cta).toBeVisible(); await expect(cta).toHaveAttribute('href', '/login');
      await expect(demo.getByRole('button', { name: 'Replay the illustration' })).toBeVisible();
      await expect(demo).toContainText('No wallet is connected and nothing is sent.');
      await expect(demo.locator('[data-demo-card="borrow"]')).toContainText('Borrowing limit checked in simulation');
      // Truthful: no input, no request or server action, no storage, no invented number, hash or outcome.
      const text = await stage.innerText();
      expect(text).not.toMatch(/0x[0-9a-f]{6,}|\bAPY\b|%|confirmed|success|\bexecuted\b|\bcompleted?\b|receipt|\bhash\b|balance|health factor|\$\s?\d|\d{1,2}:\d{2}/i);
      expect(new Set(text.match(/\d+/g))).toEqual(new Set(['1', '2', '3', '4', '500']));
      await expect(demo.locator('input, textarea, form, select, iframe')).toHaveCount(0);
      expect(seen.actions).toEqual([]); expect(await writes(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(seen.external).toEqual([]); expect(seen.errors).toEqual([]);
    });

    test(`the MCP section plays its short conversation once, switches assistants by keyboard and copies the real URL at ${width}px`, async ({ page, context, baseURL }) => {
      const seen = await guard(page, baseURL);
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL! });
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await page.goto('/'); await page.evaluate(() => document.fonts.ready);
      const section = page.locator('#assistants'), chat = section.locator('[data-assistant-step]');
      await expect(chat).toHaveAttribute('data-assistant-step', '0');
      // Record every step with whether the "working" dots and the answer are shown, to prove one ordered, finite sequence.
      await page.evaluate(() => {
        const store = window as unknown as { __steps: string[] };
        const element = document.querySelector<HTMLElement>('#assistants [data-assistant-step]')!;
        store.__steps = [];
        const take = () => {
          const shown = [...element.querySelectorAll<HTMLElement>('ol > li, ol > li > span')].filter(item => item.dataset.shown === 'true').map(item => item.className.match(/(demoUser|demoThinking|assistantReply|assistantHandoff)/)?.[1]).filter(Boolean).join('+');
          const entry = `${element.dataset.assistantStep}:${shown}`;
          if (store.__steps.at(-1) !== entry) store.__steps.push(entry);
        };
        take();
        new MutationObserver(take).observe(element, { subtree: true, attributes: true, attributeFilter: ['data-assistant-step', 'data-shown'] });
      });
      await chat.scrollIntoViewIfNeeded();
      await expect(chat).toHaveAttribute('data-assistant-step', '4', { timeout: 6_000 });
      expect(await page.evaluate(() => (window as unknown as { __steps: string[] }).__steps)).toEqual(['0:', '1:demoUser', '2:demoUser+demoThinking', '3:demoUser+assistantReply', '4:demoUser+assistantReply+assistantHandoff']);
      // It ends on a clear final state and never loops.
      await page.waitForTimeout(1_500);
      await expect(chat).toHaveAttribute('data-assistant-step', '4');
      await expect(chat).toContainText('Swap 0.5 ETH to USDC on Base.');
      await expect(chat).toContainText('Your workflow is ready to review.');
      await expect(chat).toContainText('Continue in FloFi');
      await expect(chat).toContainText('Review and authorize transactions with your wallet in FloFi.');
      const tabs = section.getByRole('tablist', { name: 'Choose your assistant' });
      const claude = tabs.getByRole('tab', { name: 'Claude' }), chatgpt = tabs.getByRole('tab', { name: 'ChatGPT' });
      await expect(claude).toHaveAttribute('aria-selected', 'true');
      const panel = section.getByRole('tabpanel', { name: 'Claude' });
      await expect(panel).toContainText('Open Settings → Connectors → Add custom connector.');
      await expect(panel).toContainText('Paste the URL and authorize the connection.');
      await expect(panel).toContainText('https://flofi.xyz/api/mcp');
      await expect(panel).toContainText('FloFi may ask for an invite code');
      // Arrow keys, Home and End move between tabs (WAI-ARIA tabs); the conversation replays for the selected assistant.
      await claude.focus(); await page.keyboard.press('ArrowRight');
      await expect(chatgpt).toBeFocused(); await expect(chatgpt).toHaveAttribute('aria-selected', 'true');
      await expect(claude).toHaveAttribute('tabindex', '-1');
      const chatgptPanel = section.getByRole('tabpanel', { name: 'ChatGPT' });
      await expect(chatgptPanel).toContainText('Turn on Developer mode in Settings → Apps & Connectors → Advanced, then choose Create.');
      await expect(chatgptPanel).toContainText('Paste the URL, choose OAuth and authorize the connection.');
      await expect(section.getByRole('group', { name: 'Illustrative conversation · ChatGPT' })).toBeVisible();
      await chat.scrollIntoViewIfNeeded();
      await expect(chat).toHaveAttribute('data-assistant-step', '4', { timeout: 6_000 });
      await page.keyboard.press('Home'); await expect(claude).toBeFocused();
      await page.keyboard.press('End'); await expect(chatgpt).toBeFocused();
      await page.keyboard.press('ArrowRight'); await expect(claude).toBeFocused();
      await page.keyboard.press('ArrowLeft'); await expect(chatgpt).toBeFocused();
      // From the selected tab, Tab reaches the copy button; Enter copies the exact endpoint.
      await page.keyboard.press('Tab');
      await expect(section.getByRole('button', { name: 'Copy URL' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(section.getByRole('button', { name: 'Copied' })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://flofi.xyz/api/mcp');
      // Marketing, not developer documentation: no tool names, no guide button, no "what happens where", said once.
      const text = await section.innerText();
      expect(text).not.toMatch(/compose_strategy|simulate_strategy|request_user_approval|validate_strategy|review_strategy|_status|What happens where|MCP guide/);
      expect(text.split('Review and authorize transactions with your wallet in FloFi.')).toHaveLength(2);
      await expect(section.getByRole('link')).toHaveCount(0);
      await page.getByRole('button', { name: 'PT', exact: true }).click();
      await expect(section.getByRole('tablist', { name: 'Escolha seu assistente' })).toBeVisible();
      await expect(section).toContainText('Revise e autorize as transações com a sua carteira no FloFi.');
      await expect(section).toContainText('O FloFi pode pedir um código de convite');
      expect(seen.actions).toEqual([]); expect(new Set(await writes(page))).toEqual(new Set(['flofi-landing-language']));
      // The full instructions stay where they were: the docs route is unchanged.
      await page.goto('/docs/mcp-integrations');
      await expect(page.getByRole('heading', { level: 1, name: 'MCP Integrations' })).toBeVisible();
      expect(seen.external).toEqual([]); expect(seen.errors).toEqual([]);
    });
  }

  test('the restored mascot journey runs by default: intro, travel through the new sections, no CTA interception', async ({ page, baseURL }) => {
    const seen = await guard(page, baseURL);
    await page.addInitScript(() => sessionStorage.removeItem('flofi-alive-intro-v1'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const root = page.locator('[data-mascot-motion="true"]');
    await expect(root).toHaveAttribute('data-alive', 'running');
    await expect(root).toHaveAttribute('data-intro', /playing|complete/);
    await page.getByRole('button', { name: 'Skip intro', exact: true }).click({ timeout: 5_000 }).catch(() => undefined);
    await expect(root).toHaveAttribute('data-intro', 'complete');
    for (const scene of ['hero', 'networks', 'demo', 'assistants', 'infrastructure', 'cta']) {
      const dock = page.locator(`[data-mascot-dock="${scene}"]`);
      await dock.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await expect(dock).toHaveAttribute('data-active', 'true');
      await expect(page.locator('[data-mascot-journey]')).toHaveAttribute('data-scene', scene);
    }
    // The traveller never takes pointer events: the closing CTA stays clickable under it.
    const cta = page.locator('#about').getByRole('link', { name: 'Launch FloFi', exact: true });
    expect(await cta.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
    expect(await page.locator('[data-mascot-traveler]').evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
    // Reloading in the same tab never replays the intro.
    await page.reload();
    await expect(page.locator('[data-mascot-motion="true"]')).toHaveAttribute('data-intro', 'skipped');
    expect(seen.external).toEqual([]); expect(seen.errors).toEqual([]);
  });
});

test.describe('motion allowed, stepped by a fake clock', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('How it works follows the visitor: keyboard pause and play, holds off screen and in a hidden tab, keeps its place across languages, replays', async ({ page, baseURL }) => {
    const seen = await guard(page, baseURL);
    await page.clock.install({ time: CLOCK_START });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/'); await page.evaluate(() => document.fonts.ready);
    await page.clock.pauseAt(CLOCK_START + 60_000);
    const demo = page.locator('#demo'), stage = demo.locator('[data-demo-cue]');
    const advance = async (ms: number, cue: string) => { await page.clock.runFor(ms); await expect(stage).toHaveAttribute('data-demo-cue', cue); };
    const setHidden = (hidden: boolean) => page.evaluate(value => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    // Time passing before the section is seen starts nothing.
    await page.clock.runFor(10_000);
    await expect(stage).toHaveAttribute('data-demo-cue', 'idle');
    await stage.scrollIntoViewIfNeeded();
    await expect(stage).toHaveAttribute('data-demo-state', 'playing');
    await advance(DEMO_CUES.reply + 30, 'reply');
    // The visitor pauses it from the keyboard: nothing advances while paused.
    await demo.getByRole('button', { name: 'Pause the illustration' }).focus();
    await page.keyboard.press('Enter');
    await expect(stage).toHaveAttribute('data-demo-state', 'paused');
    await expect(demo.getByRole('button', { name: 'Play the illustration' })).toBeFocused();
    await page.clock.runFor(20_000);
    await expect(stage).toHaveAttribute('data-demo-cue', 'reply');
    await page.keyboard.press('Space');
    await expect(stage).toHaveAttribute('data-demo-state', 'playing');
    await advance(DEMO_CUES.supplyGhost - DEMO_CUES.reply + 30, 'supplyGhost');
    // Scrolled away it holds; seen again, it resumes where it was.
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await expect(stage).toHaveAttribute('data-demo-state', 'waiting');
    await page.clock.runFor(20_000);
    await expect(stage).toHaveAttribute('data-demo-cue', 'supplyGhost');
    await stage.scrollIntoViewIfNeeded();
    await expect(stage).toHaveAttribute('data-demo-state', 'playing');
    await advance(DEMO_CUES.supplyCard - DEMO_CUES.supplyGhost + 30, 'supplyCard');
    // A hidden tab holds it too.
    await setHidden(true);
    await expect(stage).toHaveAttribute('data-demo-state', 'waiting');
    await page.clock.runFor(20_000);
    await expect(stage).toHaveAttribute('data-demo-cue', 'supplyCard');
    await setHidden(false);
    await expect(stage).toHaveAttribute('data-demo-state', 'playing');
    // Changing the language translates the story in place; it does not restart. (The header switch scrolls away; the story holds.)
    await page.getByRole('button', { name: 'PT', exact: true }).click();
    await stage.scrollIntoViewIfNeeded();
    await expect(stage).toHaveAttribute('data-demo-state', 'playing');
    await expect(stage).toHaveAttribute('data-demo-cue', 'supplyCard');
    await expect(demo.locator('[data-demo-line="supply"]')).toHaveText('Adicionando a etapa de depósito…');
    await expect(demo.locator('[data-demo-card="supply"]')).toContainText('1. Depositar');
    await expect(demo.getByRole('button', { name: 'Pausar a ilustração' })).toBeVisible();
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await stage.scrollIntoViewIfNeeded();
    await expect(stage).toHaveAttribute('data-demo-state', 'playing');
    await page.clock.runFor(DEMO_END);
    await expect(stage).toHaveAttribute('data-demo-cue', 'done');
    await expect(stage).toHaveAttribute('data-demo-state', 'done');
    await page.clock.runFor(120_000);
    await expect(stage).toHaveAttribute('data-demo-cue', 'done');
    // Keyboard order at the end: the control, then the closing link.
    const replay = demo.getByRole('button', { name: 'Replay the illustration' }), cta = demo.getByRole('link', { name: /Try it in FloFi/ });
    // The closing link is focusable as soon as it appears.
    expect(await cta.evaluate(element => getComputedStyle(element).visibility)).toBe('visible');
    await replay.focus(); await page.keyboard.press('Tab');
    await expect(cta).toBeFocused();
    // Replay restarts the same single timeline from an empty chat and Canvas.
    await replay.click();
    await expect(stage).toHaveAttribute('data-demo-cue', 'idle');
    await expect(stage).toHaveAttribute('data-demo-state', 'playing');
    await expect(demo.locator('[data-demo-card][data-state="hidden"]')).toHaveCount(2);
    await advance(DEMO_CUES.sent + 30, 'sent');
    await page.clock.runFor(DEMO_END);
    await expect(stage).toHaveAttribute('data-demo-cue', 'done');
    expect(seen.actions).toEqual([]); expect(new Set(await writes(page))).toEqual(new Set(['flofi-landing-language']));
    expect(seen.external).toEqual([]); expect(seen.errors).toEqual([]);
  });

  /** Key states of the story; times are on the demo timeline. */
  const KEY_STATES = [
    ['typing', DEMO_CUES.typing + 1_200], ['thinking', DEMO_CUES.thinking + 400], ['supply-created', DEMO_CUES.supplyCard + 600],
    ['borrow-connected', DEMO_CUES.connector + 900], ['simulate', DEMO_CUES.collateral + 400], ['execute', DEMO_CUES.wallet + 400], ['final', DEMO_END],
  ] as const;

  for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
    test(`How it works stays readable at every stage at ${width}px (EN/PT): reading order, nothing clipped or overflowing, usable controls`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      const seen = await guard(page, baseURL);
      await page.clock.install({ time: CLOCK_START });
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await page.goto('/'); await page.evaluate(() => document.fonts.ready);
      await page.clock.pauseAt(CLOCK_START + 60_000);
      const demo = page.locator('#demo'), stage = demo.locator('[data-demo-cue]');
      for (const locale of ['en', 'pt'] as const) {
        await page.getByRole('button', { name: locale.toUpperCase(), exact: true }).click();
        await demo.locator('[data-demo-chat]').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
        // The second language replays the same story from the start.
        if (locale === 'pt') await demo.getByRole('button', { name: 'Repetir a ilustração' }).click();
        await expect(stage).toHaveAttribute('data-demo-state', 'playing');
        let reached = 0;
        for (const [name, at] of KEY_STATES) {
          await page.clock.runFor(at - reached); reached = at;
          if (name === 'final') await expect(stage).toHaveAttribute('data-demo-state', 'done');
          // CSS transitions run on real time.
          await page.waitForTimeout(700);
          const layout = await stage.evaluate(element => {
            const chat = element.querySelector('[data-demo-chat]')!.getBoundingClientRect(), canvas = element.querySelector('[data-demo-canvas]')!.getBoundingClientRect();
            const shown = [...element.querySelectorAll<HTMLElement>('p, li, strong, small, b, a, button, [data-demo-composer]')].filter(item => {
              const style = getComputedStyle(item), box = item.getBoundingClientRect();
              return box.width > 0 && style.visibility !== 'hidden' && item.closest('[data-shown="false"]') === null;
            });
            const outside = shown.filter(item => {
              const root = item.closest('[data-demo-chat]') ? chat : canvas, box = item.getBoundingClientRect();
              return box.left < root.left - 1 || box.right > root.right + 1 || box.top < root.top - 1 || box.bottom > root.bottom + 1;
            }).map(item => item.textContent!.slice(0, 48));
            const clipped = shown.filter(item => item.scrollWidth > item.clientWidth + 1 && getComputedStyle(item).overflowX !== 'visible').map(item => item.textContent!.slice(0, 48));
            return { outside, clipped, stacked: chat.bottom <= canvas.top, sideBySide: chat.right <= canvas.left && Math.abs(chat.top - canvas.top) < 2,
              overflow: document.documentElement.scrollWidth > innerWidth };
          });
          expect(layout.outside, `${locale} ${name}`).toEqual([]);
          expect(layout.clipped, `${locale} ${name}`).toEqual([]);
          expect(layout.overflow, `${locale} ${name}`).toBe(false);
          // Conversation first, then the Canvas: side by side on desktop, stacked below 1024px.
          expect(width >= 1024 ? layout.sideBySide : layout.stacked, `${locale} ${name}`).toBe(true);
          if (evidence && locale === 'en' && [390, 1440].includes(width)) await demo.screenshot({ path: `${evidence}/howitworks-${name}-${width}.png` });
          if (evidence && locale === 'pt' && name === 'final' && [390, 1440].includes(width)) await demo.screenshot({ path: `${evidence}/howitworks-final-pt-${width}.png` });
        }
        for (const control of [demo.getByRole('button', { name: locale === 'en' ? 'Replay the illustration' : 'Repetir a ilustração' }), demo.getByRole('link', { name: locale === 'en' ? /Try it in FloFi/ : /Experimente no FloFi/ })]) {
          await control.scrollIntoViewIfNeeded();
          expect(await control.evaluate(element => {
            const box = element.getBoundingClientRect();
            return box.width >= 44 && box.height >= 44 && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          })).toBe(true);
        }
      }
      expect(seen.actions).toEqual([]); expect(seen.external).toEqual([]); expect(seen.errors).toEqual([]);
    });
  }
});

test('reduced motion shows the complete How it works story and the onboarding at once, with the still mascot and no running animation', async ({ page, baseURL }) => {
  const seen = await guard(page, baseURL);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-alive', 'still');
  const demo = page.locator('#demo'), stage = demo.locator('[data-demo-cue]');
  for (const [selector, attribute, value] of [['#demo [data-demo-cue]', 'data-demo-cue', 'done'], ['#assistants [data-assistant-step]', 'data-assistant-step', '4']] as const) {
    await expect(page.locator(selector)).toHaveAttribute(attribute, value);
    await page.locator(selector).scrollIntoViewIfNeeded();
    await expect(page.locator(selector)).toHaveAttribute(attribute, value);
  }
  await expect(stage).toHaveAttribute('data-demo-state', 'static');
  // A readable static version: both cards, Simulate and Execute together, the closing link; no control when nothing moves.
  await expect(demo.locator('[data-demo-card][data-state="shown"]')).toHaveCount(2);
  await expect(demo.locator('[data-panel="simulate"]')).toBeVisible();
  await expect(demo.locator('[data-panel="execute"]')).toBeVisible();
  await expect(demo.locator('[data-panel="build"]')).toBeHidden();
  await expect(demo.getByRole('button')).toHaveCount(0);
  await expect(demo.getByRole('link', { name: /Try it in FloFi/ })).toBeVisible();
  // Assistive technology reads one equivalent summary; the moving picture is decorative and holds nothing focusable.
  await expect(demo.locator('p[class*="srOnly"]')).toHaveText(landingText.en.demoSummary.replace('{0}', landingText.en.demoPrompt));
  expect(await demo.locator('[aria-hidden="true"]').count()).toBeGreaterThanOrEqual(4);
  await expect(demo.locator('[aria-hidden="true"] :is(a, button, input, [tabindex])')).toHaveCount(0);
  expect(await page.locator('main').evaluate(element => [...element.querySelectorAll('*')].flatMap(item => item.getAnimations()).length)).toBe(0);
  expect(seen.external).toEqual([]); expect(seen.errors).toEqual([]);
});
