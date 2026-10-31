// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from 'next';
import { preload } from 'react-dom';
import Landing07Page from '../components/marketing/landing07-page';
import './landing07-fonts.css';

// BUILD-FLOFI-LANDING07-README-001: Caio's Landing 07 (`ROUTE_EXAMPLE/page.tsx`). Anton is served locally instead of through
// next/font/google (see public/fonts/README.md); the wrapper class provides the same `--font-landing-display` variable.
export const metadata: Metadata = {
  title: 'FloFi — DeFi sem complicação',
  description: 'Você pede. O FloFi prepara o caminho para criar, revisar e simular estratégias DeFi.',
  openGraph: { title: 'FloFi — DeFi sem complicação', description: 'Você pede. O FloFi prepara o caminho.', type: 'website' },
};
export default function Page() {
  preload('/fonts/landing07/anton-23aab0b2692a0c89.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  return <div className="landing07-fonts"><Landing07Page /></div>;
}
