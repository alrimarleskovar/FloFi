// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: sign-in method marks. The Google "G" and Apple marks follow each provider's sign-in button guidelines
 * (their own marks, unmodified colours); the rest are FloFi line icons. Decorative: every button carries its own text label.
 */
export type AccountIconName = 'apple' | 'google' | 'email' | 'wallet' | 'plus' | 'import' | 'check' | 'shield' | 'warning' | 'copy' | 'key' | 'phrase' | 'close'
  | 'sun' | 'moon' | 'lock' | 'arrow';

export function AccountIcon({ name, size = 20 }: { name: AccountIconName; size?: number }) {
  if (name === 'google') return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.86c2.26-2.08 3.58-5.15 3.58-8.65Z"/>
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.86-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24Z"/>
    <path fill="#FBBC05" d="M5.27 14.29A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.57.38-2.29v-3.1H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.39l3.98-3.1Z"/>
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.61l3.98 3.1C6.22 6.86 8.87 4.75 12 4.75Z"/>
  </svg>;
  if (name === 'apple') return <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M16.37 12.73c-.03-2.5 2.04-3.71 2.13-3.77-1.16-1.7-2.97-1.93-3.61-1.96-1.54-.16-3 .9-3.78.9-.78 0-1.98-.88-3.26-.86-1.68.03-3.23.98-4.09 2.48-1.75 3.03-.45 7.51 1.25 9.97.83 1.2 1.82 2.55 3.12 2.5 1.25-.05 1.72-.81 3.23-.81 1.51 0 1.94.81 3.26.78 1.35-.02 2.2-1.22 3.02-2.43.95-1.39 1.34-2.74 1.36-2.81-.03-.01-2.61-1-2.63-3.99ZM13.88 5.4c.69-.84 1.16-2 1.03-3.16-1 .04-2.2.67-2.92 1.5-.64.74-1.2 1.92-1.05 3.06 1.11.09 2.25-.57 2.94-1.4Z"/>
  </svg>;
  const paths: Record<Exclude<AccountIconName, 'google' | 'apple'>, React.ReactNode> = {
    email: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></>,
    wallet: <><path d="M20 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2"/><path d="M15 9h6v6h-6a3 3 0 0 1 0-6Z"/><path d="M15.5 12h.01"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    import: <><rect x="3" y="4" width="18" height="14" rx="3"/><path d="M12 8v6m-3-3 3 3 3-3M8 21h8"/></>,
    check: <path d="m5 12.5 4.5 4.5L19 7.5"/>,
    shield: <><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></>,
    warning: <><path d="M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.7L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 3.5h.01"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-3 3 3 3m-6 0 2 2"/></>,
    phrase: <><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h3m4 0h3M7 14h3m4 0h3"/></>,
    close: <path d="M6 6l12 12M18 6 6 18"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
  };
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths[name]}</svg>;
}
