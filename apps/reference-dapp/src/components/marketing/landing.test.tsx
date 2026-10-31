// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LandingPage from './page';
import { landingText } from './landing-copy';
import { SOCIAL_LINKS, SocialLinks } from './social-links';
import { ConversationDemo, DEMO_PROTOCOL, DEMO_WORKFLOW } from './conversation-demo';
import { DEMO_CUES, DEMO_END, DEMO_TICKS, demoCue, demoFrame } from './demo-timeline';
import { ASSISTANT_HOSTS, AssistantOnboarding, FLOFI_MCP_URL } from './assistant-onboarding';
import { APPROVAL_TOOL_NAMES, MCP_TOOL_NAMES } from '../../mcp/tools';
import { articles } from '../docs/content';

const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const publicFile = (path: string) => read(`../../../public${path}`);
const between = (html: string, start: string, end: string) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

describe('BUILD-FLOFI-UX-UI-002 landing', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('community links use the owner-supplied accounts, safe external links and the registered official marks (EN/PT)', () => {
    expect(SOCIAL_LINKS.map(link => link.href)).toEqual(['https://x.com/FloFi_xyz', 'https://discord.gg/36rEhdUa',
      'https://www.linkedin.com/company/flofixyz/home/', 'https://t.me/FloFiAppBot']);
    const register = read('../../../public/brand/social/sources.md').toString() + read('../../../public/brand/channels/sources.md').toString();
    for (const link of SOCIAL_LINKS) {
      expect(register).toContain(createHash('sha256').update(publicFile(link.mark)).digest('hex'));
    }
    for (const locale of ['en', 'pt'] as const) {
      const t = landingText[locale];
      for (const variant of ['hero', 'footer'] as const) {
        const html = renderToStaticMarkup(createElement(SocialLinks, { t, variant }));
        expect(html.match(/<a /g)).toHaveLength(4);
        expect(html.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(4);
        for (const label of [t.socialX, t.socialDiscord, t.socialLinkedIn, t.socialTelegram]) expect(html).toContain(`aria-label="${label}"`);
        // Icons only: no visible label, but the list keeps its localized accessible name; marks are decorative.
        expect(plain(html).trim()).toBe('');
        expect(html).not.toMatch(/<p\b/);
        expect(html).toContain(`<ul aria-label="${t.socialLabel}">`);
        expect(html.match(/alt=""/g)).toHaveLength(4);
      }
    }
    expect(landingText.pt.socialX).toContain('abre em nova aba');
    expect([landingText.en.socialLabel, landingText.pt.socialLabel]).toEqual(['FloFi community', 'Comunidade FloFi']);
  });

  it('renders the restored mascot journey by default, the new sections in order, and community links near the hero CTAs and in the footer', () => {
    const html = renderToStaticMarkup(createElement(LandingPage));
    expect(html).toContain('data-mascot-motion="true"');
    expect(html).toContain('data-mascot-journey');
    // Owner order: hero, Supported Networks, How it works, MCP, developers, closing.
    expect([...html.matchAll(/<section[^>]* id="([a-z]+)"/g)].map(match => match[1])).toEqual(['workflow', 'networks', 'demo', 'assistants', 'developers', 'about']);
    expect([...html.matchAll(/data-mascot-dock="([a-z]+)"/g)].map(match => match[1]).filter(scene => scene !== 'workflow')).toEqual(['hero', 'networks', 'demo', 'assistants', 'infrastructure', 'cta']);
    const hero = between(html, 'id="workflow"', '</section>');
    expect(hero.indexOf('href="/docs"')).toBeLessThan(hero.indexOf('data-social-links="hero"'));
    expect(between(html, '<footer', '</footer>')).toContain('data-social-links="footer"');
    // Nothing on the landing may look like test infrastructure (the CI landing rule).
    const main = between(html, '<main', '</main>').replace(/<[^>]+>/g, ' ');
    expect(main).not.toMatch(/devnet|testnet|sepolia|mock|sandbox|synthetic|simulated.only|test.funds/i);
  });

  it('the build-time off switch still removes the mascot experience', async () => {
    vi.stubEnv('NEXT_PUBLIC_FLOFI_MASCOT_MOTION', 'false');
    const { mascotMotionEnabled } = await import('./mascot-journey');
    expect(mascotMotionEnabled).toBe(false);
  });

  it('How it works is one bounded illustration of the owner example: no input or choices, no fabricated results (EN/PT)', () => {
    expect(DEMO_WORKFLOW.map(step => [step.action, step.amount, step.asset])).toEqual([['supply', '1', 'ETH'], ['borrow', '500', 'USDC']]);
    expect(DEMO_PROTOCOL).toEqual({ name: 'Aave', network: 'Ethereum' });
    expect(landingText.en.demoPrompt).toBe('Supply 1 ETH on Aave and borrow 500 USDC');
    for (const locale of ['en', 'pt'] as const) {
      const t = landingText[locale];
      const html = renderToStaticMarkup(createElement(ConversationDemo, { t }));
      expect(html).not.toMatch(/<(input|textarea|form|select)\b/);
      // No scenario selector: the only button is the pause/replay control (hidden in the static frame), the only link the closing CTA.
      expect(html.match(/<button /g)).toHaveLength(1);
      expect(html).toMatch(/<button [^>]*hidden=""/);
      expect(html.match(/<a /g)).toHaveLength(1);
      expect(html).toContain('href="/login"');
      const text = plain(html);
      for (const key of ['demoEyebrow', 'demoTitle', 'demoBody', 'demoIllustration', 'demoNote', 'demoCta'] as const) expect(text).toContain(t[key]);
      // Server HTML is the complete final frame: both cards, every message, Simulate and Execute.
      expect(html).toContain('data-demo-stage="execute"');
      expect(html).toContain('data-demo-cue="done"');
      expect(html.match(/data-demo-card="(?:supply|borrow)" data-state="shown"/g)).toHaveLength(2);
      for (const key of ['demoPrompt', 'demoReply', 'demoAddSupply', 'demoAddBorrow', 'demoReady', 'demoSimulating', 'demoHandoff', 'demoCheckWorkflow',
        'demoCheckCollateral', 'demoCheckCosts', 'demoCheckManifest', 'demoStepReview', 'demoStepWallet', 'demoStepRun', 'demoStepStatus', 'demoBorrowNote'] as const) expect(text).toContain(t[key]);
      // The moving picture is decorative for assistive technology; one summary carries the whole story.
      expect(html.match(/aria-hidden="true"/g)!.length).toBeGreaterThanOrEqual(4);
      expect(text).toContain(t.demoSummary.replace('{0}', t.demoPrompt));
      expect(t.demoSummary).toContain('{0}');
      expect(text).not.toMatch(/0x[0-9a-f]{6,}|\bAPY\b|%|confirmed|confirmad|success|sucesso|\bexecuted\b|executad[oa]|\bcompleted?\b|conclu[ií]d|receipt|recibo|\bhash\b|balance|saldo|health factor|\$\s?\d|\d{1,2}:\d{2}/i);
      // Only the visitor's own amounts and the stage/step ordinals appear: no quote, rate, fee, limit or result.
      const numbers = new Set([...text.replace(t.demoSummary.replace('{0}', t.demoPrompt), '').matchAll(/\d+(?:[.,]\d+)?/g)].map(match => match[0]));
      expect([...numbers].every(value => ['1', '2', '3', '4', '500'].includes(value)), [...numbers].join(' ')).toBe(true);
    }
  });

  it('one deterministic timeline drives the chat and the Canvas in the owner order', () => {
    expect(DEMO_TICKS[0]).toBe(0);
    expect(DEMO_TICKS.at(-1)).toBe(DEMO_END);
    expect(DEMO_TICKS.every((tick, i) => i === 0 || tick > DEMO_TICKS[i - 1]!)).toBe(true);
    expect(Object.values(DEMO_CUES).every((at, i, all) => i === 0 || at > all[i - 1]!)).toBe(true);
    for (const at of Object.values(DEMO_CUES)) expect(DEMO_TICKS).toContain(at);
    expect(DEMO_END).toBeLessThan(20_000);
    const start = demoFrame(0);
    expect(start).toMatchObject({ cue: 'idle', stage: 'build', composing: false, sent: false, empty: true, supply: 'hidden', borrow: 'hidden', connector: false, done: false });
    expect(start.stages).toEqual({ build: 'active', simulate: 'pending', execute: 'pending' });
    // The request is typed character by character, then sent.
    const typing = DEMO_TICKS.filter(tick => tick >= DEMO_CUES.typing && tick < DEMO_CUES.sent).map(tick => demoFrame(tick));
    const prompt = landingText.en.demoPrompt;
    const lengths = typing.map(frame => Math.ceil(prompt.length * frame.typed));
    expect(typing.every(frame => frame.composing && !frame.sent)).toBe(true);
    expect(lengths[0]).toBe(1);
    expect(lengths.at(-1)).toBe(prompt.length);
    expect(lengths.every((length, i) => i === 0 || length >= lengths[i - 1]!)).toBe(true);
    expect(new Set(lengths).size).toBeGreaterThan(30);
    const frames = DEMO_TICKS.map(tick => demoFrame(tick));
    for (const [i, f] of frames.entries()) {
      // Synchronized: each chat update and its Canvas change share one cue.
      expect(f.supplyLine !== 'pending').toBe(f.supply !== 'hidden');
      expect(f.borrowLine !== 'pending').toBe(f.borrow !== 'hidden');
      expect(f.supplyLine === 'visited').toBe(f.borrow !== 'hidden');
      expect(f.borrowLine === 'visited').toBe(f.ready);
      if (f.ready) expect(f.connector && f.supply === 'shown' && f.borrow === 'shown').toBe(true);
      expect(f.simulateLine === 'active').toBe(f.stage === 'simulate');
      expect(f.handoff).toBe(f.stage === 'execute');
      expect(f.thinking && f.reply).toBe(false);
      expect(f.checks.filter(status => status === 'active').length).toBe(f.stage === 'simulate' ? 1 : 0);
      expect(f.steps.filter(status => status === 'active').length).toBe(f.stage === 'execute' && !f.done ? 1 : 0);
      // Nothing that appeared goes away again (the thinking dots give way to the reply; the composer clears when sent).
      const previous = frames[i - 1];
      if (previous) for (const key of ['sent', 'reply', 'ready', 'handoff', 'connector', 'done'] as const) if (previous[key]) expect(f[key]).toBe(true);
    }
    const sequence = DEMO_TICKS.map(demoCue).filter((cue, i, all) => cue !== all[i - 1]);
    expect(sequence).toEqual(['idle', ...Object.keys(DEMO_CUES)]);
    expect(frames.findIndex(f => f.supply === 'shown')).toBeLessThan(frames.findIndex(f => f.borrow === 'shown'));
    expect(frames.findIndex(f => f.borrow === 'shown')).toBeLessThan(frames.findIndex(f => f.connector));
    expect(frames.findIndex(f => f.connector)).toBeLessThan(frames.findIndex(f => f.stage === 'simulate'));
    expect(frames.findIndex(f => f.stage === 'simulate')).toBeLessThan(frames.findIndex(f => f.stage === 'execute'));
    // The final frame reaches Execute but marks nothing as a result: every check and step is only "visited".
    const end = demoFrame(DEMO_END);
    expect(end).toMatchObject({ stage: 'execute', done: true, connector: true, supply: 'shown', borrow: 'shown' });
    expect(end.stages).toEqual({ build: 'visited', simulate: 'visited', execute: 'active' });
    expect([...end.checks, ...end.steps].every(status => status === 'visited')).toBe(true);
    expect(end.focus).toEqual({ supply: false, borrow: false });
  });

  it('the MCP section is connect once, then ask: the deployed endpoint, short accurate setup, no tool names, no repeated safety copy (EN/PT)', () => {
    expect(FLOFI_MCP_URL).toBe('https://flofi.xyz/api/mcp');
    // The full instructions stay in the docs article; the landing no longer links a guide or explains "what happens where".
    expect(articles.some(article => article.slug === 'mcp-integrations')).toBe(true);
    expect(ASSISTANT_HOSTS.map(host => host.name)).toEqual(['Claude', 'ChatGPT']);
    const tools = [...MCP_TOOL_NAMES, ...APPROVAL_TOOL_NAMES] as string[];
    expect(tools).toContain('compose_strategy');
    for (const locale of ['en', 'pt'] as const) {
      const t = landingText[locale];
      const html = renderToStaticMarkup(createElement(AssistantOnboarding, { t }));
      const text = plain(html);
      expect(html).toContain(FLOFI_MCP_URL);
      expect(html).toContain('role="tablist"');
      expect(html.match(/role="tab"/g)).toHaveLength(2);
      expect(html).not.toMatch(/<a\b/);
      // Two buttons for the assistants, one to copy the URL: nothing else to operate.
      expect(html.match(/<button /g)).toHaveLength(3);
      for (const key of ['assistantsTitleFirst', 'assistantsTitleSecond', 'assistantsConnect', 'claudeOpen', 'claudeAdd', 'assistantsNote', 'assistantsUse',
        'assistantsPrompt', 'assistantsReply', 'assistantsContinue', 'assistantsAuthorize'] as const) expect(text).toContain(t[key]);
      expect(t.assistantsPrompt).toMatch(locale === 'en' ? /^Swap 0\.5 ETH to USDC on Base\.$/ : /^Troque 0,5 ETH por USDC na Base\.$/);
      // Marketing, not developer documentation: no MCP tool name appears.
      for (const tool of tools) expect(text).not.toContain(tool);
      // One safety sentence, said once; no install, in-chat signing or automatic execution claim.
      expect(text.split(t.assistantsAuthorize)).toHaveLength(2);
      expect(text).not.toMatch(/one.click|um clique|sign(?:s|ed)? (?:in|inside) (?:the )?chat|automatic|automátic|never sign|nunca assinam|confirmed|confirmad|executed|executad/i);
      // Every bit of copy that used to explain the same thing again is gone.
      expect(Object.keys(t).filter(key => /^assistants(?:Where|InChat|InFloFi|Guide|Safety|NotOneClick|Step|Body)/.test(key))).toEqual([]);
    }
    expect(landingText.en.assistantsAuthorize).toBe('Review and authorize transactions with your wallet in FloFi.');
    expect(landingText.pt.assistantsAuthorize).toBe('Revise e autorize as transações com a sua carteira no FloFi.');
    // The shortened connector paths are still the operator guide's (docs/deploy/MCP.md §2), including ChatGPT's OAuth choice.
    const guide = read('../../../../../docs/deploy/MCP.md').toString();
    expect(guide).toContain('Settings → Connectors → Add custom connector');
    expect(landingText.en.claudeOpen).toContain('Settings → Connectors → Add custom connector');
    expect(guide).toContain('Settings → Apps & Connectors → Advanced → Developer mode → Create');
    expect(landingText.en.chatgptOpen).toMatch(/Developer mode in Settings → Apps & Connectors → Advanced, then choose Create/);
    expect(guide).toContain('authentication OAuth');
    expect(landingText.en.chatgptAdd).toContain('OAuth');
    expect(guide).toMatch(/invite code/);
    expect(landingText.en.assistantsNote).toContain('invite code');
  });

  it('scrolling never hides an Earth layer: it only pauses the clocks of the original artwork passes', () => {
    const css = read('./landing.module.css').toString();
    expect(css).not.toMatch(/data-earth-active="false"[^{]*\{[^}]*visibility\s*:\s*hidden/);
    expect(css).toMatch(/\.horizon\[data-earth-active="true"\][^{]*\{[^}]*animation-play-state:\s*running/);
    expect(css).toContain('.earthSurface { animation: earthSurfaceRotation 60s linear infinite; animation-play-state: paused; }');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.earthSurface \{ animation: none; opacity: 0; \}/);
    const source = read('./earth-atmosphere.tsx').toString();
    expect(source).toContain('href="/flofi/closing-horizon-v2.png"');
    expect(source).toContain('data-earth-active="false"');
  });
});
