// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-FLOFI-AUTH-WALLETS-001: the account screens are dark-first; an explicit light choice (the app's `flofi.theme`) wins. */
export const THEME_KEY = 'flofi.theme';
/** Runs before paint (inline in the account layout) so a light-theme choice never flashes dark. */
export const THEME_BOOTSTRAP = `try{document.documentElement.dataset.theme=localStorage.getItem('${THEME_KEY}')==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`;
