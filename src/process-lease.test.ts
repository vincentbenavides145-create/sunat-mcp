import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProcessLease } from './process-lease.js';
import { operatorDirectory } from './operator-storage.js';

test('separate processes cannot own one Brave session; dead owners recover without a heartbeat', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sunat-lock-'));
  let firstAlive = true;
  const one = new ProcessLease('brave', dir, 101, (pid) => pid === 101 ? firstAlive : true);
  const two = new ProcessLease('brave', dir, 202, (pid) => pid === 101 ? firstAlive : true);
  const three = new ProcessLease('brave', dir, 303, () => true);
  try {
    one.acquire(); one.acquire();
    assert.throws(() => two.acquire(), /Otro proceso/);
    firstAlive = false;
    two.acquire();
    one.release(); // Cannot release the successor's lease.
    assert.throws(() => three.acquire(), /Otro proceso/);
    two.release(); three.acquire();
  } finally { one.release(); two.release(); three.release(); await rm(dir, { recursive: true, force: true }); }
});

test('operator namespaces are validated and default storage remains backward compatible', () => {
  const previous = process.env.SUNAT_OPERATOR_ID;
  try {
    process.env.SUNAT_OPERATOR_ID = 'default'; const base = operatorDirectory();
    process.env.SUNAT_OPERATOR_ID = 'operator-a'; assert.equal(operatorDirectory(), path.join(base, 'operators', 'operator-a'));
    for (const name of ['../other', 'C:\\other', 'CON', '', 'a/b']) { process.env.SUNAT_OPERATOR_ID = name; assert.throws(operatorDirectory); }
  } finally { if (previous === undefined) delete process.env.SUNAT_OPERATOR_ID; else process.env.SUNAT_OPERATOR_ID = previous; }
});
