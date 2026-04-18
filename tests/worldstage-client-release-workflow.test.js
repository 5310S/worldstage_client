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
  assert.match(workflow, /WORLDSTAGE_CLIENT_PUBLISH:\s*always/, 'Expected tagged builds to switch the desktop dist wrapper into GitHub publishing mode.');
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/, 'Expected tagged builds to authenticate GitHub release publishing.');
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY:\s*'false'/, 'Expected the workflow to disable signing autodiscovery on CI by default.');
  assert.match(workflow, /actions\/upload-artifact@v4/, 'Expected the workflow to upload packaged desktop artifacts.');

  console.log('worldstage-client-release-workflow.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
