// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
import { join } from 'node:path';

// Dedicated read-only landing checks. No chain fixtures, wallets or application providers.
const origin = process.env.FLOFI_MOTION_TEST_ORIGIN ?? 'http://127.0.0.1:3001';
if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(origin)) throw new Error('MOTION_TEST_REQUIRES_LOOPBACK');
const cache = process.env.BUILD002_BROWSER_CACHE;
export default defineConfig({
  testDir: './e2e', testMatch: ['landing07.spec.ts'], // BUILD-FLOFI-LANDING07-README-001: the landing at `/` (see RETIRED_LANDING_SPECS in playwright.config.ts).
  workers: 1, retries: 0, timeout: 30_000, reporter: 'list',
  outputDir: 'test-results/motion',
  use: {
    baseURL: origin, browserName: 'chromium', viewport: { width: 1440, height: 900 },
    reducedMotion: 'no-preference', serviceWorkers: 'block',
    launchOptions: cache ? { executablePath: join(cache, 'chrome-headless-shell-linux64/chrome-headless-shell') } : {},
    trace: 'off', screenshot: 'only-on-failure', video: 'off',
  },
});
