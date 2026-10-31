-- SPDX-License-Identifier: AGPL-3.0-only
-- BUILD-FLOFI-AUTH-WALLETS-001: FloFi accounts. Identities, revocable session records and PUBLIC wallet metadata only.
-- No private key, seed phrase, OTP code, OAuth/OIDC token, password or session MAC key is ever stored here.
-- An account never owns or authorizes a workflow run: run access stays bound to verified wallet sessions.
-- Additive: no existing relation, function, trigger or index changes.
SET LOCAL lock_timeout = '5s';

CREATE TABLE flofi_accounts (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id),
  account_id text NOT NULL CHECK (account_id ~ '^acct_[0-9a-f]{32}$'),
  onboarding text NOT NULL DEFAULT 'PENDING' CHECK (onboarding IN ('PENDING', 'COMPLETED', 'DISMISSED')),
  -- The embedded-wallet provider organization that belongs to this person (a Turnkey sub-organization). FloFi's parent
  -- credentials can read it and start sign-in flows for it; they cannot sign with its keys.
  wallet_provider text CHECK (wallet_provider IN ('turnkey')),
  wallet_organization text CHECK (wallet_organization ~ '^[A-Za-z0-9-]{8,64}$'),
  wallet_user text CHECK (wallet_user ~ '^[A-Za-z0-9-]{8,64}$'),
  -- The sign-in method that the provider organization accepts for this person.
  wallet_login text CHECK (wallet_login IN ('GOOGLE', 'APPLE', 'EMAIL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, account_id),
  CHECK ((wallet_provider IS NULL) = (wallet_organization IS NULL)),
  CHECK ((wallet_provider IS NULL) = (wallet_user IS NULL)),
  CHECK ((wallet_provider IS NULL) = (wallet_login IS NULL))
);
CREATE UNIQUE INDEX flofi_accounts_wallet_organization ON flofi_accounts (tenant_id, wallet_provider, wallet_organization)
  WHERE wallet_organization IS NOT NULL;

-- One sign-in identity belongs to at most one account: identities are never merged or moved implicitly.
CREATE TABLE flofi_account_identities (
  tenant_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('GOOGLE', 'APPLE', 'EMAIL', 'EIP155', 'SOLANA')),
  subject text NOT NULL,
  account_id text NOT NULL,
  label text CHECK (label IS NULL OR length(label) BETWEEN 1 AND 254),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind, subject),
  FOREIGN KEY (tenant_id, account_id) REFERENCES flofi_accounts(tenant_id, account_id) ON DELETE CASCADE,
  CHECK (
    (kind = 'EIP155' AND subject ~ '^0x[0-9a-f]{40}$') OR
    (kind = 'SOLANA' AND subject ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') OR
    (kind = 'EMAIL' AND length(subject) <= 254 AND subject = lower(subject) AND subject ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') OR
    (kind IN ('GOOGLE', 'APPLE') AND subject ~ '^[A-Za-z0-9._-]{1,255}$'))
);
CREATE INDEX flofi_account_identities_account ON flofi_account_identities (tenant_id, account_id);

-- A server-side record per browser session: the sealed cookie is accepted only while its record exists, is unrevoked and unexpired.
CREATE TABLE flofi_account_sessions (
  tenant_id text NOT NULL,
  session_id text NOT NULL CHECK (session_id ~ '^[0-9a-f]{32}$'),
  account_id text NOT NULL,
  method text NOT NULL CHECK (method IN ('GOOGLE', 'APPLE', 'EMAIL', 'EIP155', 'SOLANA')),
  authenticated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, session_id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES flofi_accounts(tenant_id, account_id) ON DELETE CASCADE,
  CHECK (expires_at > authenticated_at)
);
CREATE INDEX flofi_account_sessions_account ON flofi_account_sessions (tenant_id, account_id, expires_at);
CREATE INDEX flofi_account_sessions_expiry ON flofi_account_sessions (tenant_id, expires_at);

-- Email one-time-code challenges, for attempt counting and per-address throttling. The code itself is never stored; the provider
-- verifies it. `browser_binding` is the browser's compressed public session point (public, not a secret).
CREATE TABLE flofi_account_email_challenges (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id),
  challenge_id text NOT NULL CHECK (challenge_id ~ '^[0-9a-f]{32}$'),
  email text NOT NULL CHECK (length(email) <= 254 AND email = lower(email)),
  provider_challenge text NOT NULL CHECK (provider_challenge ~ '^[A-Za-z0-9-]{8,128}$'),
  browser_binding text NOT NULL CHECK (browser_binding ~ '^0[23][0-9a-f]{64}$'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (tenant_id, challenge_id),
  CHECK (expires_at > created_at)
);
CREATE INDEX flofi_account_email_challenges_email ON flofi_account_email_challenges (tenant_id, email, created_at DESC);
CREATE INDEX flofi_account_email_challenges_recent ON flofi_account_email_challenges (tenant_id, created_at DESC);

-- Single-use sign-in proofs: the SHA-256 digest of each accepted OIDC ID token, kept until that token expires.
CREATE TABLE flofi_account_used_proofs (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, digest)
);
CREATE INDEX flofi_account_used_proofs_expiry ON flofi_account_used_proofs (tenant_id, expires_at);

-- Public wallet metadata. A wallet address appears under at most one account of a tenant. Removing a row removes FloFi's
-- association only: it never destroys an on-chain wallet, revokes a provider key or moves assets.
CREATE TABLE flofi_account_wallets (
  tenant_id text NOT NULL,
  ecosystem text NOT NULL CHECK (ecosystem IN ('EVM', 'SOLANA')),
  address text NOT NULL,
  account_id text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('GENERATED', 'IMPORTED', 'EXTERNAL')),
  provider text NOT NULL CHECK (provider ~ '^[A-Za-z0-9][A-Za-z0-9 ._:#-]{0,63}$'),
  provider_name text NOT NULL CHECK (length(provider_name) BETWEEN 1 AND 40),
  -- The provider's non-secret resource id (a Turnkey wallet or private-key id) for managed wallets.
  provider_resource text CHECK (provider_resource ~ '^[A-Za-z0-9-]{8,64}$'),
  export text NOT NULL CHECK (export IN ('NONE', 'RECOVERY_PHRASE', 'PRIVATE_KEY')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, ecosystem, address),
  FOREIGN KEY (tenant_id, account_id) REFERENCES flofi_accounts(tenant_id, account_id) ON DELETE CASCADE,
  CHECK ((ecosystem = 'EVM' AND address ~ '^0x[0-9a-f]{40}$') OR (ecosystem = 'SOLANA' AND address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')),
  -- External wallets (MetaMask, Phantom…) are never exportable and carry no provider resource.
  CHECK (origin <> 'EXTERNAL' OR (export = 'NONE' AND provider_resource IS NULL)),
  -- Managed wallets come from the embedded-wallet provider: a generated HD wallet keeps its recovery phrase; an imported key does not.
  CHECK (origin = 'EXTERNAL' OR (provider = 'turnkey' AND provider_resource IS NOT NULL)),
  CHECK (origin <> 'GENERATED' OR export = 'RECOVERY_PHRASE'),
  CHECK (origin <> 'IMPORTED' OR export = 'PRIVATE_KEY')
);
CREATE INDEX flofi_account_wallets_account ON flofi_account_wallets (tenant_id, account_id, created_at);
