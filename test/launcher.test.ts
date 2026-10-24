import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkNodeVersion } from '../bin/node-version.mjs';

describe('launcher', () => {
  test('rejects_old_node_with_clear_message', () => {
    assert.deepEqual(checkNodeVersion('v20.11.0'), { ok: false, message: 'Maester 需要 Node 22.18 以上（目前 v20.11.0）' });
    assert.deepEqual(checkNodeVersion('v22.17.9'), { ok: false, message: 'Maester 需要 Node 22.18 以上（目前 v22.17.9）' });
  });

  test('accepts_supported_node', () => {
    assert.deepEqual(checkNodeVersion('v22.18.0'), { ok: true });
    assert.deepEqual(checkNodeVersion('v24.1.0'), { ok: true });
  });
});
