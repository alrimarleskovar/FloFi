#!/usr/bin/env bash
# Exact CircleCI backup copy of the approved GitHub Actions certification command.
# Keep aligned with .github/workflows/contracts.yml; fail closed on any error.
set -euo pipefail
source scripts/ci-observe.sh 'SBOM'
pnpm sbom --sbom-format cyclonedx --sbom-spec-version 1.6 --lockfile-only --out "$RUNNER_TEMP/build-003a.cdx.json"
python3 - <<'PYCODE'
import hashlib, json, os, pathlib, sys
path=pathlib.Path(os.environ['RUNNER_TEMP'])/'build-003a.cdx.json'
try:
    document=json.loads(path.read_text())
    if document.get('bomFormat')!='CycloneDX' or document.get('specVersion')!='1.6':
        raise SystemExit('Unexpected SBOM format or version')
    evidence=json.loads((path.parent/'build-002-dependencies.json').read_text())
    expected={(r['name'],r['version']):r['license'] for r in evidence}
    if len(evidence)!=295 or len(expected)!=295:
        raise SystemExit('Dependency evidence count changed')
    components=document.get('components')
    if not isinstance(components,list):
        raise SystemExit('SBOM components missing')
    seen=set()
    for component in components:
        name=(component.get('group')+'/' if component.get('group') else '')+component.get('name','')
        identity=(name,component.get('version'))
        if identity not in expected or identity in seen:
            raise SystemExit('Unreviewed or duplicate SBOM component: '+repr(identity))
        seen.add(identity)
        expression=expected[identity]
        if ' AND ' in expression:
            component['licenses']=[{'expression':expression}]
        else:
            component['licenses']=[{'license':{'id':expression}}]
    if seen!=set(expected):
        raise SystemExit('SBOM omits reviewed lock components')
    root_component=document.get('metadata',{}).get('component',{})
    if (root_component.get('name')!='defi-workflow-engine' or
            root_component.get('version')!='0.1.0' or
            root_component.get('licenses')!=[{'license':{'id':'Apache-2.0'}}]):
        raise SystemExit('SBOM root identity or license differs')
    workspace={
        'package.json':('defi-workflow-engine','Apache-2.0'),
        'packages/workflow-contracts/package.json':('@defi-workflow-engine/workflow-contracts','Apache-2.0'),
        'packages/action-registry/package.json':('@defi-workflow-engine/action-registry','Apache-2.0'),
        'packages/reference-linter/package.json':('@defi-workflow-engine/reference-linter','AGPL-3.0-only'),
        'packages/reference-compiler/package.json':('@defi-workflow-engine/reference-compiler','AGPL-3.0-only'),
        'packages/reference-executor/package.json':('@defi-workflow-engine/reference-executor','AGPL-3.0-only'),
        'packages/reference-reconciler/package.json':('@defi-workflow-engine/reference-reconciler','AGPL-3.0-only'),
        'packages/cloud-runtime/package.json':('@defi-workflow-engine/cloud-runtime','AGPL-3.0-only'),
        # BUILD-DEVELOPER-001: the thin Developer API client (zero dependencies, empty lock importer).
        'packages/developer-sdk/package.json':('@defi-workflow-engine/developer-sdk','Apache-2.0'),
        'apps/reference-dapp/package.json':('@defi-workflow-engine/reference-dapp','AGPL-3.0-only'),
    }
    for manifest_path,(name,license_id) in workspace.items():
        manifest=json.loads(pathlib.Path(manifest_path).read_text())
        expected_version='0.3.0' if manifest_path=='packages/workflow-contracts/package.json' else '0.1.0'
        if (manifest.get('name'),manifest.get('version'),manifest.get('private'),manifest.get('license'))!=(name,expected_version,True,license_id):
            raise SystemExit('Workspace manifest inventory differs: '+manifest_path)
    lock=pathlib.Path('pnpm-lock.yaml').read_text()
    importer_section=lock.split('\nimporters:\n',1)[1].split('\npackages:\n',1)[0]
    import re
    # An importer without dependencies is written on one line (`  path: {}`).
    importer_paths=set(re.findall(r'(?m)^  (\S[^\n:]*):(?: \{\})?$',importer_section))
    if importer_paths!={'.','packages/workflow-contracts','packages/action-registry','packages/reference-linter','packages/reference-compiler','packages/reference-executor','packages/reference-reconciler','packages/cloud-runtime','packages/developer-sdk','apps/reference-dapp'}:
        raise SystemExit('Workspace lock importer inventory differs')
    component_refs={component['bom-ref'] for component in components}
    if len(component_refs)!=295 or root_component.get('bom-ref') in component_refs:
        raise SystemExit('SBOM component references differ')
    dependencies=document.get('dependencies')
    if not isinstance(dependencies,list):
        raise SystemExit('SBOM dependency graph missing')
    graph_refs=[entry.get('ref') for entry in dependencies]
    all_refs=component_refs|{root_component['bom-ref']}
    if len(graph_refs)!=len(set(graph_refs)) or set(graph_refs)!=all_refs:
        raise SystemExit('SBOM dependency reference inventory differs')
    for entry in dependencies:
        targets=entry.get('dependsOn',[])
        if not isinstance(targets,list) or len(targets)!=len(set(targets)) or set(targets)-all_refs:
            raise SystemExit('Invalid SBOM dependency references')
    # pnpm 11.22.0 omits workspace components; the exact ten local
    # manifests and lock importers above are checked independently.
    if re.search(r'(?m)^  packages/developer-sdk: \{\}$',importer_section) is None:
        raise SystemExit('Developer SDK must have no dependencies')

    reviewed={
        '@img/sharp-libvips-darwin-arm64','@img/sharp-libvips-darwin-x64',
        '@img/sharp-libvips-linux-arm','@img/sharp-libvips-linux-arm64',
        '@img/sharp-libvips-linux-ppc64','@img/sharp-libvips-linux-riscv64',
        '@img/sharp-libvips-linux-s390x','@img/sharp-libvips-linux-x64',
        '@img/sharp-libvips-linuxmusl-arm64','@img/sharp-libvips-linuxmusl-x64',
        '@img/sharp-wasm32','@img/sharp-win32-arm64',
        '@img/sharp-win32-ia32','@img/sharp-win32-x64',
        'caniuse-lite','tslib'}
    if {name for name,version in seen if name in reviewed}!=reviewed:
        raise SystemExit('Reviewed exception package set changed in SBOM')
    raw=(json.dumps(document,indent=2,sort_keys=True)+'\n').encode()
    path.write_bytes(raw)
    checked=json.loads(path.read_text())
    for component in checked['components']:
        name=(component.get('group')+'/' if component.get('group') else '')+component['name']
        license_value=component['licenses'][0]
        actual=license_value.get('expression',license_value.get('license',{}).get('id'))
        if actual!=expected[(name,component['version'])]:
            raise SystemExit('SBOM license expression changed: '+name)
    message='Ephemeral CycloneDX 1.6 SBOM: 295 exact registry components, zero workspace components (ten exact manifests and importers checked separately), 16 reviewed exceptions with actual licenses, SHA-256 '+hashlib.sha256(raw).hexdigest()
    print(message)
    with open(os.environ['GITHUB_STEP_SUMMARY'],'a',encoding='utf-8') as summary:
        summary.write(message+'\n')
finally:
    path.unlink(missing_ok=True)
PYCODE
