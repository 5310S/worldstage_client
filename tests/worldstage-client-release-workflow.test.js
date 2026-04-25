#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function main() {
  const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'worldstage-client-desktop.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /ubuntu-latest/, 'Expected Linux desktop builds in the workflow.');
  assert.match(workflow, /windows-latest/, 'Expected Windows desktop builds in the workflow.');
  assert.match(workflow, /macos-latest/, 'Expected macOS desktop builds in the workflow.');
  assert.match(workflow, /workflow_dispatch:/, 'Expected the workflow to support manual release backfills.');
  assert.match(workflow, /publish_release:/, 'Expected manual release publishes to require an explicit opt-in input.');
  assert.match(workflow, /release_tag:/, 'Expected manual release publishes to accept a target release tag.');
  assert.doesNotMatch(workflow, /\$\{\{\s*inputs\./, 'Expected workflow expressions to use github.event.inputs so push events compile.');
  assert.doesNotMatch(workflow, /build:\n\s+if:.*matrix\./, 'Expected matrix filtering to stay off job-level if expressions.');
  assert.match(workflow, /github\.event\.inputs\.target == matrix\.target/, 'Expected manual target filtering to happen after matrix expansion.');
  assert.match(workflow, /contents:\s*write/, 'Expected release workflow permissions to allow publishing GitHub release assets.');
  assert.match(workflow, /npm ci/, 'Expected the workflow to install dependencies reproducibly.');
  assert.match(workflow, /Sync release package version/, 'Expected release builds to sync package versions from release tags before npm ci.');
  assert.match(workflow, /scripts\/worldstage-client-release-version\.js/, 'Expected the workflow to use the release version sync helper.');
  assert.match(workflow, /npm test/, 'Expected the workflow to run tests before packaging.');
  assert.match(workflow, /Install Linux packaging tools/, 'Expected Linux release builds to install RPM and Arch packaging tools.');
  assert.match(workflow, /sudo apt-get install -y rpm libarchive-tools/, 'Expected Linux release builds to install the package tools needed for rpm and pacman targets.');
  assert.match(workflow, /--linux --x64/, 'Expected Linux release builds to emit a stable x64 artifact.');
  assert.match(workflow, /--linux --arm64/, 'Expected Linux release builds to emit an ARM64 artifact.');
  assert.match(workflow, /--win --x64/, 'Expected Windows release builds to emit a stable x64 artifact.');
  assert.match(workflow, /--mac --universal/, 'Expected macOS release builds to emit a universal artifact.');
  assert.match(workflow, /publish_update_metadata:\s*true/, 'Expected the workflow to mark which builds may publish updater metadata.');
  assert.match(workflow, /publish_update_metadata:\s*false/, 'Expected Linux ARM64 builds to skip updater metadata publication.');
  assert.match(workflow, /worldstage-client-\$\{\{\s*matrix\.target\s*\}\}-\$\{\{\s*matrix\.arch\s*\}\}/, 'Expected build artifacts to be archived by target and architecture.');
  assert.match(workflow, /worldstage-client-\$\{\{\s*matrix\.target\s*\}\}-\$\{\{\s*matrix\.arch\s*\}\}-metadata/, 'Expected updater metadata artifacts to stay separate from packaged binaries.');
  assert.match(workflow, /npm run desktop:dist -- \$\{\{ matrix\.dist_args \}\}/, 'Expected the workflow to package through the desktop dist wrapper.');
  assert.match(workflow, /Verify release artifacts/, 'Expected release builds to verify artifacts before upload.');
  assert.match(workflow, /scripts\/verify-release-artifacts\.js \$\{\{ matrix\.target \}\} \$\{\{ matrix\.arch \}\} \$\{\{ matrix\.publish_update_metadata \}\}/, 'Expected artifact verification to use the matrix target, architecture, and metadata policy.');
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY:\s*'false'/, 'Expected the workflow to disable signing autodiscovery on CI by default.');
  assert.match(workflow, /APPLE_API_KEY/, 'Expected the workflow to support Apple API key notarization secrets.');
  assert.match(workflow, /APPLE_ID/, 'Expected the workflow to support Apple ID notarization secrets.');
  assert.match(workflow, /actions\/upload-artifact@v4/, 'Expected the workflow to upload packaged desktop artifacts.');
  assert.match(workflow, /actions\/download-artifact@v4/, 'Expected release uploads to run after downloading the packaged build artifacts.');
  assert.match(workflow, /gh release create/, 'Expected tag publishes to create the GitHub release when needed.');
  assert.match(workflow, /gh release upload/, 'Expected release assets to publish through a single serialized GitHub upload step.');
  assert.match(workflow, /merge-multiple:\s*true/, 'Expected release uploads to merge the per-platform build artifacts before publishing.');

  console.log('worldstage-client-release-workflow.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
