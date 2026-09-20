import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DESKTOP_API_TOKEN_HEADER,
  hasValidDesktopApiToken,
} from '../src/lib/desktop-api-token.server.ts';

test('desktop API token fails closed when either side is absent or differs', () => {
  assert.equal(hasValidDesktopApiToken({}, ''), false);
  assert.equal(hasValidDesktopApiToken({}, 'expected'), false);
  assert.equal(hasValidDesktopApiToken({ [DESKTOP_API_TOKEN_HEADER]: 'wrong' }, 'expected'), false);
  assert.equal(hasValidDesktopApiToken({ [DESKTOP_API_TOKEN_HEADER]: 'expected-extra' }, 'expected'), false);
});

test('desktop API token accepts an exact match from Node and Web headers', () => {
  assert.equal(hasValidDesktopApiToken({ [DESKTOP_API_TOKEN_HEADER]: 'expected' }, 'expected'), true);
  assert.equal(hasValidDesktopApiToken(new Headers({ 'X-Magine-Desktop-Token': 'expected' }), 'expected'), true);
});

