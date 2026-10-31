# BUILD-FLOFI-LANDING07-README-001 — evidence

Local evidence only: production builds served on loopback, Chromium headless shell 1243. Nothing here proves a deployment.

| File | What it shows |
| --- | --- |
| `01-hero-desktop-1440-pt.jpg`, `02-hero-desktop-1440-en.jpg`, `03-hero-mobile-390-pt.jpg` | Landing 07 first viewport as integrated (motion allowed, settled) |
| `04-full-page-desktop-1440-pt-reduced-motion.jpg`, `04-full-page-mobile-390-pt-reduced-motion.jpg` | Every section, with reduced motion |
| `05-compare-preview-desktop.jpg`, `06-compare-preview-mobile.jpg` | Caio's `PREVIEWS/` (left) beside the integrated page at the same viewport (right). His captures come from a dev server in his browser (Next.js dev badge, scrollbar, JPEG) |
| `07-flow-landing-cta-to-login-1440.jpg`, `08-flow-login-to-app-without-account-1440.jpg` | Hero CTA → `/login` → "Explore the builder without an account" → `/app` (no account configured in this run) |
| `pixel-comparison.json` | 16 captures of `/` built from the package's own `ROUTE_EXAMPLE/page.tsx` versus the integrated route: **0 differing pixels**. Repeated after synchronizing with PR #143 `a0414d4` (merge `8c52274`): again 0 differing pixels in all 16 captures |

The hero's "F" top bar is hidden behind the ribbon on desktop in both the package's preview and the integration. That is the
package's own open item (`PENDENCIA_HERO_F.md`), left unchanged by this build.

JPEGs are for viewing; the pixel comparison was made on lossless PNG captures.
