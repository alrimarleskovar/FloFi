#!/usr/bin/env python3
"""Bootstrap the approved toolchain using only Python's standard library."""

import base64
import gzip
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import platform
import re
import shlex
import subprocess
import ssl
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from governance_lite import (AGE_WAIVER, APPROVED_AGE_WAIVERS, LEGACY_AGE_WAIVERS, dependency_age_waivers,
                             dependency_release_age_allowed)
from ci_archive_cache import verified_archive

NODE_VERSION = "24.21.0"
PNPM_VERSION = "11.22.0"
NODE_ARCHIVE = f"node-v{NODE_VERSION}-linux-x64.tar.xz"
NODE_URL = f"https://nodejs.org/dist/v{NODE_VERSION}/{NODE_ARCHIVE}"
NODE_SUMS_URL = f"https://nodejs.org/dist/v{NODE_VERSION}/SHASUMS256.txt"
NODE_SHA256 = "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6"
PNPM_URL = f"https://registry.npmjs.org/pnpm/-/pnpm-{PNPM_VERSION}.tgz"
PNPM_SHA512 = "H/hwxMYTPf2I+yr8Rt0T1H8JyXlLQ4xv20fKmMrzvBY4HuC+k6CRuOOCTPAfiJ9G19niCRD7C+GrD7W6qA3WIQ=="


DOWNLOAD_ATTEMPTS = 3
DOWNLOAD_TIMEOUT = 90
DOWNLOAD_BUDGET = 300
RETRYABLE_HTTP_STATUS = {408, 429, 500, 502, 503, 504}


def fetch(url, *, compressed=False, stage="registry metadata"):
    # Log only a controlled stage and sanitized hostname, never URL credentials,
    # paths, query strings or exception messages returned by an upstream server.
    host = re.sub(r"[^a-zA-Z0-9.-]", "_", urllib.parse.urlsplit(url).hostname or "unknown")
    label = f"Download stage={stage} host={host}"
    request = urllib.request.Request(url, headers={"Accept-Encoding": "gzip"} if compressed else {})
    deadline = time.monotonic() + DOWNLOAD_BUDGET
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(f"{label}: download time budget exhausted") from None
        print(f"{label} attempt={attempt}/{DOWNLOAD_ATTEMPTS}", flush=True)
        try:
            with urllib.request.urlopen(request, timeout=min(DOWNLOAD_TIMEOUT, remaining)) as response:
                if response.status != 200:
                    raise urllib.error.HTTPError(url, response.status, "Download unavailable", {}, None)
                # read1 performs at most one underlying read, so a slow trickle
                # cannot indefinitely hide the elapsed budget inside read(). A
                # blocking operation also retains its finite socket timeout.
                data = bytearray()
                while True:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Download time budget exhausted")
                    chunk = response.read1(1024 * 1024)
                    if not chunk:
                        break
                    data.extend(chunk)
                length = response.headers.get("Content-Length")
                if length is not None and len(data) != int(length):
                    raise http.client.IncompleteRead(b"")
                encoding = response.headers.get("Content-Encoding", "identity")
                if encoding == "gzip":
                    return gzip.decompress(data)
                if encoding != "identity":
                    raise RuntimeError("Unsupported registry content encoding")
                return bytes(data)
        except urllib.error.HTTPError as exc:
            exc.close()
            if exc.code not in RETRYABLE_HTTP_STATUS:
                raise RuntimeError(f"{label} attempt={attempt}: HTTP {exc.code}; not retryable") from None
            reason = f"HTTP {exc.code}"
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, ssl.SSLError):
                raise RuntimeError(f"{label} attempt={attempt}: TLS verification/transport failure") from None
            reason = "connection failure"
        except (TimeoutError, ConnectionError, http.client.IncompleteRead,
                http.client.RemoteDisconnected, ssl.SSLEOFError, EOFError) as exc:
            reason = type(exc).__name__
        # Do not carry failed response bytes into another attempt or archive.
        data = None
        delay = 2 ** attempt
        if attempt == DOWNLOAD_ATTEMPTS or time.monotonic() + delay >= deadline:
            raise RuntimeError(f"{label}: failed after {attempt} attempt(s) ({reason}); retries exhausted") from None
        print(f"{label} attempt={attempt}/{DOWNLOAD_ATTEMPTS} failed={reason}; retry_in={delay}s", flush=True)
        time.sleep(delay)


def registry_metadata(locked):
    """One fresh full metadata response per name; retain every locked version.

    No disk cache, abbreviated metadata or offline fallback: publication times,
    license and dist.integrity are still checked against the live registry.
    Keep the existing eight network workers and bound retained data to the pins.
    """
    import concurrent.futures

    grouped = {}
    for identity in sorted(locked):
        name, version = identity.rsplit("@", 1)
        grouped.setdefault(name, []).append(version)

    def acquire(item):
        name, versions = item
        try:
            metadata = json.loads(fetch("https://registry.npmjs.org/" + name.replace("/", "%2f"), compressed=True))
            return {name + "@" + version: (metadata["versions"][version], metadata["time"][version], None)
                    for version in versions}
        except Exception as exc:
            return {name + "@" + version: (None, None, str(exc)) for version in versions}

    result = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for records in pool.map(acquire, sorted(grouped.items())):
            result.update(records)
    print("Fresh registry metadata responses:", len(grouped), "locked versions:", len(locked), flush=True)
    return result


def extract(data, destination):
    # Python's data filter blocks absolute/traversal paths and unsafe links.
    # No compatibility fallback to unrestricted extraction is permitted.
    if not hasattr(tarfile, "data_filter"):
        raise RuntimeError("Python tarfile.data_filter is required")
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
        archive.extractall(destination, filter="data")


def checked_output(command):
    result = subprocess.check_output(command, text=True).strip()
    print(result, flush=True)
    return result


def main():
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise RuntimeError("The approved toolchain requires Linux x64")
    checked_output(["git", "--version"])
    checked_output(["python3", "--version"])
    print("Toolchain target: linux x64; Corepack is not used", flush=True)
    package = json.loads(Path("package.json").read_text())
    if package["packageManager"] != f"pnpm@{PNPM_VERSION}":
        raise RuntimeError("Root packageManager differs from approved version")
    if Path(".node-version").read_text().strip() != NODE_VERSION:
        raise RuntimeError(".node-version differs from approved version")
    print("packageManager:", package["packageManager"], flush=True)
    sums = fetch(NODE_SUMS_URL, stage="Node checksum manifest").decode("ascii").splitlines()
    entries = [line.split() for line in sums if line.split()[-1:] == [NODE_ARCHIVE]]
    if entries != [[NODE_SHA256, NODE_ARCHIVE]]:
        raise RuntimeError("Official Node checksum entry differs from approved digest")
    base = Path(os.environ.get("RUNNER_TEMP", tempfile.gettempdir()))
    def download_node(output):
        output.write(fetch(NODE_URL, stage="Node archive"))
    with verified_archive(NODE_ARCHIVE, base, download_node, NODE_SHA256) as archive:
        node_bytes = archive.read_bytes()
    node_digest = hashlib.sha256(node_bytes).hexdigest()
    print("Node SHA-256 expected:", NODE_SHA256, flush=True)
    print("Node SHA-256 actual:  ", node_digest, flush=True)
    if node_digest != NODE_SHA256:
        raise RuntimeError("Node archive checksum mismatch")
    def download_pnpm(output):
        output.write(fetch(PNPM_URL, stage="pnpm archive"))
    with verified_archive(f"pnpm-{PNPM_VERSION}.tgz", base, download_pnpm,
                          base64.b64decode(PNPM_SHA512).hex(), algorithm="sha512") as archive:
        pnpm_bytes = archive.read_bytes()
    pnpm_digest = base64.b64encode(hashlib.sha512(pnpm_bytes).digest()).decode()
    print("pnpm SRI expected: sha512-" + PNPM_SHA512, flush=True)
    print("pnpm SRI actual:   sha512-" + pnpm_digest, flush=True)
    if pnpm_digest != PNPM_SHA512:
        raise RuntimeError("pnpm archive integrity mismatch")
    target = Path(tempfile.mkdtemp(prefix="build-001-toolchain-", dir=base))
    extract(node_bytes, target / "node")
    extract(pnpm_bytes, target / "pnpm")
    node = target / "node" / f"node-v{NODE_VERSION}-linux-x64" / "bin" / "node"
    pnpm = target / "pnpm" / "package" / "bin" / "pnpm.mjs"
    if not pnpm.is_file():
        raise RuntimeError("Approved pnpm bin/pnpm.mjs is missing")
    if checked_output([str(node), "--version"]) != "v" + NODE_VERSION:
        raise RuntimeError("Node version mismatch")
    if checked_output([str(node), "-p", "process.platform+' '+process.arch"]) != "linux x64":
        raise RuntimeError("Node runtime architecture mismatch")
    if checked_output([str(node), str(pnpm), "--version"]) != PNPM_VERSION:
        raise RuntimeError("pnpm version mismatch")
    bindir = target / "bin"
    bindir.mkdir()
    (bindir / "node").symlink_to(node)
    shim = bindir / "pnpm"
    shim.write_text("#!/bin/sh\nexec " + shlex.quote(str(node)) + " " +
                    shlex.quote(str(pnpm)) + ' "$@"\n')
    shim.chmod(0o755)
    # Only this verified bin directory is prepended. No runner Node fallback.
    if "GITHUB_PATH" in os.environ:
        with open(os.environ["GITHUB_PATH"], "a", encoding="utf-8") as stream:
            stream.write(str(bindir) + "\n")
    if "GITHUB_ENV" in os.environ:
        with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as stream:
            stream.write("BUILD001_TOOLCHAIN_BIN=" + str(bindir) + "\n")
    print("BUILD001_TOOLCHAIN_BIN=" + str(bindir), flush=True)



# Exactly the 16 reviewed BUILD-002 identities, refreshed for the owner-approved
# Colosseum sharp security patch (same license obligations, routes and platforms). This is not a
# license allowlist: each record also pins its SRI, graph route and platform.
BUILD002_REVIEWED_LICENSE_EXCEPTIONS = {'@img/sharp-libvips-darwin-arm64@1.3.4': {'cpu': ['arm64'],
                                           'integrity': 'sha512-5R89nBYiRdUlSWJxPhO+GVtaXzXSxKnRu/xqMn3KTA3L9EB9Oy/P+Nn2f2vlhPuUdy/Zusb2DarbyTpGCfEDuw==',
                                           'libc': None,
                                           'license': 'LGPL-3.0-or-later',
                                           'optional': True,
                                           'os': ['darwin'],
                                           'route': 'sharp'},
 '@img/sharp-libvips-darwin-x64@1.3.4': {'cpu': ['x64'],
                                         'integrity': 'sha512-iR2OKH80yi0U+dUplyh3/xdpFvps6YkCwsXenIJxqxR1v9o+xtKTGbS9H7cps+2Vxjc8B1j96p75NmTGjIhtpQ==',
                                         'libc': None,
                                         'license': 'LGPL-3.0-or-later',
                                         'optional': True,
                                         'os': ['darwin'],
                                         'route': 'sharp'},
 '@img/sharp-libvips-linux-arm64@1.3.4': {'cpu': ['arm64'],
                                          'integrity': 'sha512-Y3dgX/6lE2QhQb+Gxy0WZxfg9MEm/JBjamZpS2IklP7xIQoKN4hzAm7KcMVGtaVDt3neE9OKBC7vAfonA/Lr1A==',
                                          'libc': ['glibc'],
                                          'license': 'LGPL-3.0-or-later',
                                          'optional': True,
                                          'os': ['linux'],
                                          'route': 'sharp'},
 '@img/sharp-libvips-linux-arm@1.3.4': {'cpu': ['arm'],
                                        'integrity': 'sha512-LmRtTsOHuvM2+wlO2Db37dx5MiZhB0FvSunciw48YjdOkZz9KAiRbm8ujeMOA1INqmei5NapFxYEK1D1ZSidmw==',
                                        'libc': ['glibc'],
                                        'license': 'LGPL-3.0-or-later',
                                        'optional': True,
                                        'os': ['linux'],
                                        'route': 'sharp'},
 '@img/sharp-libvips-linux-ppc64@1.3.4': {'cpu': ['ppc64'],
                                          'integrity': 'sha512-Le6boB8Tai0Nis+gIxIpKx68UDVVIqdR8Tin5Yf1z2LJJQLDJvCDRqRu+jC2qCoD+eIomonmOwB4smBRxfVpYQ==',
                                          'libc': ['glibc'],
                                          'license': 'LGPL-3.0-or-later',
                                          'optional': True,
                                          'os': ['linux'],
                                          'route': 'sharp'},
 '@img/sharp-libvips-linux-riscv64@1.3.4': {'cpu': ['riscv64'],
                                            'integrity': 'sha512-aHkkIEHPRdQEegJN20MLmGtxYD9R2wQr3Cwpddnu5+YKMt6Uzax7S9h5gpZTo8wyrGuZSlfQ63OevL5mTyOC7Q==',
                                            'libc': ['glibc'],
                                            'license': 'LGPL-3.0-or-later',
                                            'optional': True,
                                            'os': ['linux'],
                                            'route': 'sharp'},
 '@img/sharp-libvips-linux-s390x@1.3.4': {'cpu': ['s390x'],
                                          'integrity': 'sha512-ra/mB6MikESDUO7Yg+Mi95bFBb9GsObURuhnOv3OqknjGe9sZrG8tCe9q0xSIGrtLgvgw0gKnFWcK4blSgQOuQ==',
                                          'libc': ['glibc'],
                                          'license': 'LGPL-3.0-or-later',
                                          'optional': True,
                                          'os': ['linux'],
                                          'route': 'sharp'},
 '@img/sharp-libvips-linux-x64@1.3.4': {'cpu': ['x64'],
                                        'integrity': 'sha512-GJ//SSXbnwSDes02umB3nDJLFcQzw8a18V8fyhqr6tV515tOEMdImjjxj1AoafMRz56F3PHgftnj1QEKSU1zkw==',
                                        'libc': ['glibc'],
                                        'license': 'LGPL-3.0-or-later',
                                        'optional': True,
                                        'os': ['linux'],
                                        'route': 'sharp'},
 '@img/sharp-libvips-linuxmusl-arm64@1.3.4': {'cpu': ['arm64'],
                                              'integrity': 'sha512-hvulFwtjUcagsis6BBxHwGFwWoNZjgYmULGVrZcyfNbjA8hKILbRxGg15/7w5HDyXHXUos/j6baAWqnCyQ2DWA==',
                                              'libc': ['musl'],
                                              'license': 'LGPL-3.0-or-later',
                                              'optional': True,
                                              'os': ['linux'],
                                              'route': 'sharp'},
 '@img/sharp-libvips-linuxmusl-x64@1.3.4': {'cpu': ['x64'],
                                            'integrity': 'sha512-6zXKeE/p39I1AmA3cJG35eyBGNqNddLnUXjhwBnsGjFPWqf5VKkDBEqaEkPDoTEtkxwi2vv8Tcr2mDyP4So7Fg==',
                                            'libc': ['musl'],
                                            'license': 'LGPL-3.0-or-later',
                                            'optional': True,
                                            'os': ['linux'],
                                            'route': 'sharp'},
 '@img/sharp-wasm32@0.35.5': {'cpu': None,
                              'integrity': 'sha512-Ptsga1su4tQx+LLF1ECS9U6nz5kmrXKo6XVbtR48Ke3ZRxxgaWBu7IDtEe1quo8hiupwm6WFqxVlXaSf7IINGQ==',
                              'libc': None,
                              'license': 'Apache-2.0 AND LGPL-3.0-or-later AND MIT',
                              'optional': True,
                              'os': None,
                              'route': 'wasm'},
 '@img/sharp-win32-arm64@0.35.5': {'cpu': ['arm64'],
                                   'integrity': 'sha512-X4t7g+7ZA5DKblCBEXGjUqqemj4vczING/5viFwAL8h4N3qYeyjwdCvRLHi4EdOUI+2Z7UFlp1VM+p/AuEtm6Q==',
                                   'libc': None,
                                   'license': 'Apache-2.0 AND LGPL-3.0-or-later',
                                   'optional': True,
                                   'os': ['win32'],
                                   'route': 'sharp'},
 '@img/sharp-win32-ia32@0.35.5': {'cpu': ['ia32'],
                                  'integrity': 'sha512-5Zm82LoBc43nhwNybZlG7Y1KO//Zhsn306fQl29ZOuStHLGTo3BWL83q3cznX0poxSAMuYL1On/BHBxkBeKr6A==',
                                  'libc': None,
                                  'license': 'Apache-2.0 AND LGPL-3.0-or-later',
                                  'optional': True,
                                  'os': ['win32'],
                                  'route': 'sharp'},
 '@img/sharp-win32-x64@0.35.5': {'cpu': ['x64'],
                                 'integrity': 'sha512-x76eH0vEiHlcMQu8Y8IenntaACtddpT6W0wmXtWrnKcnKI7ME5DdgqhAD6SEWOEl1v2zDvkZDhFA9KnURwpfqg==',
                                 'libc': None,
                                 'license': 'Apache-2.0 AND LGPL-3.0-or-later',
                                 'optional': True,
                                 'os': ['win32'],
                                 'route': 'sharp'},
 'caniuse-lite@1.0.30001810': {'cpu': None,
                               'integrity': 'sha512-TITQPUkaz+aVk5GL6NhOdwk1aEaNTSDPsGFWrTuhKGtjTF70jL/Oht2W4c6rXUe5fu7Ie19VIahAXHIIiWWNeg==',
                               'libc': None,
                               'license': 'CC-BY-4.0',
                               'optional': False,
                               'os': None,
                               'route': 'next'},
 'tslib@2.8.1': {'cpu': None,
                 'integrity': 'sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==',
                 'libc': None,
                 'license': '0BSD',
                 'optional': False,
                 'os': None,
                 'route': 'helpers'}}

BUILD002_DIRECT_VERSIONS = {
    "@xyflow/react": "12.11.6",
    "next": "16.4.1",  # BUILD-CHAT-E2E-001: fixes the three October Next.js advisories; sharp remains pinned.
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "@playwright/test": "1.63.0",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
}

# BUILD-003D exact direct pins (MIT, no license exception). @noble/curves
# depends only on @noble/hashes at the same exact version.
BUILD003D_DIRECT_VERSIONS = {
    "@noble/hashes": "2.4.0",
    "@noble/curves": "2.4.0",
}

# BUILD-003D private AGPL reference packages and their exact dependencies.
BUILD003D_REFERENCE_PACKAGES = {
    # BUILD-014: Solana Ed25519 signature/PDA checks reuse the already-pinned @noble/curves.
    "packages/reference-compiler/package.json": ("@defi-workflow-engine/reference-compiler", {
        "@defi-workflow-engine/action-registry": "workspace:0.1.0",
        "@defi-workflow-engine/workflow-contracts": "workspace:0.3.0",
        "@noble/curves": "2.4.0",
        "@noble/hashes": "2.4.0",
    }),
    "packages/reference-executor/package.json": ("@defi-workflow-engine/reference-executor", {
        "@defi-workflow-engine/reference-compiler": "workspace:0.1.0",
        "@defi-workflow-engine/workflow-contracts": "workspace:0.3.0",
        "@noble/curves": "2.4.0",
        "@noble/hashes": "2.4.0",
    }),
    "packages/reference-reconciler/package.json": ("@defi-workflow-engine/reference-reconciler", {
        "@defi-workflow-engine/action-registry": "workspace:0.1.0",
        "@defi-workflow-engine/reference-compiler": "workspace:0.1.0",
        "@defi-workflow-engine/workflow-contracts": "workspace:0.3.0",
        "@noble/curves": "2.4.0",
        "@noble/hashes": "2.4.0",
    }),
}

# BUILD-CLOUD-001 exact direct pins for the PostgreSQL driver (MIT; its 13 transitive registry
# packages are MIT/ISC, no license exception). Only the private cloud-runtime package uses them.
BUILDCLOUD001_DIRECT_VERSIONS = {
    "pg": "8.23.0",
    "@types/pg": "8.23.1",
}
BUILDCLOUD001_CLOUD_RUNTIME = ("packages/cloud-runtime/package.json", "@defi-workflow-engine/cloud-runtime",
                               {"@defi-workflow-engine/reference-executor": "workspace:0.1.0", "pg": "8.23.0"},
                               {"@types/pg": "8.23.1"})
# BUILD-MCP-001 exact direct pin for the official MCP TypeScript SDK v2 server. Its only registry
# dependencies are @modelcontextprotocol/core@2.3.0 and zod@4.6.6 (no license exception). From 2.3.0 the
# SDK's manifests declare Apache-2.0 (MIT through 2.2.0); zod remains MIT. The reference app also links the
# already approved BUILD-001 pins @sinclair/typebox and ajv for tool schemas.
BUILDMCP001_DIRECT_VERSIONS = {
    # Security patch for GHSA-jm63-cq47-j5jp, GHSA-46jr-4wx8-v453 and GHSA-rvq5-wwqv-78pq (server/core only move).
    "@modelcontextprotocol/server": "2.3.0",
}
# BUILD-CLOUD-001 adds 15 registry packages (pg, @types/pg and their MIT/ISC dependencies) to the 247;
# Current main retains 262 after the Colosseum security updates; BUILD-MCP-001 adds
# 3 (@modelcontextprotocol/server, @modelcontextprotocol/core, zod) to that graph.
# BUILD-CHAT-E2E-001: Vitest 5.0.3 requires why-is-node-running 3.2.1, removing siginfo and stackback.
# GHSA-mrhx-c7xc-m3w5: the MCP SDK's zod moves 4.6.5 → 4.6.6 by exact override (MIT, no dependencies); the count is unchanged.
# GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr, GHSA-xhq7-xmqj-769h, GHSA-333x-w4r6-6crp: ajv's fast-uri moves 3.1.8 → 3.1.9 by exact
# override (BSD-3-Clause, no dependencies); the count is unchanged.
# BUILD-FLOFI-AUTH-WALLETS-001 adds 8 (Apache-2.0/MIT): @turnkey/iframe-stamper (no dependencies) and @turnkey/indexed-db-stamper
# with @turnkey/encoding, @turnkey/sdk-types, bs58, bs58check, base-x and @noble/hashes. Owner review: these are the provider's
# isolated import/export iframe bridge and its non-extractable WebCrypto session-key stamper; FloFi holds no wallet key.
# BUILD-FLOFI-AUTH-WALLETS-001 (encrypted email codes) adds 23 with @turnkey/crypto@2.13.3 (Apache-2.0): @noble/ciphers@1.3.0,
# @noble/curves@1.9.0, borsh, cbor-js, @peculiar/x509 and its asn1 packages, asn1js, pvtsutils, pvutils, reflect-metadata, tsyringe and
# tslib@1.14.1 (0BSD, exact identity below). Owner review: Turnkey's own encryption of the email code to its enclave (verified enclave
# signature, HPKE) and verification-token check; FloFi writes no cryptography. No install scripts; no eval/new Function.
REGISTRY_PACKAGE_COUNT = 295
# BUILD-FLOFI-AUTH-WALLETS-001: the embedded-wallet provider's browser stampers (docs/builds/BUILD-FLOFI-AUTH-WALLETS-001.md).
BUILDAUTHWALLETS001_DIRECT_VERSIONS = {
    "@turnkey/crypto": "2.13.3",
    "@turnkey/iframe-stamper": "2.11.1",
    "@turnkey/indexed-db-stamper": "1.3.12",
}

# The pre-existing BUILD-001 MPL tooling exception is exact-name scoped too.
BUILD001_LIGHTNINGCSS_NAMES = {
    "lightningcss",
    "lightningcss-android-arm64",
    "lightningcss-darwin-arm64",
    "lightningcss-darwin-x64",
    "lightningcss-freebsd-x64",
    "lightningcss-linux-arm-gnueabihf",
    "lightningcss-linux-arm64-gnu",
    "lightningcss-linux-arm64-musl",
    "lightningcss-linux-x64-gnu",
    "lightningcss-linux-x64-musl",
    "lightningcss-win32-arm64-msvc",
    "lightningcss-win32-x64-msvc",
}


def verify_dependencies():
    """Verify every registry entry and the exact approved license exceptions.

    Continue through the whole graph, collect all violations, and fail before
    writing evidence if any identity, SPDX expression, SRI, route, platform,
    optional status, publication age, or direct pin differs.
    """
    import collections
    import datetime
    import re

    errors = []
    waiver_files = {"pnpm-workspace.yaml": Path("pnpm-workspace.yaml").read_text()}
    if Path(AGE_WAIVER).is_file():
        waiver_files[AGE_WAIVER] = Path(AGE_WAIVER).read_text()
    for entry in APPROVED_AGE_WAIVERS:
        review = str(entry.get("review", "")).split("#", 1)[0]
        if review and Path(review).is_file():
            waiver_files[review] = Path(review).read_text()
    age_waivers, waiver_errors = dependency_age_waivers(waiver_files)
    errors.extend(waiver_errors)
    plan = Path("docs/builds/BUILD-001-PLAN.md").read_text()
    pin_rows = re.findall(
        r"(?m)^\| `([^`]+)` \| `([0-9.]+)` \|.*\| ([A-Za-z0-9.-]+) \| `(sha512-[A-Za-z0-9+/=]+)` \|$", plan)
    pins = {name + "@" + version: (license_id, digest)
            for name, version, license_id, digest in pin_rows}
    if len(pins) != 12:
        errors.append("Expected twelve approved BUILD-001 direct dependency pins")

    lock = Path("pnpm-lock.yaml").read_text()
    if lock.count("\npackages:\n") != 1 or lock.count("\nsnapshots:\n") != 1:
        raise RuntimeError("Unrecognized lockfile sections")
    resolved_sections = "packages:\n" + lock.split("\npackages:\n", 1)[1]
    if hashlib.sha256(resolved_sections.encode()).hexdigest() != "978db9a42627fb6d11316e6496ef8ccd76dc2f92a0e6269a63ba0be5d908b7ac":
        errors.append("Baseline registry packages/snapshots or peer resolutions changed")
    packages_text = lock.split("\npackages:\n", 1)[1].split("\nsnapshots:\n", 1)[0]
    snapshots_text = lock.split("\nsnapshots:\n", 1)[1]

    def blocks(section, allow_empty):
        pattern = r"(?m)^  (\S[^\n]*):(?: \{\})?$" if allow_empty else r"(?m)^  (\S[^\n]*):$"
        headers = list(re.finditer(pattern, section))
        result = {}
        for index, match in enumerate(headers):
            identity = match.group(1).strip("'")
            stop = headers[index + 1].start() if index + 1 < len(headers) else len(section)
            if identity in result:
                errors.append(f"Duplicate lock block: {identity}")
            result[identity] = section[match.end():stop]
        return result

    package_blocks = blocks(packages_text, False)
    snapshot_blocks = blocks(snapshots_text, True)
    locked = {}
    for identity, body in package_blocks.items():
        integrity = re.findall(r"resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)\}", body)
        if len(integrity) != 1:
            errors.append(f"Non-registry or missing integrity: {identity}")
        else:
            locked[identity] = integrity[0]
    if len(package_blocks) != REGISTRY_PACKAGE_COUNT or len(locked) != REGISTRY_PACKAGE_COUNT or len(snapshot_blocks) != REGISTRY_PACKAGE_COUNT:
        errors.append(f"BUILD-CLOUD-001 lock count drift: packages={len(package_blocks)}, "
                      f"registry={len(locked)}, snapshots={len(snapshot_blocks)}")
    for identity, (_, digest) in pins.items():
        if locked.get(identity) != digest:
            errors.append(f"BUILD-001 direct integrity mismatch: {identity}")

    # BUILD-007 owner-approved additive contracts 0.3.0 and exact six consumer links.
    contracts = json.loads(Path("packages/workflow-contracts/package.json").read_text())
    if contracts.get("version") != "0.3.0" or contracts.get("private") is not True:
        errors.append("BUILD-007 workflow-contracts workspace version differs")
    registry = json.loads(Path("packages/action-registry/package.json").read_text())
    # BUILD-RH-002 (owner review): keccak-256 for EIP-55 checksums and CREATE2 Uniswap v3 pool identities, from the same locked
    # @noble/hashes 2.4.0 (SRI-pinned above) that reference-compiler, reference-executor and reference-reconciler already use.
    if registry.get("dependencies") != {
        "@defi-workflow-engine/workflow-contracts": "workspace:0.3.0",
        "@noble/hashes": "2.4.0",
        "@sinclair/typebox": "0.34.52",
        "ajv": "8.20.0",
    }:
        errors.append("BUILD-007 action-registry workspace pin differs")
    app = json.loads(Path("apps/reference-dapp/package.json").read_text())
    expected_app_dependencies = {
        "@defi-workflow-engine/action-registry": "workspace:0.1.0",
        # BUILD-CLOUD-001: the backend entry point in the app links the private infrastructure adapters.
        "@defi-workflow-engine/cloud-runtime": "workspace:0.1.0",
        # BUILD-003F: the app links the three already locked reference packages; no registry identity changes.
        "@defi-workflow-engine/reference-compiler": "workspace:0.1.0",
        "@defi-workflow-engine/reference-executor": "workspace:0.1.0",
        "@defi-workflow-engine/reference-linter": "workspace:0.1.0",
        "@defi-workflow-engine/reference-reconciler": "workspace:0.1.0",
        "@defi-workflow-engine/workflow-contracts": "workspace:0.3.0",
        **{key: BUILD002_DIRECT_VERSIONS[key] for key in
           ("@xyflow/react", "next", "react", "react-dom")},
        # BUILD-MCP-001: the remote MCP gateway (official SDK) and its tool schemas (approved BUILD-001 pins).
        **BUILDMCP001_DIRECT_VERSIONS,
        "@sinclair/typebox": "0.34.52",
        "ajv": "8.20.0",
        **BUILDAUTHWALLETS001_DIRECT_VERSIONS,
    }
    expected_app_dev = {key: BUILD002_DIRECT_VERSIONS[key] for key in
                        ("@playwright/test", "@types/react", "@types/react-dom")}
    if app.get("dependencies") != expected_app_dependencies or app.get("devDependencies") != expected_app_dev:
        errors.append("BUILD-002 direct manifest versions or workspace links differ")
    linter = json.loads(Path("packages/reference-linter/package.json").read_text())
    expected_linter_dependencies = {
        "@defi-workflow-engine/action-registry": "workspace:0.1.0",
        "@defi-workflow-engine/workflow-contracts": "workspace:0.3.0",
        "ajv": "8.20.0",
        "canonicalize": "5.0.0",
    }
    if (linter.get("name") != "@defi-workflow-engine/reference-linter" or
            linter.get("version") != "0.1.0" or linter.get("private") is not True or
            linter.get("license") != "AGPL-3.0-only" or
            linter.get("dependencies") != expected_linter_dependencies):
        errors.append("BUILD-003A linter manifest identity or exact dependencies differ")
    importer_section = lock.split("\nimporters:\n", 1)[1].split("\npackages:\n", 1)[0]

    def importer_block(path):
        match = re.search(rf"(?ms)^  {re.escape(path)}:\n(.*?)(?=^  \S|\Z)", importer_section)
        return match.group(1) if match else ""

    registry_importer = importer_block("packages/action-registry")
    if "      '@defi-workflow-engine/workflow-contracts':\n        specifier: workspace:0.3.0\n        version: link:../workflow-contracts\n" not in registry_importer:
        errors.append("BUILD-007 action-registry lock importer differs")
    linter_importer = importer_block("packages/reference-linter")
    expected_linter_importer = """    dependencies:
      '@defi-workflow-engine/action-registry':
        specifier: workspace:0.1.0
        version: link:../action-registry
      '@defi-workflow-engine/workflow-contracts':
        specifier: workspace:0.3.0
        version: link:../workflow-contracts
      ajv:
        specifier: 8.20.0
        version: 8.20.0
      canonicalize:
        specifier: 5.0.0
        version: 5.0.0
"""
    if linter_importer.strip() != expected_linter_importer.strip():
        errors.append("BUILD-003A linter lock importer differs")
    app_importer = importer_section.split("  apps/reference-dapp:\n", 1)[1].split("\n  packages/action-registry:", 1)[0]
    if "      '@defi-workflow-engine/workflow-contracts':\n        specifier: workspace:0.3.0\n        version: link:../../packages/workflow-contracts\n" not in app_importer:
        errors.append("BUILD-007 app lock workflow-contracts link differs")
    if app_importer.count("'@defi-workflow-engine/reference-linter':") != 1 or not re.search(
            r"(?m)^      '@defi-workflow-engine/reference-linter':\n        specifier: workspace:0\.1\.0\n        version: link:\.\./\.\./packages/reference-linter$",
            app_importer):
        errors.append("BUILD-003A app lock workspace link differs")
    for package in ("reference-compiler", "reference-executor", "reference-reconciler"):
        if app_importer.count(f"'@defi-workflow-engine/{package}':") != 1 or not re.search(
                rf"(?m)^      '@defi-workflow-engine/{package}':\n        specifier: workspace:0\.1\.0\n        version: link:\.\./\.\./packages/{package}$",
                app_importer):
            errors.append(f"BUILD-003F app lock workspace link differs: {package}")
    for identity in BUILD002_DIRECT_VERSIONS:
        package_id = identity + "@" + BUILD002_DIRECT_VERSIONS[identity]
        if package_id not in locked:
            errors.append(f"BUILD-002 direct lock identity missing: {package_id}")
    for identity, version in BUILD003D_DIRECT_VERSIONS.items():
        if identity + "@" + version not in locked:
            errors.append(f"BUILD-003D direct lock identity missing: {identity}@{version}")
    for manifest_path, (name, expected) in BUILD003D_REFERENCE_PACKAGES.items():
        manifest = json.loads(Path(manifest_path).read_text())
        if (manifest.get("name") != name or manifest.get("version") != "0.1.0" or
                manifest.get("private") is not True or manifest.get("license") != "AGPL-3.0-only" or
                manifest.get("dependencies") != expected or "devDependencies" in manifest):
            errors.append(f"BUILD-003D reference package manifest differs: {manifest_path}")
        block = importer_block(manifest_path.rsplit("/", 1)[0])
        for dependency, version in expected.items():
            target = ("link:../" + dependency.split("/", 1)[1]) if version.startswith("workspace:") else version
            if f"      '{dependency}':\n        specifier: {version}\n        version: {target}\n" not in block:
                errors.append(f"BUILD-003D lock importer differs: {manifest_path} {dependency}")
    cloud_path, cloud_name, cloud_dependencies, cloud_dev = BUILDCLOUD001_CLOUD_RUNTIME
    cloud = json.loads(Path(cloud_path).read_text())
    if (cloud.get("name") != cloud_name or cloud.get("version") != "0.1.0" or cloud.get("private") is not True or
            cloud.get("license") != "AGPL-3.0-only" or cloud.get("dependencies") != cloud_dependencies or
            cloud.get("devDependencies") != cloud_dev):
        errors.append("BUILD-CLOUD-001 cloud-runtime manifest identity or exact dependencies differ")
    cloud_importer = importer_block("packages/cloud-runtime")
    for dependency, version in {**cloud_dependencies, **cloud_dev}.items():
        target = "link:../reference-executor" if version.startswith("workspace:") else version
        if f"      '{dependency}':\n        specifier: {version}\n        version: {target}\n" not in cloud_importer and \
                f"      {dependency}:\n        specifier: {version}\n        version: {target}\n" not in cloud_importer:
            errors.append(f"BUILD-CLOUD-001 lock importer differs: {dependency}")
    if app_importer.count("'@defi-workflow-engine/cloud-runtime':") != 1 or not re.search(
            r"(?m)^      '@defi-workflow-engine/cloud-runtime':\n        specifier: workspace:0\.1\.0\n        version: link:\.\./\.\./packages/cloud-runtime$",
            app_importer):
        errors.append("BUILD-CLOUD-001 app lock workspace link differs: cloud-runtime")
    for identity, version in BUILDCLOUD001_DIRECT_VERSIONS.items():
        if identity + "@" + version not in locked:
            errors.append(f"BUILD-CLOUD-001 direct lock identity missing: {identity}@{version}")
    for identity, version in BUILDMCP001_DIRECT_VERSIONS.items():
        if identity + "@" + version not in locked:
            errors.append(f"BUILD-MCP-001 direct lock identity missing: {identity}@{version}")
        if not re.search(rf"(?m)^      '{re.escape(identity)}':\n        specifier: {re.escape(version)}\n        version: {re.escape(version)}$", app_importer):
            errors.append(f"BUILD-MCP-001 app lock importer differs: {identity}")
    for identity, version in BUILDAUTHWALLETS001_DIRECT_VERSIONS.items():
        if identity + "@" + version not in locked:
            errors.append(f"BUILD-FLOFI-AUTH-WALLETS-001 direct lock identity missing: {identity}@{version}")
        if not re.search(rf"(?m)^      '{re.escape(identity)}':\n        specifier: {re.escape(version)}\n        version: {re.escape(version)}$", app_importer):
            errors.append(f"BUILD-FLOFI-AUTH-WALLETS-001 app lock importer differs: {identity}")
    for manifest_path in [Path("package.json"), *Path("packages").glob("*/package.json"),
                          Path("apps/reference-dapp/package.json")]:
        manifest = json.loads(manifest_path.read_text())
        for kind in ("dependencies", "devDependencies"):
            for name, version in manifest.get(kind, {}).items():
                if version in ("workspace:0.1.0", "workspace:0.3.0") and name.startswith("@defi-workflow-engine/"):
                    continue
                if (name + "@" + version not in pins and BUILD002_DIRECT_VERSIONS.get(name) != version
                        and BUILD003D_DIRECT_VERSIONS.get(name) != version
                        and BUILDCLOUD001_DIRECT_VERSIONS.get(name) != version
                        and BUILDMCP001_DIRECT_VERSIONS.get(name) != version
                        and BUILDAUTHWALLETS001_DIRECT_VERSIONS.get(name) != version):
                    errors.append(f"Unapproved direct pin: {name}@{version}")

    def dependencies(body, group):
        result = {}
        active = None
        for line in body.splitlines():
            header = re.fullmatch(r"    ([A-Za-z]+):", line)
            if header:
                active = header.group(1)
            elif line.startswith("    ") and not line.startswith("      "):
                active = None
            elif active == group and line.startswith("      "):
                pair = line.strip().split(": ", 1)
                if len(pair) == 2:
                    result[pair[0].strip("'")] = pair[1].strip("'")
        return result

    next_keys = [key for key in snapshot_blocks if key.startswith("next@16.4.1(")]
    if len(next_keys) != 1:
        errors.append(f"Expected one pinned Next snapshot, found {len(next_keys)}")
    next_block = snapshot_blocks.get(next_keys[0], "") if len(next_keys) == 1 else ""
    next_dependencies = dependencies(next_block, "dependencies")
    next_optional = dependencies(next_block, "optionalDependencies")
    sharp_ref = next_optional.get("sharp")
    sharp_keys = [key for key in snapshot_blocks if sharp_ref and key == "sharp@" + sharp_ref]
    if len(sharp_keys) != 1:
        errors.append(f"Expected one pinned optional sharp snapshot, found {len(sharp_keys)}")
    sharp_optional = dependencies(snapshot_blocks[sharp_keys[0]], "optionalDependencies") if sharp_keys else {}
    helpers_ref = next_dependencies.get("@swc/helpers")
    helpers_dependencies = dependencies(snapshot_blocks.get("@swc/helpers@" + str(helpers_ref), ""), "dependencies")
    wasm_parents = ("@img/sharp-freebsd-wasm32", "@img/sharp-webcontainers-wasm32")

    def lock_restriction(body, label):
        matches = re.findall(rf"(?m)^    {label}: \[([^]]*)\]$", body)
        if len(matches) > 1:
            errors.append(f"Repeated {label} restriction in lock block")
        return [part.strip() for part in matches[0].split(",")] if matches else None

    def validate_reviewed_lock(identity, approved):
        name, version = identity.rsplit("@", 1)
        body = package_blocks.get(identity, "")
        snapshot = snapshot_blocks.get(identity)
        if not body or snapshot is None:
            errors.append(f"Reviewed package block or snapshot missing: {identity}")
            return
        if locked.get(identity) != approved["integrity"]:
            errors.append(f"Reviewed SRI changed: {identity}")
        for label in ("os", "cpu", "libc"):
            if lock_restriction(body, label) != approved[label]:
                errors.append(f"Reviewed {label} restriction changed: {identity}")
        optional = bool(re.search(r"(?m)^    optional: true$", snapshot))
        if optional != approved["optional"]:
            errors.append(f"Reviewed optional status changed: {identity}")
        route = approved["route"]
        if route == "sharp":
            valid = sharp_optional.get(name) == version and sharp_ref == "0.35.5(@types/node@24.13.4)"
        elif route == "wasm":
            valid = sharp_ref == "0.35.5(@types/node@24.13.4)" and all(
                sharp_optional.get(parent) == "0.35.5" and
                dependencies(snapshot_blocks.get(parent + "@0.35.5", ""), "dependencies").get(name) == version
                for parent in wasm_parents)
        elif route == "next":
            valid = next_dependencies.get(name) == version
        elif route == "helpers":
            valid = helpers_ref == "0.5.23" and helpers_dependencies.get(name) == version
        else:
            valid = False
        if not valid:
            errors.append(f"Reviewed dependency route changed: {identity}")

    for identity, approved in BUILD002_REVIEWED_LICENSE_EXCEPTIONS.items():
        validate_reviewed_lock(identity, approved)

    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=10080)
    allowed_licenses = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"}
    metadata_records = registry_metadata(locked)

    def inspect(item):
        identity, integrity = item
        name, version = identity.rsplit("@", 1)
        issues = []
        package, published, metadata_error = metadata_records[identity]
        if metadata_error is not None:
            return None, [f"Registry metadata unavailable: {identity}: {metadata_error}"], None
        if package.get("dist", {}).get("integrity") != integrity:
            issues.append(f"Registry integrity changed: {identity}")
        try:
            if not dependency_release_age_allowed(name, version,
                    datetime.datetime.fromisoformat(published.replace("Z", "+00:00")), cutoff, age_waivers):
                issues.append(f"Minimum release age failed: {identity}")
        except (TypeError, ValueError, AttributeError):
            issues.append(f"Missing or invalid publication time: {identity}")
        license_id = package.get("license")
        legacy_mpl = (license_id == "MPL-2.0" and version == "1.33.0" and
                      name in BUILD001_LIGHTNINGCSS_NAMES)
        # BlueOak-1.0.0 (permissive, OSI-approved), exact identities only. minimatch@10.2.6 was reviewed earlier; GHSA-g3hv-75wg-m249
        # moves ESLint's three consumers to minimatch@11.0.3, which adds its author's @isaacs/nonrecursive-glob-match (same license).
        legacy_blueoak = (license_id == "BlueOak-1.0.0" and
                          identity in {"minimatch@11.0.3", "@isaacs/nonrecursive-glob-match@1.0.3"})
        # 0BSD (OSI-approved, public-domain-equivalent: no attribution or notice obligation), exact identity only. tslib@1.14.1 is
        # tsyringe@4.10.0's TypeScript helper runtime, reached only through @turnkey/crypto@2.13.3 → @peculiar/x509. The existing
        # tslib@2.8.1 exception is unchanged; no other 0BSD package or version is accepted by this line.
        reviewed_0bsd = license_id == "0BSD" and identity == "tslib@1.14.1"
        rejected = license_id not in allowed_licenses and not legacy_mpl and not legacy_blueoak and not reviewed_0bsd
        approved = BUILD002_REVIEWED_LICENSE_EXCEPTIONS.get(identity)
        if approved:
            if (license_id != approved["license"] or integrity != approved["integrity"]):
                issues.append(f"Reviewed identity/license/SRI changed: {identity}: {license_id}")
            for label in ("os", "cpu", "libc"):
                if package.get(label) != approved[label]:
                    issues.append(f"Registry {label} restriction changed: {identity}")
        elif rejected:
            issues.append(f"Unreviewed dependency license: {identity}: {license_id}")
        record = {"name": name, "version": version, "license": license_id,
                  "integrity": integrity, "published": published,
                  "engines": package.get("engines", {}),
                  "peerDependencies": package.get("peerDependencies", {}),
                  "peerDependenciesMeta": package.get("peerDependenciesMeta", {}),
                  "os": package.get("os"), "cpu": package.get("cpu"),
                  "libc": package.get("libc"),
                  "optional": bool(re.search(r"(?m)^    optional: true$",
                                              snapshot_blocks.get(identity, "")))}
        return record, issues, rejected

    # Each waiver is bound to the exact reviewed tarball and publication: the identity must be locked with the recorded integrity,
    # and the registry must report the recorded publication time. Waivers past normal eligibility are reported for removal.
    removable_waivers = []
    for entry in APPROVED_AGE_WAIVERS:
        identity = f"{entry['package']}@{entry['version']}"
        if identity not in locked:
            errors.append(f"Release-age waiver for an unlocked identity: {identity}")
            continue
        if "integrity" in entry and locked[identity] != entry["integrity"]:
            errors.append(f"Release-age waiver integrity differs from the lockfile: {identity}")
        published = metadata_records[identity][1]
        if "published_at" in entry and isinstance(published, str):
            try:
                registry_time = datetime.datetime.fromisoformat(published.replace("Z", "+00:00"))
                if identity in LEGACY_AGE_WAIVERS:  # recorded to the second before this binding existed
                    registry_time = registry_time.replace(microsecond=0)
                same = registry_time == datetime.datetime.fromisoformat(entry["published_at"].replace("Z", "+00:00"))
            except ValueError:
                same = False
            if not same:
                errors.append(f"Release-age waiver publication time differs from the registry: {identity}")
        try:
            if datetime.datetime.fromisoformat(str(published).replace("Z", "+00:00")) <= cutoff:
                removable_waivers.append(identity)
        except ValueError:
            pass

    records = []
    rejected_identities = set()
    for (identity, _), (record, issues, rejected) in zip(
            sorted(locked.items()), map(inspect, sorted(locked.items()))):
        errors.extend(issues)
        if record is not None:
            records.append(record)
        if rejected:
            rejected_identities.add(identity)
    expected_rejected = set(BUILD002_REVIEWED_LICENSE_EXCEPTIONS)
    if rejected_identities != expected_rejected:
        errors.append(f"Full rejected set drift: missing={sorted(expected_rejected - rejected_identities)}, "
                      f"new={sorted(rejected_identities - expected_rejected)}")
    if len(records) != REGISTRY_PACKAGE_COUNT:
        errors.append(f"Incomplete registry review: {len(records)} of {REGISTRY_PACKAGE_COUNT}")
    if errors:
        for error in errors:
            print(error, flush=True)
        raise RuntimeError(f"BUILD-002 dependency verification failed with {len(errors)} violation(s)")

    destination = Path(os.environ.get("RUNNER_TEMP", tempfile.gettempdir())) / "build-002-dependencies.json"
    destination.write_text(json.dumps(records, indent=2, sort_keys=True) + "\n")
    print("Registry entries/integrities/release ages verified:", len(records), flush=True)
    print("Exact temporary owner-approved release-age waivers:", sorted(age_waivers), flush=True)
    print("Release-age waivers past normal eligibility (remove in a follow-up change):", sorted(removable_waivers), flush=True)
    print("Exact reviewed license exception set:", len(rejected_identities), flush=True)
    print("License inventory:",
          dict(sorted(collections.Counter(r["license"] for r in records).items())), flush=True)
    print("Dependency evidence SHA-256:", hashlib.sha256(destination.read_bytes()).hexdigest(), flush=True)

if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["--verify-dependencies"]:
        verify_dependencies()
    elif not sys.argv[1:]:
        main()
    else:
        raise SystemExit("Usage: bootstrap-ci.py [--verify-dependencies]")
