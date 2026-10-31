"""Exercise Cloud's real collector and strict ledger with lightweight test doubles."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from test_ci_optimization import FAKE_PNPM, ROOT, browser_plan, load_script


class CloudOrchestration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.metrics = self.root / 'runner/flofi-ci-metrics'
        self.metrics.mkdir(parents=True)
        (self.root / 'scripts').mkdir()
        for name in ['gcp-ci-certify.sh', 'guarded-release-browser.mjs', 'ci-observe.sh', 'ci-observe.py']:
            shutil.copy(ROOT / 'scripts' / name, self.root / 'scripts' / name)
        (self.root / 'bin').mkdir()
        pnpm = self.root / 'bin/pnpm'
        pnpm.write_text(FAKE_PNPM)
        pnpm.chmod(0o755)
        self.log = self.root / 'calls.log'
        self.env = {**os.environ, 'PATH': f'{self.root / "bin"}:{os.environ["PATH"]}',
                    'RUNNER_TEMP': str(self.root / 'runner'), 'FAKE_LOG': str(self.log)}

        # Stub only external setup/fork work, not collection, reporting, the
        # browser runner or the ledger. All 50 profiles execute the fake pnpm.
        composition = (ROOT / 'scripts/gcp-ci-composition.sh').read_text()
        tail = composition[composition.index('composition_status=0\n'):]
        (self.root / 'scripts/gcp-ci-composition.sh').write_text(
            "set -euo pipefail\nsource scripts/ci-observe.sh 'Composition fork and browser'\n" + tail)
        fork = self.root / '.circleci/scripts'
        fork.mkdir(parents=True)
        (fork / 'ci-fork.sh').write_text(
            "set -euo pipefail\nsource scripts/ci-observe.sh 'Anvil and offline forks'\npnpm test:fork --testTimeout=30000\n")
        (self.root / 'scripts/summarize-screenshot-diffs.py').write_text('')
        # Isolate the pipeline's failure handling; the guard itself has its own
        # repository/inventory tests. This double also exercises a guard refusal.
        (self.root / 'scripts/agent_guard.py').write_text(
            "import os, sys\n"
            "with open(os.environ['FAKE_LOG'], 'a') as log: log.write('agent_guard ' + ' '.join(sys.argv[1:]) + '\\n')\n"
            "if sys.argv[1] == 'verify-results':\n"
            "    key = 'FAKE_GUARD_POSTGRES_RESULTS_STATUS' if 'postgres' in sys.argv else 'FAKE_GUARD_RESULTS_STATUS'\n"
            "else: key = 'FAKE_GUARD_STATUS'\n"
            "sys.exit(int(os.environ.get(key, '0')))\n")
        dist = self.root / 'packages/reference-linter/dist'
        dist.mkdir(parents=True)
        for name in ['index.js', 'index.d.ts']:
            (dist / name).touch()
        # These stages already passed before the post-build orchestrator starts.
        remaining = {'Critical browser regressions', 'Guarded browser suites', 'Composition fork and browser',
                     'Typecheck', 'Lint', 'Schema drift', 'Unit and contract tests', 'PostgreSQL', 'Anvil and offline forks'}
        required = load_script('ci-observe').REQUIRED_STAGES
        for index, name in enumerate(required):
            if name not in remaining:
                (self.metrics / f'{index:032x}.json').write_text(json.dumps(
                    {'name': name, 'job': 'setup', 'start': index, 'outcome': 'success', 'duration': 1.0}))

    def run_cloud(self, **env):
        return subprocess.run(['bash', 'scripts/gcp-ci-certify.sh'], cwd=self.root,
                              env={**self.env, **env}, capture_output=True, text=True, timeout=45)

    def stages(self):
        return {row['name']: row for path in self.metrics.glob('*.json') if (row := json.loads(path.read_text()))}

    def reports(self):
        return [json.loads(path.read_text()) for path in (self.metrics / 'browser').glob('*.json')]

    def test_green_requires_every_stage_and_all_50_profiles(self):
        result = self.run_cloud()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Certification ledger: PASS (18 required stages', result.stdout)
        # BUILD-FLOFI-AUTH-WALLETS-001 adds the auth-wallets profile (49 → 50).
        self.assertIn('50 browser profiles each exactly once', result.stdout)
        self.assertIn('Cloud certification: PASS', result.stdout)
        rows = [row for report in self.reports() for row in report['profiles']]
        self.assertEqual(len(rows), 50)
        self.assertTrue(all(row['status'] == 'PASS' for row in rows))
        order = [line for line in self.log.read_text().splitlines() if '--add-reporter junit' in line]
        self.assertIn('copilot-learning-memory.spec.ts', order[0])
        self.assertIn('release-composition-provenance.spec.ts', order[-1])
        self.assertLess(self.log.read_text().index('release-composition-provenance.spec.ts'), self.log.read_text().index('typecheck'))

    def test_multiple_browser_and_composition_fork_failures_are_all_exposed(self):
        result = self.run_cloud(FAKE_FAIL='copilot-learning-memory.spec.ts', FAKE_FAIL_2='interface-honesty.spec.ts',
                                FAKE_FAIL_3='approve-authorize-journeys.spec.ts',
                                FAKE_FAIL_4='packages/reference-compiler/test/composition.fork.test.ts', FAKE_STATUS='7')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('Certification ledger: FAIL', result.stdout)
        self.assertNotIn('Cloud certification: PASS', result.stdout)
        rows = {row['name']: row for report in self.reports() for row in report['profiles']}
        self.assertEqual(len(rows), 50)
        self.assertEqual([name for name, row in rows.items() if row['status'] == 'NOT_RUN'], [])
        for name in ['copilot-learning', 'default-product', 'approve-authorize-journeys']:
            self.assertEqual(rows[name]['status'], 'FAIL')
            self.assertEqual(rows[name]['exitCode'], 7)
            self.assertIn(f'browser profile {name}', result.stdout)
        self.assertEqual(rows['composition-provenance']['status'], 'PASS')
        for label in ['Critical browser regressions', 'Guarded browser suites', 'Composition fork and browser']:
            self.assertEqual(self.stages()[label]['outcome'], 'failure')
        for label in ['Typecheck', 'Lint', 'Schema drift', 'Unit and contract tests', 'PostgreSQL', 'Anvil and offline forks']:
            self.assertEqual(self.stages()[label]['outcome'], 'success')
        self.assertNotIn('--last-failed', self.log.read_text())

    def test_nonbrowser_failure_stays_failed_and_does_not_hide_later_suites(self):
        result = self.run_cloud(FAKE_FAIL='lint', FAKE_STATUS='9')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.stages()['Lint']['exit_code'], 9)
        self.assertEqual(self.stages()['PostgreSQL']['outcome'], 'success')
        self.assertIn('Certification ledger: FAIL', result.stdout)
        # Errexit must still apply inside each child stage, even though the
        # parent collects its exit status. A later successful command cannot mask lint.
        self.assertNotIn('exec eslint', self.log.read_text())

    def test_unit_failure_cannot_be_masked_by_later_unit_commands(self):
        result = self.run_cloud(FAKE_FAIL='apps/reference-dapp/src/server/workflow-visual-image.test.ts', FAKE_STATUS='5')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.stages()['Unit and contract tests']['exit_code'], 5)
        self.assertNotIn('vitest run packages apps/reference-dapp/src', self.log.read_text())
        self.assertEqual(self.stages()['PostgreSQL']['outcome'], 'success')

    def test_guard_failure_blocks_unit_stage_and_certification(self):
        result = self.run_cloud(FAKE_GUARD_STATUS='6')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.stages()['Unit and contract tests']['exit_code'], 6)
        self.assertNotIn('apps/reference-dapp/src/server/workflow-visual-image.test.ts', self.log.read_text())
        self.assertNotIn('vitest run packages apps/reference-dapp/src', self.log.read_text())
        self.assertEqual(self.stages()['PostgreSQL']['outcome'], 'success')
        self.assertIn('Certification ledger: FAIL', result.stdout)
        self.assertNotIn('Cloud certification: PASS', result.stdout)

    def test_required_regression_result_refusal_keeps_certification_failed(self):
        result = self.run_cloud(FAKE_GUARD_RESULTS_STATUS='8')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.stages()['Unit and contract tests']['exit_code'], 8)
        calls = self.log.read_text()
        self.assertIn('--reporter=default --reporter=json --outputFile=', calls)
        self.assertIn('agent_guard verify-results ', calls)
        self.assertNotIn('--filter @defi-workflow-engine/reference-linter', calls)
        self.assertEqual(self.stages()['PostgreSQL']['outcome'], 'success')
        self.assertIn('Certification ledger: FAIL', result.stdout)
        self.assertNotIn('Cloud certification: PASS', result.stdout)

    def test_postgres_result_refusal_blocks_ledger_without_changing_unit_result(self):
        # The guard's skipped/missing-case detection is tested separately. This
        # double proves that its refusal survives the PostgreSQL stage and fan-in.
        result = self.run_cloud(FAKE_GUARD_POSTGRES_RESULTS_STATUS='10')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.stages()['Unit and contract tests']['outcome'], 'success')
        self.assertEqual(self.stages()['PostgreSQL']['exit_code'], 10)
        calls = self.log.read_text()
        self.assertIn('test:postgres --reporter=default --reporter=json --outputFile=', calls)
        self.assertIn('agent_guard verify-results --stage postgres ', calls)
        self.assertIn('Certification ledger: FAIL', result.stdout)
        self.assertNotIn('Cloud certification: PASS', result.stdout)

    def test_missing_setup_still_reaches_ledger_and_cannot_pass(self):
        for path in self.metrics.glob('*.json'):
            if json.loads(path.read_text())['name'] == 'Production build':
                path.unlink()
        result = self.run_cloud()
        self.assertEqual(result.returncode, 1)
        self.assertIn('required stage never ran: Production build', result.stdout)
        self.assertEqual(len([row for report in self.reports() for row in report['profiles']]), 50)

    def test_composition_setup_and_fork_coverage_match_the_existing_pipeline(self):
        shared = (ROOT / '.circleci/scripts/ci-composition.sh').read_text()
        cloud = (ROOT / 'scripts/gcp-ci-composition.sh').read_text()
        start = shared.index('set -euo pipefail\n')
        fork = shared.index('pnpm exec vitest run packages/reference-compiler/test/composition.fork.test.ts')
        self.assertEqual(cloud[cloud.index('set -euo pipefail\n'):cloud.index('composition_status=0\n')], shared[start:fork])
        self.assertIn(shared[fork:].splitlines()[0] + ' || composition_status=$?', cloud)
        self.assertIn('node scripts/guarded-release-browser.mjs composition --collect-failures', cloud)
        self.assertIn('--no-file-parallelism --testTimeout=120000', cloud)

    def test_early_critical_order_keeps_setup_resource_and_coverage_constraints(self):
        full = (ROOT / 'scripts/gcp-ci-full.sh').read_text()
        commands = ['gcp-source-snapshot.py verify --initialize-git', 'bootstrap-ci.py --verify-dependencies',
                    'pnpm audit --audit-level low', 'ci-sbom.sh', 'pnpm build', 'bootstrap-anvil.py',
                    'bootstrap-playwright.py', 'bash scripts/gcp-ci-certify.sh']
        offsets = [full.index(command) for command in commands]
        self.assertEqual(offsets, sorted(offsets))
        certify = (ROOT / 'scripts/gcp-ci-certify.sh').read_text()
        self.assertLess(certify.index("run_stage 'Critical browser regressions'"), certify.index("run_stage 'Guarded browser suites'"))
        self.assertLess(certify.index("run_stage 'Guarded browser suites'"), certify.index("run_stage 'Unit and contract tests'"))
        self.assertIn('--maxWorkers=1', certify)
        self.assertIn('--maxWorkers=2', certify)
        self.assertIn('python3 scripts/agent_guard.py check', certify)
        self.assertIn('--reporter=default --reporter=json --outputFile="$RUNNER_TEMP/flofi-agent-unit.json"', certify)
        self.assertIn('python3 scripts/agent_guard.py verify-results "$RUNNER_TEMP/flofi-agent-unit.json"', certify)
        self.assertIn('pnpm test:postgres --reporter=default --reporter=json --outputFile="$RUNNER_TEMP/flofi-agent-postgres.json"', certify)
        self.assertIn('python3 scripts/agent_guard.py verify-results --stage postgres "$RUNNER_TEMP/flofi-agent-postgres.json"', certify)
        self.assertIn('python3 scripts/ci-observe.py verify', certify)
        config = (ROOT / 'cloudbuild.yaml').read_text()
        self.assertIn('machineType: E2_STANDARD_2', config)
        self.assertIn("timeout: '10800s'", config)
        self.assertNotIn('pool:', config)
        self.assertIn('flofi-ci-runner@celtic-volt-418819.iam.gserviceaccount.com', config)
        self.assertIn('postgres:18.6-bookworm@sha256:', config)
        self.assertIn("export TEST_DATABASE_URL='postgres://flofi@127.0.0.1:5432/postgres'", full)
        self.assertEqual(len(browser_plan()['product']) + len(browser_plan()['composition']), 50)


if __name__ == '__main__':
    unittest.main()
