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
  assert.match(workflow, /contents:\s*write/, 'Expected release workflow permissions to allow publishing GitHub release assets.');
  assert.match(workflow, /npm ci/, 'Expected the workflow to install dependencies reproducibly.');
  assert.match(workflow, /npm test/, 'Expected the workflow to run tests before packaging.');
  assert.match(workflow, /sudo apt-get install -y rpm libarchive-tools/, 'Expected Linux workflow builds to install the rpm and bsdtar tooling required by the Linux packaging targets.');
  assert.match(workflow, /--linux --x64/, 'Expected Linux release builds to emit a stable x64 artifact.');
  assert.match(workflow, /--win --x64/, 'Expected Windows release builds to emit a stable x64 artifact.');
  assert.match(workflow, /--mac --x64/, 'Expected macOS release builds to emit a stable x64 artifact.');
  assert.match(workflow, /npm run desktop:dist -- \$\{\{ matrix\.dist_args \}\}/, 'Expected the workflow to package through the desktop dist wrapper.');
  assert.match(workflow, /WORLDSTAGE_CLIENT_PUBLISH:\s*never/, 'Expected platform builds to package without racing on GitHub release creation.');
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY:\s*'false'/, 'Expected the workflow to disable signing autodiscovery on CI by default.');
  assert.match(workflow, /actions\/upload-artifact@v4/, 'Expected the workflow to upload packaged desktop artifacts.');
  assert.match(workflow, /actions\/download-artifact@v4/, 'Expected tagged builds to collect packaged artifacts before publishing the release.');
  assert.match(workflow, /needs:\s*build/, 'Expected release publishing to wait until every OS package job finishes.');
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/, 'Expected tagged builds to authenticate GitHub release publishing.');
  assert.match(workflow, /gh release create/, 'Expected the release workflow to create the GitHub release when the tag is first published.');
  assert.match(workflow, /gh release upload/, 'Expected the release workflow to upload packaged artifacts after all OS builds finish.');

  console.log('worldstage-client-release-workflow.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
