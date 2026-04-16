#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  buildWorldStageSiteUrl,
  isWorldStageSiteUrlAllowed,
  snapshotWorldStageSiteState
} = require('../lib/worldstage-site-window');

assert.equal(
  buildWorldStageSiteUrl('https://5310s.com'),
  'https://5310s.com/worldstage'
);

assert.equal(
  buildWorldStageSiteUrl('5310s.com/worldstage?foo=bar', '/worldstage-login?next=%2Fworldstage'),
  'https://5310s.com/worldstage-login?next=%2Fworldstage'
);

assert.equal(
  isWorldStageSiteUrlAllowed('https://5310s.com', 'https://5310s.com/worldstage-login?next=%2Fworldstage'),
  true
);

assert.equal(
  isWorldStageSiteUrlAllowed('https://5310s.com', 'https://example.com/worldstage'),
  false
);

assert.deepEqual(
  snapshotWorldStageSiteState({
    open: 1,
    visible: 0,
    url: 'https://5310s.com/worldstage',
    title: 'WorldStage',
    lastOpenedAtIso: '2026-04-16T13:00:00.000Z',
    lastNavigationAtIso: '2026-04-16T13:01:00.000Z'
  }),
  {
    open: true,
    visible: false,
    url: 'https://5310s.com/worldstage',
    title: 'WorldStage',
    lastOpenedAtIso: '2026-04-16T13:00:00.000Z',
    lastNavigationAtIso: '2026-04-16T13:01:00.000Z',
    lastError: ''
  }
);

console.log('worldstage-site-window.test.js: ok');
