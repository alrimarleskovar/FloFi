"""Regression and adversarial tests for CI transport, cache and failure handling."""

from contextlib import redirect_stdout
import gzip
import hashlib
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import tarfile
import unittest
from unittest.mock import patch
import zipfile

from ci_archive_cache import verified_archive

ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bootstrap = load_script('bootstrap-ci')


class ArchiveCache(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.parent = Path(self.scratch.name)
        self.cache = self.parent / 'cache'
        self.env = patch.dict(os.environ, {'FLOFI_CI_ARCHIVE_CACHE': str(self.cache)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.data = b'public approved archive bytes'
        self.digest = hashlib.sha256(self.data).hexdigest()
        self.calls = 0

    def download(self, stream):
        self.calls += 1
        stream.write(self.data)

    def read(self, **kwargs):
        with verified_archive('test.tgz', self.parent, self.download, self.digest, **kwargs) as path:
            self.assertNotEqual(path, self.cache / 'test.tgz')
            self.assertEqual(path.read_bytes(), self.data)
            return path

    def test_cold_warm_and_invalidation(self):
        private = self.read()
        self.assertFalse(private.exists())
        self.assertEqual(self.calls, 1)
        self.read()
        self.assertEqual(self.calls, 1)
        self.data = b'new approved version'
        self.digest = hashlib.sha256(self.data).hexdigest()
        self.read()
        self.assertEqual(self.calls, 2)

    def test_same_size_corruption_is_reverified(self):
        self.read()
        (self.cache / 'test.tgz').write_bytes(b'x' * len(self.data))
        self.read(size=len(self.data))
        self.assertEqual(self.calls, 2)

    def test_cache_symlink_is_never_followed(self):
        self.cache.mkdir()
        foreign = self.parent / 'foreign'
        foreign.write_bytes(b'foreign private bytes')
        (self.cache / 'test.tgz').symlink_to(foreign)
        self.read()
        self.assertEqual(foreign.read_bytes(), b'foreign private bytes')
        self.assertFalse((self.cache / 'test.tgz').is_symlink())

    def test_fifo_and_directory_do_not_hang_or_get_recursively_removed(self):
        self.cache.mkdir()
        entry = self.cache / 'test.tgz'
        os.mkfifo(entry)
        self.read()
        entry.unlink()
        entry.mkdir()
        marker = entry / 'keep'
        marker.write_text('unrelated')
        with self.assertRaises(OSError):
            self.read()
        self.assertEqual(marker.read_text(), 'unrelated')

    def test_invalid_download_never_reaches_consumer_or_cache(self):
        self.digest = '0' * 64
        with self.assertRaises(RuntimeError):
            self.read()
        self.assertFalse((self.cache / 'test.tgz').exists())
        self.assertFalse(list(self.parent.glob('flofi-archive-*')))

    def test_size_pin_and_sha512_are_enforced(self):
        with self.assertRaises(RuntimeError):
            self.read(size=len(self.data) + 1)
        digest = hashlib.sha512(self.data).hexdigest()
        with verified_archive('pnpm.tgz', self.parent, self.download, digest, algorithm='sha512') as path:
            self.assertEqual(path.read_bytes(), self.data)

    def test_mutating_cache_after_verification_does_not_change_private_copy(self):
        self.read()
        with verified_archive('test.tgz', self.parent, self.download, self.digest) as path:
            (self.cache / 'test.tgz').write_bytes(b'poison')
            self.assertEqual(path.read_bytes(), self.data)

    def test_disabled_cache_downloads_and_checks_every_time(self):
        with patch.dict(os.environ):
            os.environ.pop('FLOFI_CI_ARCHIVE_CACHE')
            self.read()
            self.read()
        self.assertEqual(self.calls, 2)


class RegistryTransport(unittest.TestCase):
    def response(self, body, encoding='identity'):
        response = io.BytesIO(body)
        response.status = 200
        response.headers = {'Content-Encoding': encoding}
        return response

    def test_compressed_and_identity_responses_have_identical_bytes(self):
        data = b'{"versions":{},"time":{}}'
        for encoding, body in [('identity', data), ('gzip', gzip.compress(data))]:
            with patch.object(bootstrap.urllib.request, 'urlopen', return_value=self.response(body, encoding)) as fetch:
                self.assertEqual(bootstrap.fetch('https://registry.npmjs.org/example', compressed=True), data)
                self.assertEqual(fetch.call_args.args[0].get_header('Accept-encoding'), 'gzip')

    def test_bad_compression_and_unknown_encoding_fail_closed(self):
        for encoding in ['gzip', 'br']:
            with patch.object(bootstrap.urllib.request, 'urlopen', return_value=self.response(b'bad', encoding)):
                with self.assertRaises((RuntimeError, OSError)):
                    bootstrap.fetch('https://registry.npmjs.org/example', compressed=True)

    def test_read_timeout_discards_partial_bytes_before_success_and_cache_write(self):
        failed = self.response(b'')
        failed.read1 = unittest.mock.Mock(side_effect=[b'partial bytes', TimeoutError('private URL detail')])
        good = b'complete verified archive'
        with tempfile.TemporaryDirectory() as scratch, patch.dict(os.environ, {'FLOFI_CI_ARCHIVE_CACHE': scratch + '/cache'}), \
                patch.object(bootstrap.urllib.request, 'urlopen', side_effect=[failed, self.response(good)]) as open_url, \
                patch.object(bootstrap.time, 'sleep') as sleep, redirect_stdout(io.StringIO()) as logs:
            def download(output):
                # No partial attempt bytes are written into the private file.
                output.write(bootstrap.fetch(bootstrap.NODE_URL, stage='Node archive'))
            with verified_archive('node.tar.xz', Path(scratch), download, hashlib.sha256(good).hexdigest()) as archive:
                self.assertEqual(archive.read_bytes(), good)
            self.assertTrue(failed.closed)
            self.assertEqual(open_url.call_count, 2)
            sleep.assert_called_once_with(2)
            self.assertEqual((Path(scratch) / 'cache/node.tar.xz').read_bytes(), good)
            self.assertIn('stage=Node archive host=nodejs.org attempt=2/3', logs.getvalue())
            self.assertNotIn('private URL detail', logs.getvalue())
            self.assertFalse(list(Path(scratch).glob('flofi-archive-*')))

    def test_incomplete_length_and_incomplete_read_retry_with_fresh_response(self):
        short = self.response(b'short')
        short.headers['Content-Length'] = '99'
        broken = self.response(b'')
        broken.read1 = unittest.mock.Mock(side_effect=http.client.IncompleteRead(b'partial'))
        with patch.object(bootstrap.urllib.request, 'urlopen', side_effect=[short, broken, self.response(b'complete')]) as open_url, \
                patch.object(bootstrap.time, 'sleep') as sleep:
            self.assertEqual(bootstrap.fetch(bootstrap.NODE_URL), b'complete')
            self.assertEqual(open_url.call_count, 3)
            self.assertEqual(sleep.call_args_list, [unittest.mock.call(2), unittest.mock.call(4)])
            self.assertTrue(short.closed)
            self.assertTrue(broken.closed)

    def test_transient_http_and_connection_failures_retry(self):
        unavailable = bootstrap.urllib.error.HTTPError(bootstrap.NODE_URL, 503, 'private detail', {}, None)
        offline = bootstrap.urllib.error.URLError(ConnectionResetError('private detail'))
        with patch.object(bootstrap.urllib.request, 'urlopen', side_effect=[unavailable, offline, self.response(b'ok')]), \
                patch.object(bootstrap.time, 'sleep') as sleep:
            self.assertEqual(bootstrap.fetch(bootstrap.NODE_URL), b'ok')
            self.assertEqual(sleep.call_count, 2)

    def test_exhausted_retries_are_bounded_sanitized_and_leave_no_archive(self):
        url = 'https://user:secret@nodejs.org/private/path?token=private'
        for failure in [TimeoutError('private'), http.client.IncompleteRead(b'private'), ssl.SSLEOFError('private'),
                        bootstrap.urllib.error.URLError('private')]:
            with self.subTest(failure=type(failure).__name__), tempfile.TemporaryDirectory() as scratch, \
                    patch.dict(os.environ, {'FLOFI_CI_ARCHIVE_CACHE': scratch + '/cache'}), \
                    patch.object(bootstrap.urllib.request, 'urlopen', side_effect=failure) as open_url, \
                    patch.object(bootstrap.time, 'sleep') as sleep, redirect_stdout(io.StringIO()) as logs:
                with self.assertRaisesRegex(RuntimeError, 'failed after 3 attempt.*retries exhausted') as error:
                    with verified_archive('node.tar.xz', Path(scratch),
                                          lambda output: output.write(bootstrap.fetch(url, stage='Node archive')),
                                          '0' * 64):
                        self.fail('Failed download reached consumer')
                self.assertEqual(open_url.call_count, 3)
                self.assertEqual(sleep.call_args_list, [unittest.mock.call(2), unittest.mock.call(4)])
                for sensitive in ['secret', 'user:', 'private', 'token=', 'https://']:
                    self.assertNotIn(sensitive, logs.getvalue() + str(error.exception))
                self.assertIn('host=nodejs.org', logs.getvalue())
                self.assertFalse(list(Path(scratch).glob('flofi-archive-*')))
                self.assertFalse((Path(scratch) / 'cache/node.tar.xz').exists())

    def test_permanent_http_and_tls_errors_are_not_retried(self):
        for failure in [bootstrap.urllib.error.HTTPError(bootstrap.NODE_URL, 404, 'private', {}, None),
                        bootstrap.urllib.error.URLError(ssl.SSLCertVerificationError('private'))]:
            with self.subTest(failure=type(failure).__name__), \
                    patch.object(bootstrap.urllib.request, 'urlopen', side_effect=failure) as open_url, \
                    patch.object(bootstrap.time, 'sleep') as sleep:
                with self.assertRaises(RuntimeError):
                    bootstrap.fetch(bootstrap.NODE_URL)
                open_url.assert_called_once()
                sleep.assert_not_called()

    def test_elapsed_budget_stops_even_a_response_that_keeps_returning_bytes(self):
        response = self.response(b'')
        response.read1 = unittest.mock.Mock(return_value=b'trickle')
        with patch.object(bootstrap.urllib.request, 'urlopen', return_value=response) as open_url, \
                patch.object(bootstrap.time, 'monotonic', side_effect=[0, 0, 1, 301, 301]), \
                patch.object(bootstrap.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'retries exhausted'):
                bootstrap.fetch(bootstrap.NODE_URL)
            response.read1.assert_called_once()
            open_url.assert_called_once()
            sleep.assert_not_called()
            self.assertTrue(response.closed)

    def test_checksum_mismatch_after_retry_never_retries_integrity_or_caches_bytes(self):
        pins = [('sha256', bootstrap.NODE_SHA256),
                ('sha512', bootstrap.base64.b64decode(bootstrap.PNPM_SHA512).hex())]
        for algorithm, expected in pins:
            with self.subTest(algorithm=algorithm), tempfile.TemporaryDirectory() as scratch, \
                    patch.dict(os.environ, {'FLOFI_CI_ARCHIVE_CACHE': scratch + '/cache'}), \
                    patch.object(bootstrap.urllib.request, 'urlopen', side_effect=[TimeoutError(), self.response(b'corrupt')]) as open_url, \
                    patch.object(bootstrap.time, 'sleep') as sleep:
                with self.assertRaisesRegex(RuntimeError, 'Archive digest/size mismatch'):
                    with verified_archive('test.tgz', Path(scratch),
                                          lambda output: output.write(bootstrap.fetch(bootstrap.NODE_URL)),
                                          expected, algorithm=algorithm):
                        self.fail('Unchecked archive reached consumer')
                self.assertEqual(open_url.call_count, 2)
                sleep.assert_called_once_with(2)
                self.assertFalse((Path(scratch) / 'cache/test.tgz').exists())
                self.assertFalse(list(Path(scratch).glob('flofi-archive-*')))

    def test_official_node_manifest_mismatch_stops_before_archive_or_execution(self):
        manifest = ('0' * 64 + '  ' + bootstrap.NODE_ARCHIVE + '\n').encode()
        with patch.object(bootstrap, 'checked_output'), patch.object(bootstrap, 'fetch', return_value=manifest) as fetch, \
                patch.object(bootstrap, 'verified_archive') as archive, patch.object(bootstrap, 'extract') as extract:
            with self.assertRaisesRegex(RuntimeError, 'Official Node checksum entry differs'):
                bootstrap.main()
            fetch.assert_called_once_with(bootstrap.NODE_SUMS_URL, stage='Node checksum manifest')
            archive.assert_not_called()
            extract.assert_not_called()

    def test_multiple_versions_share_one_fresh_response_without_losing_fields(self):
        packages = {'1.0.0': {'license': 'MIT', 'dist': {'integrity': 'sha512-one'}},
                    '2.0.0': {'license': 'GPL-3.0-only', 'dist': {'integrity': 'sha512-two'}, 'cpu': ['arm64']}}
        metadata = {'versions': packages, 'time': {'1.0.0': '2020-01-01T00:00:00Z', '2.0.0': '2026-10-09T00:00:00Z'}}
        with patch.object(bootstrap, 'fetch', return_value=json.dumps(metadata).encode()) as fetch:
            locked = {'@scope/name@1.0.0': 'sha512-one', '@scope/name@2.0.0': 'sha512-two'}
            for _ in range(2):
                records = bootstrap.registry_metadata(locked)
                for version in packages:
                    self.assertEqual(records['@scope/name@' + version], (packages[version], metadata['time'][version], None))
            self.assertEqual(fetch.call_count, 2)  # no persistent or second-call metadata cache
            self.assertEqual(fetch.call_args.args[0], 'https://registry.npmjs.org/@scope%2fname')
            self.assertTrue(fetch.call_args.kwargs['compressed'])

    def test_unavailable_missing_version_missing_time_and_malformed_metadata_fail(self):
        for response in [b'not-json', b'{}', b'{"versions":{"1":{}},"time":{}}']:
            with patch.object(bootstrap, 'fetch', return_value=response):
                records = bootstrap.registry_metadata({'example@1': 'sha512-x'})
                self.assertIsNotNone(records['example@1'][2])
        with patch.object(bootstrap, 'fetch', side_effect=OSError('offline')):
            self.assertIsNotNone(bootstrap.registry_metadata({'example@1': 'sha512-x'})['example@1'][2])


class BootstrapIntegration(unittest.TestCase):
    def test_anvil_and_browser_cold_and_warm_keep_extraction_and_version_checks(self):
        for name in ['bootstrap-anvil', 'bootstrap-playwright']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as scratch:
                module = load_script(name)
                parent = Path(scratch)
                raw = io.BytesIO()
                binary = b'fixture executable bytes'
                if name == 'bootstrap-anvil':
                    with tarfile.open(fileobj=raw, mode='w:gz') as archive:
                        entry = tarfile.TarInfo('anvil')
                        entry.size = len(binary)
                        archive.addfile(entry, io.BytesIO(binary))
                    patches = {'ENTRIES': {'anvil': len(binary)}, 'ANVIL_SIZE': len(binary),
                               'ANVIL_SHA256': hashlib.sha256(binary).hexdigest()}
                    destination = module.DESTINATION_NAME
                    version = module.ANVIL_VERSION
                else:
                    with zipfile.ZipFile(raw, 'w') as archive:
                        archive.writestr(module.EXECUTABLE, binary)
                    patches = {'ENTRY_COUNT': 1}
                    destination = 'chromium_headless_shell-' + module.REVISION
                    version = 'Google Chrome for Testing ' + module.BROWSER_VERSION
                data = raw.getvalue()
                patches.update(SIZE=len(data), SHA256=hashlib.sha256(data).hexdigest())
                downloads = []

                def build_opener(_proxy, redirect):
                    class Opener:
                        def open(self, source, timeout):
                            downloads.append(source)
                            redirect.redirects = 1
                            response = io.BytesIO(data)
                            response.status = 200
                            response.url = module.FINAL if name.endswith('playwright') else 'https://' + module.FINAL_HOST + module.FINAL_PATH
                            return response
                    return Opener()

                with patch.dict(os.environ, {'FLOFI_CI_ARCHIVE_CACHE': str(parent / 'cache')}), patch.multiple(module, **patches), patch.object(module.urllib.request, 'build_opener', side_effect=build_opener), patch.object(module.subprocess, 'check_output', return_value=version) as execute, redirect_stdout(io.StringIO()):
                    for run in ['cold', 'warm']:
                        target = parent / run / destination
                        module.bootstrap(target)
                        executable = target / ('anvil' if name.endswith('anvil') else module.EXECUTABLE)
                        self.assertEqual(executable.read_bytes(), binary)
                        self.assertEqual(executable.stat().st_mode & 0o777, 0o755)
                    self.assertEqual(len(downloads), 1)
                    self.assertEqual(execute.call_count, 2)
                    # Both poisoned cache and bad upstream bytes fail before execution.
                    (parent / 'cache' / module.ARCHIVE).write_bytes(b'bad')
                    module.SHA256 = '0' * 64
                    with self.assertRaises(RuntimeError):
                        module.bootstrap(parent / 'bad' / destination)
                    self.assertEqual(execute.call_count, 2)
                    self.assertFalse((parent / 'bad' / destination).exists())


class FullDependencyGate(unittest.TestCase):
    """The whole existing gate runs on a synthetic registry; corruptions must fail."""
    def setUp(self):
        lock = (ROOT / 'pnpm-lock.yaml').read_text().split('\npackages:\n')[1].split('\nsnapshots:\n')[0]
        blocks = re.split(r'(?m)^  (\S[^\n]*):\n', lock)
        self.registry = {}
        for identity, body in zip(blocks[1::2], blocks[2::2]):
            identity = identity.strip("'")
            integrity = re.search(r'integrity: (sha512-[A-Za-z0-9+/=]+)', body).group(1)
            name, version = identity.rsplit('@', 1)
            package = {'license': 'MIT', 'dist': {'integrity': integrity}}
            if identity in bootstrap.BUILD002_REVIEWED_LICENSE_EXCEPTIONS:
                approved = bootstrap.BUILD002_REVIEWED_LICENSE_EXCEPTIONS[identity]
                package.update({key: approved[key] for key in ['license', 'os', 'cpu', 'libc']})
            document = self.registry.setdefault(name, {'versions': {}, 'time': {}})
            document['versions'][version] = package
            document['time'][version] = '2020-01-01T00:00:00Z'
        # Owner-approved release-age waivers are bound to their recorded registry publication time.
        for entry in bootstrap.APPROVED_AGE_WAIVERS:
            if 'published_at' in entry:
                self.registry[entry['package']]['time'][entry['version']] = entry['published_at']
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)

    def verify(self):
        def fetch(url, **_):
            return json.dumps(self.registry[url.removeprefix('https://registry.npmjs.org/').replace('%2f', '/')]).encode()
        with patch.dict(os.environ, {'RUNNER_TEMP': self.scratch.name}), patch.object(bootstrap, 'fetch', side_effect=fetch), redirect_stdout(io.StringIO()):
            bootstrap.verify_dependencies()

    def test_full_inventory_and_existing_exceptions_pass(self):
        self.verify()
        evidence = json.loads((Path(self.scratch.name) / 'build-002-dependencies.json').read_text())
        self.assertEqual(len(evidence), 295)

    def test_release_age_waivers_bind_exact_integrity_and_publication(self):
        young = '2999-01-01T00:00:00.000Z'
        for name, version in (('minimatch', '11.0.3'), ('@isaacs/nonrecursive-glob-match', '1.0.3')):
            with self.subTest(identity=name + '@' + version):
                saved = json.loads(json.dumps(self.registry))
                self.registry[name]['time'][version] = young  # a republication-time change is not the reviewed release
                with self.assertRaises(RuntimeError):
                    self.verify()
                self.assertFalse((Path(self.scratch.name) / 'build-002-dependencies.json').exists())
                self.registry = saved
        waivers = [dict(entry) for entry in bootstrap.APPROVED_AGE_WAIVERS]
        waivers[2]['integrity'] = 'sha512-' + 'A' * 86 + '=='
        with patch.object(bootstrap, 'APPROVED_AGE_WAIVERS', tuple(waivers)), self.assertRaises(RuntimeError):
            self.verify()
        waivers = [dict(entry) for entry in bootstrap.APPROVED_AGE_WAIVERS] + [{'package': 'left-pad', 'version': '1.3.0'}]
        with patch.object(bootstrap, 'APPROVED_AGE_WAIVERS', tuple(waivers)), self.assertRaises(RuntimeError):
            self.verify()
        # A waived identity younger than seven days passes only through its exact waiver.
        self.verify()

    def test_integrity_license_age_platform_and_missing_entry_fail_without_evidence(self):
        mutations = ['integrity', 'license', 'age', 'platform', 'missing']
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                saved = json.loads(json.dumps(self.registry))
                document = self.registry['@img/sharp-win32-x64']
                package = document['versions']['0.35.5']
                if mutation == 'integrity': package['dist']['integrity'] = 'sha512-poison'
                elif mutation == 'license': package['license'] = 'MIT'
                elif mutation == 'age': document['time']['0.35.5'] = '2999-01-01T00:00:00Z'
                elif mutation == 'platform': package['cpu'] = ['arm64']
                else: document['versions'].clear()
                with self.assertRaises(RuntimeError):
                    self.verify()
                self.assertFalse((Path(self.scratch.name) / 'build-002-dependencies.json').exists())
                self.registry = saved


class SbomValidation(unittest.TestCase):
    """Run the actual SBOM validator against complete and corrupted inventories."""
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.directory = Path(self.scratch.name)
        script = (ROOT / '.circleci/scripts/ci-sbom.sh').read_text()
        self.validator = script.split("python3 - <<'PYCODE'\n", 1)[1].rsplit('\nPYCODE', 1)[0]
        lock = (ROOT / 'pnpm-lock.yaml').read_text().split('\npackages:\n')[1].split('\nsnapshots:\n')[0]
        identities = [identity.strip("'").rsplit('@', 1) for identity in re.findall(r'(?m)^  (\S[^\n]*):$', lock)]
        self.evidence = [
            {'name': name, 'version': version, 'license': bootstrap.BUILD002_REVIEWED_LICENSE_EXCEPTIONS.get(
                name + '@' + version, {}).get('license', 'MIT')}
            for name, version in identities
        ]
        components = [{'name': row['name'], 'version': row['version'],
                       'bom-ref': row['name'] + '@' + row['version']} for row in self.evidence]
        self.document = {
            'bomFormat': 'CycloneDX', 'specVersion': '1.6', 'components': components,
            'metadata': {'component': {'name': 'defi-workflow-engine', 'version': '0.1.0',
                                      'bom-ref': 'root', 'licenses': [{'license': {'id': 'Apache-2.0'}}]}},
            'dependencies': [{'ref': component['bom-ref'], 'dependsOn': []} for component in components]
                            + [{'ref': 'root', 'dependsOn': []}],
        }

    def validate(self):
        sbom = self.directory / 'build-003a.cdx.json'
        sbom.write_text(json.dumps(self.document))
        (self.directory / 'build-002-dependencies.json').write_text(json.dumps(self.evidence))
        result = subprocess.run([sys.executable, '-c', self.validator], cwd=ROOT, capture_output=True, text=True,
                                env={**os.environ, 'RUNNER_TEMP': str(self.directory),
                                     'GITHUB_STEP_SUMMARY': str(self.directory / 'summary.md')}, timeout=10)
        self.assertFalse(sbom.exists(), 'The SBOM must be removed after success or failure')
        return result

    def test_complete_reviewed_inventory_passes(self):
        result = self.validate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('295 exact registry components', result.stdout)

    def test_missing_duplicate_unreviewed_and_dangling_components_fail(self):
        saved = json.dumps(self.document)
        for corruption in ['missing', 'duplicate', 'unreviewed', 'dangling']:
            with self.subTest(corruption=corruption):
                self.document = json.loads(saved)
                if corruption == 'missing': self.document['components'].pop()
                elif corruption == 'duplicate': self.document['components'].append(self.document['components'][0])
                elif corruption == 'unreviewed': self.document['components'][0]['version'] = '0.0.0-unreviewed'
                else: self.document['dependencies'][0]['dependsOn'] = ['unreviewed-ref']
                self.assertNotEqual(self.validate().returncode, 0)


class WorkflowInvariants(unittest.TestCase):
    def test_runner_paths_are_initialized_after_job_dispatch(self):
        body = (ROOT / '.github/workflows/contracts.yml').read_text()
        job_env = re.search(r'(?m)^    env:\n((?:      .+\n)+)', body).group(1)
        # Job env is evaluated before runner assignment; these contexts are
        # available only in step configuration, not jobs.<job_id>.env.
        self.assertNotRegex(job_env, r'\$\{\{\s*(?:runner|steps|job|env)\.')
        self.assertIn('printf \'FLOFI_CI_ARCHIVE_CACHE=%s/flofi-ci-archives\\n\' "$RUNNER_TEMP" >> "$GITHUB_ENV"', body)

    def test_concurrency_is_pr_only_and_workflow_specific(self):
        keys = []
        for workflow in ['contracts', 'governance']:
            body = (ROOT / '.github/workflows' / (workflow + '.yml')).read_text()
            key = re.search(r'^  group: (.+)$', body, re.M).group(1)
            self.assertEqual(key, 'build-ci-' + workflow + '-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}')
            self.assertIn("  cancel-in-progress: ${{ github.event_name == 'pull_request' }}", body)
            def render(event, pr, run):
                return key.replace('${{ github.event_name }}', event).replace('${{ github.event.pull_request.number || github.run_id }}', str(pr or run))
            self.assertEqual(render('pull_request', 71, 100), render('pull_request', 71, 101))
            self.assertNotEqual(render('pull_request', 71, 100), render('pull_request', 72, 101))
            self.assertNotEqual(render('push', None, 100), render('push', None, 101))
            self.assertNotEqual(render('push', None, 100), render('pull_request', 100, 101))
            keys.append(render('pull_request', 71, 100))
        self.assertEqual(len(set(keys)), 2)

    def test_no_build_cache_or_worker_increase(self):
        body = (ROOT / '.github/workflows/contracts.yml').read_text()
        self.assertNotIn('restore-keys:', body)
        self.assertNotIn('save-always:', body)
        self.assertIn('actions/cache@caa296126883cff596d87d8935842f9db880ef25', body)
        self.assertIn("'scripts/bootstrap-*.py', 'scripts/ci_archive_cache.py', 'pnpm-lock.yaml', '.npmrc', 'pnpm-workspace.yaml'", body)
        paths = body.split('          path: |\n')[1].split('          #')[0]
        self.assertEqual(len(paths.splitlines()), 4)
        self.assertNotRegex(paths, r'node_modules|\.next|\.turbo|journal|runtime|keys')
        self.assertEqual(json.loads((ROOT / 'turbo.json').read_text())['concurrency'], '2')
        self.assertIn('workers: 1,', (ROOT / 'apps/reference-dapp/playwright.config.ts').read_text())

    def test_all_extra_mandatory_suites_and_security_steps_are_unconditional(self):
        body = (ROOT / '.github/workflows/contracts.yml').read_text()
        # The MCP, developer and channel browser suites are guarded-runner profiles now (BrowserPlan checks them).
        for command in ['pnpm test:postgres', 'pnpm exec eslint scripts/guarded-release-browser.mjs',
                        'pnpm sbom --sbom-format cyclonedx', 'pnpm exec vitest run packages/reference-compiler/test/composition.fork.test.ts',
                        'node scripts/guarded-release-browser.mjs critical', 'node scripts/guarded-release-browser.mjs extended',
                        'node scripts/guarded-release-browser.mjs composition']:
            steps = [step for step in re.split(r'(?m)^      - name:', body) if command in step]
            self.assertEqual(len(steps), 1, command)
            self.assertNotRegex(steps[0], r'(?m)^\s*(if|continue-on-error):')
            self.assertIn('          set -euo pipefail\n', steps[0])


class StageReporting(unittest.TestCase):
    def test_real_failing_test_remains_failed_and_later_command_does_not_run(self):
        with tempfile.TemporaryDirectory() as scratch:
            env = {**os.environ, 'RUNNER_TEMP': scratch}
            command = "set -euo pipefail\nsource scripts/ci-observe.sh 'failing test'\npython3 -c 'assert False'\ntouch \"$RUNNER_TEMP/false-success\""
            result = subprocess.run(['bash', '-c', command], cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertFalse((Path(scratch) / 'false-success').exists())
            row = json.loads(next((Path(scratch) / 'flofi-ci-metrics').glob('*.json')).read_text())
            self.assertEqual(row['outcome'], 'failure')
            self.assertIn('duration', row)

    def test_success_and_cancelled_outcomes_remain_distinct(self):
        for command, status, outcome in [('true', 0, 'success'), ('kill -TERM $$', 143, 'cancelled/interrupted')]:
            with tempfile.TemporaryDirectory() as scratch:
                env = {**os.environ, 'RUNNER_TEMP': scratch, 'GITHUB_STEP_SUMMARY': scratch + '/summary'}
                result = subprocess.run(['bash', '-c', "set -euo pipefail\nsource scripts/ci-observe.sh 'stage'\n" + command], cwd=ROOT, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, status)
                summary = subprocess.run(['python3', 'scripts/ci-observe.py', 'summary'], cwd=ROOT, env=env, capture_output=True, text=True)
                self.assertEqual(summary.returncode, 0, summary.stderr)
                self.assertIn(outcome, (Path(scratch) / 'summary').read_text())

    def test_cleanup_only_runs_the_owned_hook_and_preserves_failure(self):
        with tempfile.TemporaryDirectory() as scratch:
            env = {**os.environ, 'RUNNER_TEMP': scratch}
            command = "set -euo pipefail\nsource scripts/ci-observe.sh 'cleanup'\nflofi_ci_cleanup() { touch \"$RUNNER_TEMP/owned-cleanup\"; }\nexit 17"
            result = subprocess.run(['bash', '-c', command], cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 17)
            self.assertTrue((Path(scratch) / 'owned-cleanup').exists())



NODE = shutil.which('node') or 'node'
RUNNER = 'scripts/guarded-release-browser.mjs'
# Every browser profile of main 65c929e (scripts/guarded-release-browser.mjs) with its exact specs and harness settings.
MAIN_PROFILES = {
    # BUILD-FLOFI-LANDING07-README-001 (intentional change): landing07.spec.ts replaces the retired ux-ui-002-landing.spec.ts (Landing 07 at /).
    "default-product": (["brand-ux-001.spec.ts","base-observation.spec.ts","build-roundtrip.spec.ts","build009.spec.ts","across.spec.ts","canvas-keyboard.spec.ts","canvas-ux.spec.ts","contextual-proposals.spec.ts","cross-chain-liquidity-recovery.spec.ts","cross-chain-liquidity.spec.ts","execution-capabilities.spec.ts","interface-honesty.spec.ts","mock-artifact-chain.spec.ts","network-isolation.spec.ts","public-testnet.spec.ts","robinhood-network.spec.ts","swap-authoring.spec.ts","visual-shell.spec.ts","credentials.spec.ts","build-fix-ux.spec.ts","beta-ui.spec.ts","landing07.spec.ts","build-entry.spec.ts"], {}),
    "review-execute-recovery-components": (["simulate-review-acceptance.spec.ts","execute-product-workspace.spec.ts","execute-workflow.spec.ts"], {}),
    "solana-transfer-ux": (["--config", "playwright.transfer-ux.config.ts"], {}),
    "approve-authorize-journeys": (["approve-authorize-journeys.spec.ts"], {"GRYLOO_MCP_E2E":"EMBEDDED_LOOPBACK_ONLY","GRYLOO_CLOUD_RUNTIME_E2E":"EMBEDDED_LOOPBACK_ONLY","FLOFI_SWAP_READ_E2E":"MOCKED_LOOPBACK_ONLY","FLOFI_SWAP_EXECUTION_E2E":"MOCKED_LOOPBACK_ONLY","TEST_DATABASE_URL":"<TEST_DATABASE_URL>"}),
    "workflow-acceptance": (["acceptance-workflows.spec.ts"], {"GRYLOO_CLOUD_RUNTIME_E2E":"EMBEDDED_LOOPBACK_ONLY","GRYLOO_ROUTER_TESTNET_E2E":"MOCKED_LOOPBACK_ONLY","TEST_DATABASE_URL":"<TEST_DATABASE_URL>"}),
    "swap-read-acceptance": (["acceptance-swap-read.spec.ts"], {"GRYLOO_CLOUD_RUNTIME_E2E":"EMBEDDED_LOOPBACK_ONLY","FLOFI_SWAP_READ_E2E":"MOCKED_LOOPBACK_ONLY","TEST_DATABASE_URL":"<TEST_DATABASE_URL>"}),
    "execution-continuity": (["execution-continuity.spec.ts","workflow-ux-execution.spec.ts","conversational-workflow.spec.ts","chat-sequence.spec.ts","chat-assistant.spec.ts"], {"GRYLOO_CLOUD_RUNTIME_E2E":"EMBEDDED_LOOPBACK_ONLY","FLOFI_SWAP_READ_E2E":"MOCKED_LOOPBACK_ONLY","FLOFI_SWAP_EXECUTION_E2E":"MOCKED_LOOPBACK_ONLY","TEST_DATABASE_URL":"<TEST_DATABASE_URL>"}),
    "automations": (["e2e/automations.spec.ts"], {"GRYLOO_CLOUD_RUNTIME_E2E":"EMBEDDED_LOOPBACK_ONLY","FLOFI_SWAP_READ_E2E":"MOCKED_LOOPBACK_ONLY","GRYLOO_AUTOMATION_E2E":"FIXTURE_LOOPBACK_ONLY","TEST_DATABASE_URL":"<TEST_DATABASE_URL>"}),
    "canvas-automation-ux": (["canvas-automation-ux.spec.ts","canvas-cta.spec.ts"], {"GRYLOO_SUPPLY_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "chat-automations": (["copilot-automations.spec.ts"], {"FLOFI_COPILOT":"replay","GRYLOO_CLOUD_RUNTIME_E2E":"EMBEDDED_LOOPBACK_ONLY","FLOFI_SWAP_READ_E2E":"MOCKED_LOOPBACK_ONLY","GRYLOO_AUTOMATION_E2E":"FIXTURE_LOOPBACK_ONLY","TEST_DATABASE_URL":"<TEST_DATABASE_URL>"}),
    "delegated-execution": (["e2e/delegated-execution.spec.ts"], {"FLOFI_COPILOT":"replay","GRYLOO_CLOUD_RUNTIME_E2E":"EMBEDDED_LOOPBACK_ONLY","FLOFI_SWAP_READ_E2E":"MOCKED_LOOPBACK_ONLY","GRYLOO_AUTOMATION_E2E":"FIXTURE_LOOPBACK_ONLY","GRYLOO_DELEGATION_E2E":"MOCKED_LOOPBACK_ONLY","TEST_DATABASE_URL":"<TEST_DATABASE_URL>"}),
    "supply-provenance": (["release-provenance.spec.ts"], {"GRYLOO_SUPPLY_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "unsafe-lending-simulations": (["borrow.spec.ts","repay.spec.ts","--grep","read-only simulation blocks unsafe Borrow before Review|insufficient debt blocks read-only simulation"], {"GRYLOO_SUPPLY_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "copilot": (["copilot.spec.ts","copilot-conversation.spec.ts"], {"FLOFI_COPILOT":"replay","GRYLOO_SUPPLY_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "copilot-learning": (["copilot-learning-memory.spec.ts"], {"FLOFI_COPILOT":"replay","FLOFI_LEARNING_E2E":"LOOPBACK_ONLY","TEST_DATABASE_URL":"<TEST_DATABASE_URL>"}),
    "copilot-solana": (["copilot-solana.spec.ts"], {"FLOFI_COPILOT":"replay","GRYLOO_SOLANA_DEVNET_E2E":"MOCKED_LOOPBACK_ONLY"}),
    # BUILD-FLOFI-MAINNET-PRODUCT-001 (intentional change): this profile now certifies the public Mainnet-only product as deployed.
    "solana-mainnet-network": (["solana-mainnet-network.spec.ts"], {"GRYLOO_SOLANA_DEVNET_E2E":"MOCKED_LOOPBACK_ONLY","FLOFI_E2E_NETWORK_SCOPE":"PUBLIC_MAINNET"}),
    "canvas-corrections": (["canvas-corrections.spec.ts"], {}),
    # HOTFIX-PHANTOM-LIGHTHOUSE-001 (intentional change): the profile also certifies verified Phantom Lighthouse protections end to end.
    "solana-wallet-refusal": (["solana-swap-liquidity-composition.spec.ts","--grep","a wallet that changes the reviewed swap|a Phantom-like wallet signs the exact reviewed swap|a Phantom wallet with Lighthouse protections|a reconciled swap continues to its Orca position"], {"GRYLOO_SOLANA_DEVNET_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "lending-provenance": (["release-financial-provenance.spec.ts"], {"FLOFI_RELEASE_PROVENANCE_PROFILE":"lending","GRYLOO_LENDING_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "jupiter-provenance": (["release-financial-provenance.spec.ts"], {"FLOFI_RELEASE_PROVENANCE_PROFILE":"jupiter","GRYLOO_JUPITER_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "devnet-provenance": (["release-financial-provenance.spec.ts"], {"FLOFI_RELEASE_PROVENANCE_PROFILE":"solana-devnet","GRYLOO_SOLANA_DEVNET_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "orca-liquidity-provenance": (["release-financial-provenance.spec.ts"], {"FLOFI_RELEASE_PROVENANCE_PROFILE":"solana-liquidity","GRYLOO_SOLANA_DEVNET_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "solana-composition-provenance": (["release-financial-provenance.spec.ts"], {"FLOFI_RELEASE_PROVENANCE_PROFILE":"solana-composition","GRYLOO_SOLANA_DEVNET_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "transfer-provenance": (["release-financial-provenance.spec.ts"], {"FLOFI_RELEASE_PROVENANCE_PROFILE":"transfer","GRYLOO_ROBINHOOD_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "robinhood-mainnet-authoring": (["robinhood-stocks.spec.ts"], {"GRYLOO_ROBINHOOD_MAINNET_E2E":"MOCKED_LOOPBACK_ONLY","FLOFI_COPILOT":"replay"}),
    "arbitrum-authoring-certification": (["--config","playwright.arbitrum-authoring.config.ts"], {}),
    "workflow-ux-authoring": (["--config","playwright.workflow-ux.config.ts"], {}),
    "canvas-workflow-ux": (["--config","playwright.canvas-workflow-ux.config.ts","canvas-workflow-ux.spec.ts"], {}),
    "base-mainnet-authoring": (["base-mainnet-authoring.spec.ts"], {"GRYLOO_BASE_MAINNET_E2E":"MOCKED_LOOPBACK_ONLY","FLOFI_COPILOT":"replay"}),
    "uniswap-provenance": (["release-financial-provenance.spec.ts"], {"FLOFI_RELEASE_PROVENANCE_PROFILE":"uniswap","GRYLOO_UNISWAP_LIQUIDITY_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "router-provenance": (["release-financial-provenance.spec.ts"], {"FLOFI_RELEASE_PROVENANCE_PROFILE":"router","GRYLOO_ROUTER_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "journey-provenance": (["release-financial-provenance.spec.ts"], {"FLOFI_RELEASE_PROVENANCE_PROFILE":"journey","GRYLOO_ROUTER_TESTNET_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "admin-console": (["admin-console.spec.ts"], {"FLOFI_ADMIN_E2E":"LOOPBACK_ONLY","TEST_DATABASE_URL":"<TEST_DATABASE_URL>"}),
    "cloud-provenance": (["release-financial-provenance.spec.ts"], {"FLOFI_RELEASE_PROVENANCE_PROFILE":"cloud","GRYLOO_CLOUD_RUNTIME_E2E":"EMBEDDED_LOOPBACK_ONLY","TEST_DATABASE_URL":"<TEST_DATABASE_URL>"}),
    "synthetic-fork-provenance": (["release-fork-provenance.spec.ts"], {"GRYLOO_MODE_A_E2E":"synthetic"}),
    "cow-loopback": (["cow-intent.spec.ts","cow-recovery.spec.ts"], {"GRYLOO_COW":"loopback"}),
    "card-provider-loopback": (["card-provider.spec.ts"], {"GRYLOO_CARD_E2E":"MOCKED_LOOPBACK_ONLY"}),
    "composition-provenance": (["release-composition-provenance.spec.ts"], {}),
}
# main ran these as separate Playwright commands after the product phase; they are profiles of the same runner now.
MAIN_SEPARATE_SUITES = {
    'mcp-routes-oauth-disabled': (['mcp-route-presentation.spec.ts'], {}),
    'developer-journey': (['developer-journey.spec.ts'], {'GRYLOO_MCP_E2E': 'EMBEDDED_LOOPBACK_ONLY', 'TEST_DATABASE_URL': '<TEST_DATABASE_URL>'}),
    'mcp-in-chat': (['mcp-in-chat.spec.ts', 'mcp-route-presentation.spec.ts', '--grep-invert', 'embedded wallet proof'], {'GRYLOO_MCP_E2E': 'EMBEDDED_LOOPBACK_ONLY', 'FLOFI_MCP_OAUTH_ACCESS': 'open', 'TEST_DATABASE_URL': '<TEST_DATABASE_URL>'}),
    'mcp-embedded-signing': (['mcp-in-chat.spec.ts', '--grep', 'embedded wallet proof'], {'GRYLOO_MCP_E2E': 'EMBEDDED_LOOPBACK_ONLY', 'FLOFI_MCP_OAUTH_ACCESS': 'open', 'TEST_DATABASE_URL': '<TEST_DATABASE_URL>'}),
    'channel-signing': (['channel-signing.spec.ts'], {'GRYLOO_MCP_E2E': 'EMBEDDED_LOOPBACK_ONLY', 'TEST_DATABASE_URL': '<TEST_DATABASE_URL>'}),
    'channel-approve': (['whatsapp-approve.spec.ts', 'telegram-approve.spec.ts'], {'GRYLOO_MCP_E2E': 'EMBEDDED_LOOPBACK_ONLY',
                        'GRYLOO_CHANNEL_E2E': 'FIXTURE_LOOPBACK_ONLY', 'TEST_DATABASE_URL': '<TEST_DATABASE_URL>'}),
}
CRITICAL = ['copilot-learning', 'canvas-corrections', 'solana-wallet-refusal', 'supply-provenance', 'review-execute-recovery-components', 'solana-transfer-ux']


def browser_plan():
    return json.loads(subprocess.run([NODE, RUNNER, 'list'], cwd=ROOT, check=True, capture_output=True, text=True).stdout)


def actions_steps():
    body = (ROOT / '.github/workflows/contracts.yml').read_text()
    return [(re.match(r'      - name: (.+)', step).group(1), step) for step in re.split(r'(?m)^(?=      - name: )', body)[1:]]


def run_body(text, indent):
    """The shell lines of a `run: |` / `command: |` block (or of the script it runs), without the YAML indentation."""
    match = re.search(r'(?m)^ +(?:run|command): \|\n((?:' + ' ' * indent + r'.*\n|\n)+)', text)
    if match:
        return [line[indent:] for line in match.group(1).rstrip('\n').split('\n')]
    script = re.search(r'(?m)^ +command: bash (\.circleci/scripts/[\w-]+\.sh)$', text)
    return (ROOT / script.group(1)).read_text().rstrip('\n').split('\n') if script else []


def circleci():
    """CircleCI jobs as {name: [(step name, step text, shell lines)]}, with reusable commands expanded in place."""
    body = (ROOT / '.circleci/config.yml').read_text()
    def blocks(section):
        text = body.split('\n' + section + ':\n', 1)[1]
        text = re.split(r'(?m)^\S', text, maxsplit=1)[0]
        return {match.group(1): match.group(2) for match in re.finditer(r'(?m)^  ([\w-]+):\n((?:   .*\n|\n)*)', text)}
    commands = blocks('commands')
    def steps(text, indent):
        result = []
        for step in re.split(r'(?m)^(?=' + ' ' * indent + '- )', text.split('steps:\n', 1)[1])[1:]:
            name = step.strip()[2:].split(':', 1)[0].strip()
            if name in commands:
                result += steps(commands[name], 6)
            else:
                label = re.search(r'name: "([^"]+)"', step)
                result.append((label.group(1) if label else name, step, run_body(step, indent + 6)))
        return result
    return {name: steps(text, 6) for name, text in blocks('jobs').items()}, body


class BrowserPlan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = browser_plan()

    def test_every_main_suite_still_runs_with_the_same_specs_and_harness(self):
        profiles = self.plan['profiles']
        for name, (specs, settings) in {**MAIN_PROFILES, **MAIN_SEPARATE_SUITES}.items():
            with self.subTest(profile=name):
                self.assertIn(name, profiles)
                self.assertEqual(profiles[name]['specs'], specs)
                self.assertEqual(profiles[name]['settings'], settings)
        # The OAuth-disabled route presentation is a distinct mode of the same spec, not a duplicate run.
        self.assertNotIn('GRYLOO_MCP_E2E', profiles['mcp-routes-oauth-disabled']['settings'])

    def test_each_profile_runs_exactly_once_in_every_ci_plan(self):
        plan = self.plan
        self.assertEqual(plan['product'], plan['critical'] + plan['extended'])
        self.assertEqual(plan['extended'], [name for shard in plan['shards'] for name in shard])
        self.assertEqual(len(plan['product']), len(set(plan['product'])))
        self.assertEqual(sorted(plan['product'] + plan['composition']), sorted(plan['profiles']))
        self.assertEqual(plan['composition'], ['composition-provenance'])

    def test_critical_regressions_run_first(self):
        self.assertEqual(self.plan['critical'], CRITICAL)
        self.assertEqual(self.plan['product'][:len(CRITICAL)], CRITICAL)
        specs = {spec for name in CRITICAL for spec in self.plan['profiles'][name]['specs']}
        for spec in ['copilot-learning-memory.spec.ts', 'canvas-corrections.spec.ts', 'solana-swap-liquidity-composition.spec.ts',
                     'release-provenance.spec.ts', 'simulate-review-acceptance.spec.ts', 'execute-product-workspace.spec.ts']:
            self.assertIn(spec, specs)

    def test_every_spec_filter_selects_exactly_one_file(self):
        # Playwright reads a CLI filter as a regular expression over the file path: a filter that also matches a newer
        # spec would silently run (or, with --grep, hide) more than the profile intends.
        app = ROOT / 'apps/reference-dapp'
        files = [str(path) for path in (app / 'e2e').rglob('*.spec.ts')]
        for name, profile in self.plan['profiles'].items():
            args = profile['specs']
            for index, arg in enumerate(args):
                if arg.startswith('--'):
                    continue
                if index and args[index - 1] == '--config':
                    self.assertTrue((app / arg).is_file(), arg)
                elif not index or args[index - 1] not in {'--grep', '--grep-invert'}:
                    with self.subTest(profile=name, filter=arg):
                        self.assertEqual(len([path for path in files if re.search(arg, path)]), 1)


class CiParity(unittest.TestCase):
    # Gates both CI systems run unconditionally (GitHub Actions in one job, CircleCI across the certification jobs).
    MANDATORY = ['python3 scripts/bootstrap-ci.py', 'pnpm install --frozen-lockfile --ignore-scripts', 'python3 scripts/bootstrap-ci.py --verify-dependencies',
                 'pnpm audit --audit-level low', 'pnpm typecheck', 'pnpm lint', 'pnpm exec eslint scripts/guarded-release-browser.mjs', 'pnpm build',
                 'pnpm schemas:check', 'python3 scripts/agent_guard.py check',
                 'pnpm test --reporter=default --reporter=json --outputFile="$RUNNER_TEMP/flofi-agent-unit.json"',
                 'python3 scripts/agent_guard.py verify-results "$RUNNER_TEMP/flofi-agent-unit.json"',
                 'python3 scripts/summarize-screenshot-diffs.py --self-test',
                 'pnpm test:postgres --reporter=default --reporter=json --outputFile="$RUNNER_TEMP/flofi-agent-postgres.json"',
                 'python3 scripts/agent_guard.py verify-results --stage postgres "$RUNNER_TEMP/flofi-agent-postgres.json"',
                 'python3 scripts/bootstrap-anvil.py "$RUNNER_TEMP/gryloo-anvil/foundry-v1.8.3"', 'pnpm test:anvil', 'pnpm test:fork --testTimeout=30000',
                 'node apps/reference-dapp/e2e/fork/offline-rehearsal.mjs > "$RUNNER_TEMP/build-003f-f1.json"',
                 'python3 scripts/bootstrap-playwright.py "$BUILD002_BROWSER_CACHE"', 'node scripts/guarded-release-browser.mjs critical',
                 'node scripts/guarded-release-browser.mjs composition', 'node apps/reference-dapp/e2e/fork/composition-harness.mjs serve > "$RUNNER_TEMP/gryloo-b007-harness.log" 2>&1 &',
                 'pnpm sbom --sbom-format cyclonedx --sbom-spec-version 1.6 --lockfile-only --out "$RUNNER_TEMP/build-003a.cdx.json"']
    CONDITIONAL = {'Summarize screenshot differences after a browser failure', 'CI timing summary after failure', 'CI timing summary after success'}

    @classmethod
    def setUpClass(cls):
        cls.plan = browser_plan()
        cls.jobs, cls.circle = circleci()
        cls.actions = actions_steps()
        cls.certification = {name: steps for name, steps in cls.jobs.items() if name.startswith('certification-')}

    def circle_lines(self):
        return [(job, name, step, lines) for job, steps in self.certification.items() for name, step, lines in steps]

    def test_mandatory_gates_run_unconditionally_in_both_systems(self):
        for command in self.MANDATORY:
            with self.subTest(command=command):
                actions = [step for _, step in self.actions if command in run_body(step, 10)]
                self.assertEqual(len(actions), 1)
                self.assertNotRegex(actions[0], r'(?m)^\s*(if|continue-on-error):')
                circle = [(job, step, lines) for job, _, step, lines in self.circle_lines() if command in lines]
                self.assertTrue(circle)
                for job, step, lines in circle:
                    self.assertNotIn('when:', step)
                    self.assertEqual(lines[0] if lines[0] != '#!/usr/bin/env bash' else lines[3], 'set -euo pipefail')
                    self.assertFalse([line for line in lines if command in line and re.search(r'\|\|\s*(true|exit 0)', line)])
                    self.assertNotIn('set +e', lines)
        self.assertEqual(len([1 for _, _, _, lines in self.circle_lines() if 'node scripts/guarded-release-browser.mjs critical' in lines]), 1)

    def test_extended_profiles_run_once_per_system(self):
        actions = [line for _, step in self.actions for line in run_body(step, 10) if line.startswith('node scripts/guarded-release-browser.mjs extended')]
        self.assertEqual(actions, ['node scripts/guarded-release-browser.mjs extended'])
        circle = sorted(line for _, _, _, lines in self.circle_lines() for line in lines if line.startswith('node scripts/guarded-release-browser.mjs extended'))
        total = len(self.plan['shards'])
        self.assertEqual(circle, [f'node scripts/guarded-release-browser.mjs extended --shard {index}/{total}' for index in range(1, total + 1)])

    def test_circleci_scripts_are_exact_copies_of_the_actions_steps(self):
        steps = dict(self.actions)
        for script, name in [('ci-fork.sh', 'Offline compatibility gate and fork suite'), ('ci-sbom.sh', 'Validate and remove ephemeral CycloneDX 1.6 SBOM'),
                             ('ci-composition.sh', 'Composition fork and browser suites')]:
            lines = (ROOT / '.circleci/scripts' / script).read_text().rstrip('\n').split('\n')
            self.assertEqual(lines[:4], ['#!/usr/bin/env bash', '# Exact CircleCI backup copy of the approved GitHub Actions certification command.',
                                         '# Keep aligned with .github/workflows/contracts.yml; fail closed on any error.', 'set -euo pipefail'])
            self.assertEqual(lines[3:], run_body(steps[name], 10), script)

    def test_certification_fans_in_every_parallel_job_and_verifies_the_ledger(self):
        workflow = self.circle.split('\nworkflows:\n', 1)[1]
        requires = {match.group(1): re.findall(r'(?m)^            - ([\w-]+)$', match.group(2) or '')
                    for match in re.finditer(r'(?m)^      - ([\w-]+)(?::\n((?:        .*\n)*))?', workflow)}
        self.assertEqual(set(requires), {'governance', 'certification', *self.certification})
        self.assertEqual(set(self.certification), {'certification-checks', 'certification-browser-1', 'certification-browser-2'})
        for job in self.certification:
            self.assertEqual(requires[job], ['governance'])
        self.assertEqual(sorted(requires['certification']), sorted(self.certification))
        verify = [lines for _, _, lines in self.jobs['certification'] if 'python3 scripts/ci-observe.py verify' in lines]
        self.assertEqual(verify, [['set -euo pipefail', 'test "$(node --version)" = "v24.21.0"', 'python3 scripts/ci-observe.py verify']])
        self.assertIn('python3 scripts/ci-observe.py verify', [line for _, step in self.actions for line in run_body(step, 10)])
        for job, steps in self.certification.items():
            names = [name for name, _, _ in steps]
            self.assertIn('persist_to_workspace', names, job)
            self.assertNotIn('when: always', ''.join(step for _, step, _ in steps))
            for name, step, _ in steps:
                if 'when:' in step:
                    self.assertIn(name, self.CONDITIONAL, job)

    def test_critical_browser_regressions_run_before_the_slow_suites(self):
        def position(command):
            return next(index for index, (_, step) in enumerate(self.actions) if command in run_body(step, 10))
        self.assertLess(position('pnpm build'), position('node scripts/guarded-release-browser.mjs critical'))
        for later in ['pnpm test --reporter=default --reporter=json --outputFile="$RUNNER_TEMP/flofi-agent-unit.json"',
                      'pnpm test:postgres --reporter=default --reporter=json --outputFile="$RUNNER_TEMP/flofi-agent-postgres.json"',
                      'pnpm test:fork --testTimeout=30000', 'node scripts/guarded-release-browser.mjs extended']:
            self.assertLess(position('node scripts/guarded-release-browser.mjs critical'), position(later), later)
        browser = [lines for _, _, lines in self.jobs['certification-browser-1'] if any(line.startswith('node scripts/guarded-release-browser.mjs') for line in lines)]
        self.assertEqual([line for lines in browser for line in lines if line.startswith('node scripts/')],
                         ['node scripts/guarded-release-browser.mjs critical', 'node scripts/guarded-release-browser.mjs extended --shard 1/2'])

    def test_failure_artifacts_test_reports_and_timings_are_kept(self):
        for job in ['certification-browser-1', 'certification-browser-2']:
            names = [name for name, _, _ in self.jobs[job]]
            self.assertIn('store_test_results', names)
            self.assertIn('store_artifacts', names)
            self.assertIn('Summarize screenshot differences after a browser failure', names)
        self.assertIn('path: apps/reference-dapp/test-results/junit', self.circle)
        upload = dict(self.actions)['Upload browser failure artifacts (screenshots, error context, diagnostic traces, JUnit, profile timings)']
        for path in ['**/trace.zip', '**/test-failed-*.png', '**/*-diff.png', 'junit/*.xml', 'guarded-*.json']:
            self.assertIn('apps/reference-dapp/test-results/' + path, upload)
        runner = (ROOT / RUNNER).read_text()
        for marker in ["'--output', output, '--add-reporter', 'junit'", 'PLAYWRIGHT_JUNIT_OUTPUT_FILE: junit', "'--last-failed', '--last-failed-file', lastRun",
                       "'--trace', 'on'"]:
            self.assertIn(marker, runner)
        config = (ROOT / 'apps/reference-dapp/playwright.config.ts').read_text()
        self.assertIn("video: 'off', trace: 'off', screenshot: 'only-on-failure',", config)
        self.assertIn('retries: 0,', config)


FAKE_PNPM = r"""#!/usr/bin/env bash
# Stand-in for `pnpm --filter … exec playwright test …`: records the call, fails the configured spec.
printf '%s\t%s\n' "$*" "${PLAYWRIGHT_JUNIT_OUTPUT_FILE:-}" >> "$FAKE_LOG"
out=""; prev=""
for arg in "$@"; do [ "$prev" = "--output" ] && out="$arg"; prev="$arg"; done
mkdir -p "$out"
if [ -n "${FAKE_JUNIT:-}" ] && [ -n "${PLAYWRIGHT_JUNIT_OUTPUT_FILE:-}" ]; then
  mkdir -p "$(dirname "$PLAYWRIGHT_JUNIT_OUTPUT_FILE")"; printf '%s' "$FAKE_JUNIT" > "$PLAYWRIGHT_JUNIT_OUTPUT_FILE"
fi
case " $* " in *" --last-failed "*) exit "${FAKE_RERUN_STATUS:-1}";; esac
for spec in "${FAKE_FAIL:-}" "${FAKE_FAIL_2:-}" "${FAKE_FAIL_3:-}" "${FAKE_FAIL_4:-}"; do
if [ -n "$spec" ] && [[ " $* " == *" $spec "* ]]; then
  tests='["t1"]'; [ -n "${FAKE_NO_TESTS:-}" ] && tests='[]'
  printf '{"status":"failed","failedTests":%s}\n' "$tests" > "$out/.last-run.json"
  exit "${FAKE_STATUS:-1}"
fi
done
exit 0
"""


class GuardedRunner(unittest.TestCase):
    """The real runner against a stand-in Playwright: failures keep their exit code and are never swallowed."""
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        (self.root / 'scripts').mkdir()
        shutil.copy(ROOT / RUNNER, self.root / RUNNER)
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'pnpm').write_text(FAKE_PNPM)
        (bin_dir / 'pnpm').chmod(0o755)
        self.log = self.root / 'calls.log'
        self.env = {key: value for key, value in os.environ.items() if key != 'RUNNER_TEMP'}
        self.env.update(PATH=f"{bin_dir}:{os.environ['PATH']}", FAKE_LOG=str(self.log), RUNNER_TEMP=str(self.root / 'runner'))

    def run_phase(self, *args, **env):
        return subprocess.run([NODE, RUNNER, *args], cwd=self.root, env={**self.env, **env}, capture_output=True, text=True)

    def calls(self):
        return [line.split('\t') for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def report(self, label):
        return json.loads((self.root / 'runner/flofi-ci-metrics/browser' / (label + '.json')).read_text())

    def test_passing_phase_records_timings_junit_and_isolated_artifacts(self):
        result = self.run_phase('critical')
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        self.assertEqual(len(calls), len(CRITICAL))
        results = self.root / 'apps/reference-dapp/test-results'
        for (args, junit), name in zip(calls, CRITICAL):
            self.assertIn(f'--output {results / name} --add-reporter junit', args)
            self.assertEqual(junit, str(results / 'junit' / (name + '.xml')))
        report = self.report('critical')
        self.assertEqual(report['status'], 'PASS')
        self.assertEqual([row['name'] for row in report['profiles']], CRITICAL)
        self.assertTrue(all(row['status'] == 'PASS' and row['seconds'] >= 0 for row in report['profiles']))
        self.assertIn('Guarded release critical: PASS (6 profiles)', result.stdout)
        self.assertEqual(json.loads((results / 'guarded-critical.json').read_text()), report)

    def test_ci_test_report_names_the_profile_and_keeps_failure_output(self):
        junit = ('<testsuites><testsuite name="a.spec.ts" tests="3">\n'
                 '<testcase name="passes" classname="a.spec.ts" time="1">\n<system-out>\n<![CDATA[server log]]>\n</system-out>\n</testcase>\n'
                 '<testcase name="fails" classname="a.spec.ts" time="1">\n<failure message="boom"/>\n<system-out>\n<![CDATA[evidence]]>\n</system-out>\n</testcase>\n'
                 '<testcase name="plain" classname="a.spec.ts" time="1"/>\n</testsuite></testsuites>')
        result = self.run_phase('profile', 'copilot-learning', FAKE_JUNIT=junit)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = (self.root / 'apps/reference-dapp/test-results/junit/copilot-learning.xml').read_text()
        self.assertIn('<testsuite name="copilot-learning › a.spec.ts"', report)
        self.assertEqual(report.count('classname="copilot-learning › a.spec.ts"'), 3)
        self.assertNotIn('server log', report)  # a passing case's output would make CircleCI list it as "system-out"
        self.assertIn('<failure message="boom"/>', report)
        self.assertIn('evidence', report)
        self.assertEqual(report.count('</testcase>'), 2)

    def test_failing_profile_keeps_its_exit_code_and_stops_the_phase(self):
        result = self.run_phase('critical', FAKE_FAIL='canvas-corrections.spec.ts', FAKE_STATUS='7', FAKE_RERUN_STATUS='0')
        self.assertEqual(result.returncode, 7)
        calls = [args for args, _ in self.calls()]
        self.assertEqual(len([args for args in calls if '--last-failed' not in args]), 2)  # later profiles never start
        rerun = [args for args in calls if '--last-failed' in args]
        self.assertEqual(len(rerun), 1)
        self.assertIn('--trace on', rerun[0])
        self.assertNotIn('--add-reporter junit', rerun[0])  # a diagnostic rerun never reaches the CI test report
        for text in ['Guarded release FAIL: profile canvas-corrections (critical), exit code 7.', 'Specs: canvas-corrections.spec.ts',
                     'Reproduce: node scripts/guarded-release-browser.mjs profile canvas-corrections',
                     'Not run (never counted as passes): solana-wallet-refusal, supply-provenance, review-execute-recovery-components, solana-transfer-ux',
                     'Diagnostic trace rerun passed: the failure is intermittent; the profile stays FAILED']:
            self.assertIn(text, result.stderr)
        report = self.report('critical')
        self.assertEqual(report['status'], 'FAIL')
        self.assertEqual([row['status'] for row in report['profiles']], ['PASS', 'FAIL', 'NOT_RUN', 'NOT_RUN', 'NOT_RUN', 'NOT_RUN'])
        self.assertEqual(report['profiles'][1]['diagnostic']['rerunExitCode'], 0)

    def test_failure_outside_a_test_and_disabled_trace_still_fail(self):
        result = self.run_phase('profile', 'copilot-learning', FAKE_FAIL='copilot-learning-memory.spec.ts', FAKE_NO_TESTS='1')
        self.assertEqual(result.returncode, 1)
        self.assertIn('no failed test was recorded', result.stderr)
        result = self.run_phase('profile', 'copilot-learning', FAKE_FAIL='copilot-learning-memory.spec.ts', FLOFI_BROWSER_FAILURE_TRACE='off')
        self.assertEqual(result.returncode, 1)
        self.assertFalse([args for args, _ in self.calls() if '--last-failed' in args])

    def test_collected_failures_run_every_profile_and_keep_original_failure(self):
        result = self.run_phase('critical', '--collect-failures', FAKE_FAIL='copilot-learning-memory.spec.ts',
                                FAKE_FAIL_2='canvas-corrections.spec.ts', FAKE_STATUS='7', FAKE_RERUN_STATUS='0')
        self.assertEqual(result.returncode, 7, result.stderr)
        calls = [args for args, _ in self.calls()]
        self.assertEqual(len([args for args in calls if '--last-failed' not in args]), len(CRITICAL))
        self.assertEqual(len([args for args in calls if '--last-failed' in args]), 2)
        report = self.report('critical')
        self.assertEqual(report['status'], 'FAIL')
        self.assertEqual([row['status'] for row in report['profiles']], ['FAIL', 'FAIL', 'PASS', 'PASS', 'PASS', 'PASS'])
        for row in report['profiles'][:2]:
            self.assertEqual(row['exitCode'], 7)
            self.assertEqual(row['diagnostic']['rerunExitCode'], 0)

    def test_collected_start_errors_are_failures_for_every_profile(self):
        result = self.run_phase('critical', '--collect-failures', PATH='/nonexistent', FLOFI_BROWSER_FAILURE_TRACE='off')
        self.assertEqual(result.returncode, 1)
        report = self.report('critical')
        self.assertEqual(report['status'], 'FAIL')
        self.assertEqual([row['status'] for row in report['profiles']], ['FAIL'] * len(CRITICAL))

    def test_missing_playwright_and_invalid_selections_fail_closed(self):
        result = self.run_phase('critical', PATH='/nonexistent')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.report('critical')['status'], 'FAIL')
        for args in [[], ['product', 'extra'], ['extended', '--shard', '3/2'], ['extended', '--shard', '1/3'], ['profile', 'unknown'], ['all']]:
            with self.subTest(args=args):
                self.assertNotEqual(self.run_phase(*args).returncode, 0)
        self.assertFalse(self.calls())

    def test_a_plan_that_drops_or_repeats_a_profile_refuses_to_run(self):
        source = (self.root / RUNNER).read_text()
        for broken in [source.replace("'canvas-workflow-ux'],", "],", 1), source.replace('const critical = [', "const critical = ['copilot', ", 1)]:
            with self.subTest():
                self.assertNotEqual(broken, source)
                (self.root / RUNNER).write_text(broken)
                result = self.run_phase('list')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Guarded browser plan must place every product profile exactly once', result.stderr)


class CertificationLedger(unittest.TestCase):
    """`ci-observe.py verify` (the CircleCI fan-in and the last Actions step) fails closed on any missing or failed suite."""
    observe = load_script('ci-observe')

    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.metrics = Path(scratch.name) / 'flofi-ci-metrics'
        (self.metrics / 'browser').mkdir(parents=True)
        self.env = patch.dict(os.environ, {'RUNNER_TEMP': scratch.name})
        self.env.start()
        self.addCleanup(self.env.stop)
        for index, name in enumerate(self.observe.REQUIRED_STAGES):
            self.write(f'{index:032x}.json', {'name': name, 'job': 'certification-checks', 'start': index, 'outcome': 'success', 'duration': 1.0})
        plan = browser_plan()
        shards = [('critical', None, plan['critical']), *[('extended', f'{i}/{len(plan["shards"])}', names) for i, names in enumerate(plan['shards'], 1)],
                  ('composition', None, plan['composition'])]
        for phase, shard, names in shards:
            self.write_report(f'{phase}-{shard or "all"}'.replace('/', '-'), phase, shard, names)

    def write(self, name, record):
        (self.metrics / name).write_text(json.dumps(record))

    def write_report(self, label, phase, shard, names, status='PASS'):
        rows = [{'name': name, 'specs': [], 'status': status, 'seconds': 1.0, 'exitCode': 0} for name in names]
        (self.metrics / 'browser' / (label + '.json')).write_text(json.dumps({'kind': 'guarded-browser', 'phase': phase, 'shard': shard, 'label': label,
                                                                               'status': status, 'profiles': rows}))

    def verify(self):
        with redirect_stdout(io.StringIO()) as output:
            return self.observe.verify(self.metrics), output.getvalue()

    def test_complete_ledger_passes(self):
        status, output = self.verify()
        self.assertEqual(status, 0, output)
        self.assertIn('Certification ledger: PASS', output)

    def test_missing_failed_or_incomplete_stage_fails(self):
        for mutation in ['missing', 'failure', 'incomplete']:
            with self.subTest(mutation=mutation):
                path = self.metrics / f'{9:032x}.json'
                saved = path.read_text()
                record = json.loads(saved)
                if mutation == 'missing':
                    path.unlink()
                elif mutation == 'failure':
                    path.write_text(json.dumps({**record, 'outcome': 'failure'}))
                else:
                    path.write_text(json.dumps({key: value for key, value in record.items() if key != 'duration'} | {'outcome': 'incomplete'}))
                status, output = self.verify()
                self.assertEqual(status, 1)
                self.assertIn(record['name'], output)
                path.write_text(saved)

    def test_missing_repeated_failed_or_unplanned_profiles_fail(self):
        plan = browser_plan()
        cases = {
            'missing': lambda: self.write_report('extended-2-2', 'extended', '2/2', plan['shards'][1][1:]),
            'repeated': lambda: self.write_report('extended-again', 'extended', None, plan['shards'][0][:1]),
            'failed': lambda: self.write_report('critical-all', 'critical', None, plan['critical'], status='FAIL'),
            'running': lambda: self.write_report('composition-all', 'composition', None, plan['composition'], status='RUNNING'),
            'unplanned': lambda: self.write_report('profile-copilot', 'profile', None, ['copilot']),
        }
        for mutation, apply in cases.items():
            with self.subTest(mutation=mutation):
                saved = {path: path.read_text() for path in (self.metrics / 'browser').glob('*.json')}
                apply()
                status, output = self.verify()
                self.assertEqual(status, 1, output)
                for path in (self.metrics / 'browser').glob('*.json'):
                    if path not in saved:
                        path.unlink()
                for path, text in saved.items():
                    path.write_text(text)


if __name__ == '__main__':
    unittest.main()
