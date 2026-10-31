// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import styles from './docs.module.css';

type Entry = { title: string; section: string; href: string; text: string; group: string };
type NavItem = { title: string; slug: string; group: string };

function containFocus(event: ReactKeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button, input, [tabindex="0"]')).filter(element => element.getClientRects().length);
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

export function DocsShell({ children, navigation, index }: { children: ReactNode; navigation: NavItem[]; index: Entry[] }) {
  const path = usePathname();
  const router = useRouter();
  const search = useRef<HTMLDialogElement>(null);
  const mobile = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark' | undefined>(undefined);
  const [systemDark, setSystemDark] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = (words.length ? index.map(entry => ({ entry, score: words.reduce((score, word) => score + (entry.title.toLowerCase().includes(word) ? 5 : 0) + (entry.section.toLowerCase().includes(word) ? 3 : 0), 0) })).filter(({ entry }) => words.every(word => `${entry.title} ${entry.section} ${entry.text}`.toLowerCase().includes(word))).sort((a, b) => b.score - a.score).map(({ entry }) => entry) : index.filter(entry => !entry.section)).slice(0, 9);
  const dark = theme ? theme === 'dark' : systemDark;
  useEffect(() => {
    if (searchOpen) document.getElementById(`docs-result-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, searchOpen]);

  useEffect(() => {
    const preference = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(preference.matches);
    update(); preference.addEventListener('change', update);
    try { const saved = localStorage.getItem('flofi-docs-theme'); if (saved === 'light' || saved === 'dark') setTheme(saved); } catch { /* Storage is optional. */ }
    setReady(true);
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); search.current?.showModal(); setSearchOpen(true); input.current?.focus();
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => { preference.removeEventListener('change', update); document.removeEventListener('keydown', shortcut); };
  }, []);

  const openSearch = () => { search.current?.showModal(); setSearchOpen(true); input.current?.focus(); };
  const closeSearch = () => { search.current?.close(); setSearchOpen(false); };
  const navigate = (href: string) => { closeSearch(); mobile.current?.close(); router.push(href); };
  const themeToggle = () => {
    const next = dark ? 'light' : 'dark'; setTheme(next);
    try { localStorage.setItem('flofi-docs-theme', next); } catch { /* Keep the session preference. */ }
  };
  const nav = <nav aria-label="Documentation"> <Link href="/docs" aria-current={path === '/docs' ? 'page' : undefined} className={styles.overview} onClick={() => mobile.current?.close()}>⌂ <span>Overview</span></Link>
    {[...new Set(navigation.map(item => item.group))].map(group => <div className={styles.navGroup} key={group}><p>{group}</p>{navigation.filter(item => item.group === group).map(item => <Link key={item.slug} href={`/docs/${item.slug}`} aria-current={path === `/docs/${item.slug}` ? 'page' : undefined} onClick={() => mobile.current?.close()}>{item.title}</Link>)}</div>)}
    <div className={styles.sidebarNote}><span className={styles.statusDot}/>Built for explicit decisions<span>Intent → review → verify</span></div>
  </nav>;
  return <div className={styles.root} data-docs-theme={theme ?? 'system'} data-docs-ready={ready} data-docs-search-open={searchOpen}>
    <a className={styles.skipLink} href="#docs-content">Skip to content</a>
    <header className={styles.header}>
      <Link href="/" aria-label="FloFi home" className={styles.brand}><Image className={styles.lightLogo} src="/brand/flofi-symbol-light.svg" width={32} height={30} alt="" unoptimized/><Image className={styles.darkLogo} src="/brand/flofi-symbol-dark.svg" width={32} height={30} alt="" unoptimized/><Image className={styles.lightLogo} src="/brand/flofi-wordmark-light.png" width={79} height={30} alt="FloFi" unoptimized/><Image className={styles.darkLogo} src="/brand/flofi-wordmark-dark.png" width={79} height={30} alt="FloFi" unoptimized/></Link>
      <span className={styles.headerDivider}/><Link href="/docs" className={styles.docsLabel}>Docs</Link>
      <button className={styles.searchTrigger} onClick={openSearch} aria-label="Search documentation" aria-haspopup="dialog"><span aria-hidden="true">⌕</span><span>Search documentation</span><kbd aria-hidden="true">⌘ K</kbd></button>
      <div className={styles.headerActions}><a className={styles.github} href="https://github.com/alrimarleskovar/gryloo">Source code ↗</a><button className={styles.themeButton} onClick={themeToggle} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}><span aria-hidden="true">{dark ? '☀' : '☾'}</span></button><a className={styles.launch} href="/login">Launch FloFi <span aria-hidden="true">↗</span></a></div>
    </header>
    <div className={styles.mobileBar}><button onClick={() => mobile.current?.showModal()} aria-haspopup="dialog">☰ <span>Browse docs</span></button><span>{navigation.find(item => path.endsWith(`/${item.slug}`))?.title ?? 'Overview'}</span></div>
    <div className={styles.layout}><aside className={styles.sidebar}>{nav}</aside><div className={styles.content}><div key={path} className={styles.articleEntrance} data-docs-article-transition>{children}</div></div></div>
    <dialog ref={mobile} className={styles.mobileDialog} aria-label="Browse documentation" onKeyDown={containFocus}><div className={styles.dialogHeading}><strong>Documentation</strong><button aria-label="Close navigation" onClick={() => mobile.current?.close()}>✕</button></div>{nav}</dialog>
    <dialog ref={search} className={styles.searchDialog} aria-labelledby="docs-search-title" onKeyDown={containFocus} onClose={() => setSearchOpen(false)} onClick={event => { if (event.target === event.currentTarget) closeSearch(); }}>
      <div className={styles.searchInside}><div className={styles.dialogHeading}><strong id="docs-search-title">Search documentation</strong><button onClick={closeSearch} aria-label="Close search">Esc</button></div>
        <label className={styles.searchField}><span aria-hidden="true">⌕</span><input ref={input} type="search" placeholder="Try simulation, wallet, SDK…" aria-label="Search documentation" role="combobox" aria-expanded={searchOpen} aria-controls="docs-search-results" aria-autocomplete="list" aria-activedescendant={results.length ? `docs-result-${selected}` : undefined} value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => results.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0); }
          if (event.key === 'Enter' && results[selected]) { event.preventDefault(); navigate(results[selected].href); }
        }}/></label>
        <p className={styles.searchCount} role="status">{words.length ? `${results.length}${results.length === 9 ? '+' : ''} results` : 'Start exploring'}</p>
        <div id="docs-search-results" role="listbox" aria-label="Search results">{results.map((entry, i) => <Link role="option" aria-selected={selected === i} id={`docs-result-${i}`} className={styles.result} key={entry.href} href={entry.href} onClick={closeSearch} onMouseEnter={() => setSelected(i)}><span>{entry.group}</span><strong>{entry.title}{entry.section && <span> / {entry.section}</span>}</strong><p>{entry.text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').slice(0, 150)}…</p><b aria-hidden="true">↗</b></Link>)}</div>
        {!results.length && <div className={styles.noResults}><strong>No matching articles</strong><p>Try a broader term such as “network” or “authorization”.</p></div>}
        <div className={styles.searchFooter}>↑ ↓ navigate <span>↵ open article · Esc close</span></div>
      </div>
    </dialog>
  </div>;
}

export function TableOfContents({ sections }: { sections: { id: string; title: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: '-90px 0px -55% 0px', threshold: 0 });
    sections.forEach(section => { const element = document.getElementById(section.id); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, [sections]);
  return <nav aria-label="On this page" className={styles.toc}><p>On this page</p>{sections.map(section => <a key={section.id} href={`#${section.id}`} aria-current={active === section.id ? 'location' : undefined} onClick={() => setActive(section.id)}>{section.title}</a>)}<div><Link href="/docs/security">Security & authority <span aria-hidden="true">↗</span></Link></div></nav>;
}

export function CopyCode({ code }: { code: string }) {
  const [status, setStatus] = useState('Copy');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    if (timer.current) clearTimeout(timer.current);
    try { await navigator.clipboard.writeText(code); setStatus('Copied'); } catch { setStatus('Select code to copy'); }
    timer.current = setTimeout(() => setStatus('Copy'), 2500);
  };
  return <><button onClick={copy} aria-label="Copy code">{status} <span aria-hidden="true">{status === 'Copied' ? '✓' : '⧉'}</span></button><span className={styles.srOnly} role="status">{status === 'Copied' ? 'Code copied to clipboard' : status === 'Copy' ? '' : status}</span></>;
}
