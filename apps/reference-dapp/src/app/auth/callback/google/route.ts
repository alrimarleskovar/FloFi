// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-FLOFI-AUTH-WALLETS-001: Sign in with Google returns here (authorization code + PKCE). See `accounts/oidc-callback.ts`. */
import { oidcCallback } from '../../../../accounts/oidc-callback';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return oidcCallback('google', new URL(request.url).searchParams); }
