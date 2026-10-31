// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-FLOFI-AUTH-WALLETS-001: Sign in with Apple returns here (`form_post` with an ID token). See `accounts/oidc-callback.ts`. */
import { oidcCallback } from '../../../../accounts/oidc-callback';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  let form: FormData;
  try { form = await request.formData(); } catch { form = new FormData(); }
  return oidcCallback('apple', form);
}
