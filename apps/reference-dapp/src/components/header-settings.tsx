// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { learningAvailability } from '../app/learning-action';
import { accountSignOut, accountState, type AccountState } from '../app/account-action';

export function HeaderSettings({ onDisconnect, disconnectDisabled, onSupport }: { onDisconnect: () => void; disconnectDisabled: boolean; onSupport?: () => void }) {
  const { t: tr } = useLocale();
  const [open, setOpen] = useState(false);
  // Language remains a presentation preference.
  const { language, setLanguage } = useLocale();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const themeTransition = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuId = useId();
  // BUILD-CHAT-LEARNING-002: Privacy & memory is listed only where the deployment keeps learning data (checked when the menu first opens).
  const [privacy, setPrivacy] = useState(false), checked = useRef(false);
  // BUILD-FLOFI-AUTH-WALLETS-001: the FloFi account entry, only where this deployment offers accounts (read when the menu first opens).
  const [account, setAccount] = useState<AccountState | null>(null);
  useEffect(() => {
    if (!open || checked.current) return;
    checked.current = true;
    void learningAvailability().then(tier => setPrivacy(tier === 'ENABLED'), () => undefined);
    // Not inside the embedded MCP approval: signing in there would navigate away from the approval.
    if (window.location.pathname !== '/mcp/approve') void accountState().then(setAccount, () => undefined);
  }, [open]);
  async function signOut() {
    await accountSignOut().catch(() => undefined);
    window.location.assign('/login');
  }
  const languageDescriptionId = useId(), themeDescriptionId = useId();
  useEffect(() => {
    let saved: 'light' | 'dark' = 'light';
    try { if (localStorage.getItem('flofi.theme') === 'dark') saved = 'dark'; } catch { /* Preferences are optional when storage is unavailable. */ }
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
    return () => {
      if (themeTransition.current) clearTimeout(themeTransition.current);
      delete document.documentElement.dataset.themeTransition;
    };
  }, []);
  function selectTheme(value: 'light' | 'dark') {
    if (themeTransition.current) clearTimeout(themeTransition.current);
    document.documentElement.dataset.themeTransition = 'true';
    setTheme(value);
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem('flofi.theme', value); } catch { /* The theme still applies for this visit. */ }
    themeTransition.current = setTimeout(() => {
      delete document.documentElement.dataset.themeTransition;
      themeTransition.current = null;
    }, 320);
  }
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false); toggle.current?.focus();
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return <div className="header-settings-control" ref={container}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={toggle} type="button" className="header-settings" aria-label={tr("Settings")} title={tr("Settings")}
      aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 3-.5 3-2 1.2L4.7 6l-2 3.5 2.3 2v1l-2.3 2 2 3.5 2.8-1.2 2 1.2.5 3h4l.5-3 2-1.2 2.8 1.2 2-3.5-2.3-2v-1l2.3-2-2-3.5-2.8 1.2-2-1.2-.5-3Z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
    {open && <div className="header-settings-menu" id={menuId} role="group" aria-label={tr("Settings options")}>
      <div className="header-settings-row"><span>{tr("Language")}</span>
        <button type="button" className="header-settings-choices" role="switch" aria-label={tr("Language")} aria-checked={language === 'EN'}
          aria-describedby={languageDescriptionId} title={tr(language === 'EN' ? 'Switch to Português' : 'Switch to English')}
          onClick={() => setLanguage(language === 'EN' ? 'PT' : 'EN')}>
          {(['PT', 'EN'] as const).map(value => <span key={value} aria-hidden="true" data-selected={language === value}>{tr(value)}</span>)}
        </button>
        <span id={languageDescriptionId} className="sr-only">{tr("Current language: ")}{tr(language === 'EN' ? 'English' : 'Português')}</span>
      </div>
      <div className="header-settings-row"><span>{tr("Theme")}</span>
        <button type="button" className="header-settings-choices" role="switch" aria-label={tr("Theme")} aria-checked={theme === 'dark'}
          aria-describedby={themeDescriptionId} title={tr(theme === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme')}
          onClick={() => selectTheme(theme === 'light' ? 'dark' : 'light')}>
        <span aria-hidden="true" data-selected={theme === 'light'}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>
        </span>
        <span aria-hidden="true" data-selected={theme === 'dark'}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z"/></svg>
        </span>
        </button>
        <span id={themeDescriptionId} className="sr-only">{tr("Current theme: ")}{tr(theme === 'dark' ? 'Dark' : 'Light')}</span>
      </div>
      <hr className="header-settings-separator"/>
      {account?.availability.accounts && (account.account ? <>
        <Link href="/app/credentials" className="header-settings-action" onClick={() => setOpen(false)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span>{tr("My account")}</span>
        </Link>
        <button type="button" className="header-settings-action" onClick={() => void signOut()}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5M10 12H3m4-4-4 4 4 4"/></svg><span>{tr("Sign out")}</span>
        </button></> : /* A full page load: sign-in runs under its own nonce policy (src/accounts/account-csp.ts), never this page's. */ <a href="/login" className="header-settings-action" onClick={() => setOpen(false)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span>{tr("Sign in")}</span>
        </a>)}
      {privacy && <Link href="/app/privacy" className="header-settings-action" onClick={() => setOpen(false)}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6Z"/><path d="m9 12 2 2 4-4"/></svg><span>{tr("Privacy & memory")}</span>
      </Link>}
      <button type="button" className="header-settings-action" onClick={() => { onSupport?.(); setOpen(false); toggle.current?.focus(); }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6m5.6 5.6 3.6 3.6M5.6 18.4l3.6-3.6m5.6-5.6 3.6-3.6"/></svg><span>{tr("Support")}</span>
      </button>
      <button type="button" className="header-settings-action header-disconnect" disabled={disconnectDisabled}
        title={tr("Clear this app’s wallet connection. Wallet permissions are managed in your wallet.")}
        onClick={() => { onDisconnect(); setOpen(false); toggle.current?.focus(); }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M10 12h11m-4-4 4 4-4 4"/></svg><span>{tr("Disconnect")}</span>
      </button>
    </div>}
  </div>;
}
