#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  authenticateWorldStageAccount,
  buildAuthEndpointCandidates,
  normalizeAuthIdentifier
} = require('../lib/worldstage-auth');

async function main() {
  assert.equal(normalizeAuthIdentifier('  @keios  '), '@keios');
  assert.deepEqual(
    buildAuthEndpointCandidates('https://5310s.com', 'login'),
    [
      'https://5310s.com/api/worldstage/auth/login',
      'https://5310s.com/api/worldstage/accounts/login'
    ]
  );
  assert.deepEqual(
    buildAuthEndpointCandidates('https://5310s.com', 'register'),
    [
      'https://5310s.com/api/worldstage/auth/register',
      'https://5310s.com/api/worldstage/accounts'
    ]
  );

  const loginCalls = [];
  const loginResult = await authenticateWorldStageAccount({
    mode: 'login',
    siteOrigin: 'https://5310s.com',
    identifier: 'keios',
    password: 'supersecurepass',
    fetchImpl: async (requestUrl, options) => {
      loginCalls.push({ requestUrl, options });
      if (requestUrl.endsWith('/api/worldstage/auth/login')) {
        return {
          ok: false,
          status: 404,
          async json() {
            return { error: 'not_found' };
          }
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            account: {
              id: 'acct-1',
              handle: '@keios'
            },
            authToken: 'ws-auth-123'
          };
        }
      };
    }
  });
  assert.equal(loginCalls.length, 2);
  assert.equal(loginResult.authToken, 'ws-auth-123');
  assert.equal(loginResult.account.handle, '@keios');

  const registerResult = await authenticateWorldStageAccount({
    mode: 'register',
    siteOrigin: 'https://5310s.com',
    identifier: 'keios@example.com',
    password: 'supersecurepass',
    passwordConfirm: 'supersecurepass',
    fetchImpl: async (requestUrl) => {
      assert.equal(requestUrl, 'https://5310s.com/api/worldstage/auth/register');
      return {
        ok: true,
        status: 201,
        async json() {
          return {
            ok: true,
            account: {
              id: 'acct-2'
            },
            authToken: 'ws-auth-456'
          };
        }
      };
    }
  });
  assert.equal(registerResult.authToken, 'ws-auth-456');

  await assert.rejects(
    () => authenticateWorldStageAccount({
      mode: 'register',
      siteOrigin: 'https://5310s.com',
      identifier: 'keios@example.com',
      password: 'short',
      passwordConfirm: 'short'
    }),
    /password_too_short/
  );

  await assert.rejects(
    () => authenticateWorldStageAccount({
      mode: 'register',
      siteOrigin: 'https://5310s.com',
      identifier: 'keios@example.com',
      password: 'supersecurepass',
      passwordConfirm: 'different'
    }),
    /password_confirmation_mismatch/
  );

  console.log('worldstage-auth.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
