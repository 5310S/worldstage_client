#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  PAIRING_PROTOCOL,
  buildPairingClaimUrl,
  claimPairingLink,
  extractPairingLinkFromArgv,
  isPairingLink,
  pairingConfigUpdate,
  parsePairingLink
} = require('../lib/pairing-link');

(async () => {
  assert.equal(isPairingLink('worldstage://pair?deviceToken=wsct_demo'), true);
  assert.equal(isPairingLink('https://5310s.com/worldstage/client/connect?deviceToken=wsct_demo'), true);
  assert.equal(isPairingLink('https://5310s.com/worldstage?deviceToken=wsct_demo'), false);

  const custom = parsePairingLink(
    'worldstage://pair?siteOrigin=https%3A%2F%2F5310s.com&deviceToken=wsct_demo&accountToken=wsa_demo&deviceName=Desk%20Seeder&launchOnLogin=1&backgroundOnClose=true&autoStartAgent=yes'
  );
  assert.equal(custom.sourceProtocol, PAIRING_PROTOCOL);
  assert.equal(custom.siteOrigin, 'https://5310s.com');
  assert.equal(custom.deviceToken, 'wsct_demo');
  assert.equal(custom.accountToken, 'wsa_demo');
  assert.equal(custom.deviceName, 'Desk Seeder');
  assert.equal(custom.launchOnLogin, true);
  assert.equal(custom.backgroundOnClose, true);
  assert.equal(custom.autoStartAgent, true);

  const https = parsePairingLink(
    'https://5310s.com/worldstage/client/connect?pairingCode=wscp_demo&deviceName=Living%20Room',
    { defaultSiteOrigin: 'https://fallback.example' }
  );
  assert.equal(https.siteOrigin, 'https://5310s.com');
  assert.equal(https.pairingCode, 'wscp_demo');
  assert.equal(https.deviceName, 'Living Room');

  const configUpdate = pairingConfigUpdate(custom);
  assert.deepEqual(configUpdate, {
    siteOrigin: 'https://5310s.com',
    deviceToken: 'wsct_demo',
    accountToken: 'wsa_demo',
    deviceName: 'Desk Seeder',
    backgroundOnClose: true,
    launchOnLogin: true,
    autoStartAgent: true
  });

  assert.equal(
    extractPairingLinkFromArgv(['--flag', 'worldstage://pair?deviceToken=wsct_demo', '--other']),
    'worldstage://pair?deviceToken=wsct_demo'
  );

  assert.equal(
    buildPairingClaimUrl('https://5310s.com'),
    'https://5310s.com/api/worldstage/client/pair/claim'
  );

  const claimed = await claimPairingLink(
    parsePairingLink('worldstage://pair?siteOrigin=https%3A%2F%2F5310s.com&pairingCode=wscp_demo'),
    {
      fetchImpl: async (requestUrl, options) => {
        assert.equal(requestUrl, 'https://5310s.com/api/worldstage/client/pair/claim');
        assert.equal(options.method, 'POST');
        assert.equal(JSON.parse(options.body).pairingCode, 'wscp_demo');
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ok: true,
              siteOrigin: 'https://5310s.com',
              deviceId: 'wscd_demo',
              deviceToken: 'wsct_demo',
              accountToken: 'wsa_demo',
              device: {
                id: 'wscd_demo',
                name: 'Desk Seeder'
              }
            };
          }
        };
      }
    }
  );
  assert.deepEqual(claimed, {
    siteOrigin: 'https://5310s.com',
    deviceId: 'wscd_demo',
    deviceToken: 'wsct_demo',
    accountToken: 'wsa_demo',
    deviceName: 'Desk Seeder'
  });

  assert.throws(() => parsePairingLink(''), /pairing_link_required/);
  assert.throws(() => parsePairingLink('not a url'), /invalid_pairing_link/);
  assert.throws(() => parsePairingLink('https://5310s.com/worldstage?deviceToken=wsct_demo'), /unsupported_pairing_link/);

  console.log('pairing-link.test.js: ok');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
