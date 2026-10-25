import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkStore } from './work-store.js';

async function fixture(run: (store: WorkStore, directory: string, key: Buffer) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sunat-jobs-'));
  const key = Buffer.alloc(32, 7);
  const store = new WorkStore(key, directory);
  try { await run(store, directory, key); }
  finally { try { store.close(); } catch {} await rm(directory, { recursive: true, force: true }); }
}

test('a thousand jobs for many clients paginate, deduplicate and persist without fiscal data', async () => fixture(async (store, directory, key) => {
  const entries = Array.from({ length: 1000 }, (_, index) => ({ accountId: randomUUID(), procedureId: 'declara-facil-621', operation: 'presentacion' as const, idempotencyKey: `private-business-intent-${index}` }));
  const batch = await store.createMany(entries);
  assert.equal(batch.length, 1000);
  assert.ok(batch.every((result) => !result.existing));
  const repeat = await store.createMany(entries);
  assert.ok(repeat.every((result, index) => result.existing && result.job.id === batch[index].job.id));
  const ids = new Set<string>(); let after: string | undefined;
  do {
    const page = store.list(after, 37); after = page.next;
    for (const job of page.jobs) { assert.equal(ids.has(job.id), false); ids.add(job.id); }
  } while (after);
  assert.equal(ids.size, 1000);
  assert.equal(store.list('', 50, entries[0].accountId).jobs.length, 1);
  store.close();
  for (const file of await readdir(directory)) assert.equal((await readFile(path.join(directory, file))).includes(Buffer.from('private-business-intent')), false);
  const reopened = new WorkStore(key, directory);
  try { assert.equal(reopened.get(batch[999].job.id).status, 'queued'); } finally { reopened.close(); }
}));

test('batch creation validates every workflow before writing and aliases of one taxpayer share idempotency', async () => fixture(async (store) => {
  const accountId = randomUUID(); const taxpayerId = randomUUID();
  const first = await store.create(accountId, 'rhe-emision', 'emision', 'same-operation', taxpayerId);
  const alias = await store.create(randomUUID(), 'rhe-emision', 'emision', 'same-operation', taxpayerId);
  assert.equal(alias.existing, true); assert.equal(alias.job.id, first.job.id);
  await assert.rejects(store.createMany([
    { accountId, procedureId: 'declara-facil-621', operation: 'presentacion', idempotencyKey: 'valid' },
    { accountId, procedureId: 'ficha-ruc', operation: 'pago', idempotencyKey: 'invalid' },
  ]), /finalidad/);
  assert.equal(store.list().jobs.length, 1);
}));

test('submission is durably fenced before input and cannot be blindly repeated after an exception', async () => fixture(async (store) => {
  const { job } = await store.create(randomUUID(), 'rhe-emision', 'emision', 'one');
  store.activate(job.id); store.checkpoint(job.id, 3); store.awaitApproval(job.id);
  let sends = 0;
  await assert.rejects(store.submit(job.id, 'baseline', async () => {
    sends++; assert.equal(store.get(job.id).status, 'submitting');
    throw new Error('input result unknown');
  }), /unknown/);
  assert.equal(store.get(job.id).status, 'uncertain');
  await assert.rejects(store.submit(job.id, 'baseline', async () => { sends++; return { value: true, signature: 'new', evidence: 'issue-receipt' }; }));
  assert.throws(() => store.activate(job.id), /conciliación/);
  assert.throws(() => store.pause(job.id), /conciliación/);
  assert.throws(() => store.cancel(job.id), /conciliación/);
  assert.equal(sends, 1);
  store.reconcile(job.id, 'not_performed');
  assert.equal(store.get(job.id).status, 'paused');
  store.activate(job.id); store.awaitApproval(job.id);
  const result = await store.submit(job.id, 'baseline', async () => ({ value: 'done', signature: 'new', evidence: 'issue-receipt' }));
  assert.equal(result, 'done'); assert.equal(store.get(job.id).status, 'completed');
  assert.equal(store.get(job.id).attempts, 2);
  assert.throws(() => store.activate(job.id), /terminó/);
}));

test('a restart pauses preparation, makes an in-flight submission uncertain and preserves committed results', async () => fixture(async (store, directory, key) => {
  const account = randomUUID();
  const first = (await store.create(account, 'declara-facil-621', 'presentacion', 'one')).job;
  store.activate(first.id); store.checkpoint(first.id, 5); store.awaitApproval(first.id); store.beginSubmission(first.id, 'baseline');
  store.close();
  const second = new WorkStore(key, directory);
  try {
    second.recover();
    assert.equal(second.get(first.id).status, 'uncertain'); assert.equal(second.get(first.id).steps, 5);
    assert.throws(() => second.activate(first.id));
    second.reconcile(first.id, 'completed');
    const other = (await second.create(account, 'declara-facil-621', 'presentacion', 'two')).job;
    second.activate(other.id); second.awaitApproval(other.id);
    const third = new WorkStore(key, directory);
    try { third.recover(); assert.equal(third.get(other.id).status, 'paused'); assert.equal(third.get(first.id).status, 'completed'); }
    finally { third.close(); }
  } finally { second.close(); }
}));

test('one active work owns the browser and old or unconfirmed result pages cannot complete a tax job', async () => fixture(async (store) => {
  const one = (await store.create(randomUUID(), 'rhe-emision', 'emision', 'one')).job;
  const two = (await store.create(randomUUID(), 'rhe-emision', 'emision', 'two')).job;
  store.activate(one.id);
  assert.throws(() => store.activate(two.id), /otro trabajo activo/);
  store.awaitApproval(one.id);
  await store.submit(one.id, 'same', async () => ({ value: true, signature: 'same', evidence: 'issue-receipt' }));
  assert.equal(store.get(one.id).status, 'uncertain');
  assert.throws(() => store.closeConsultation(one.id));
  store.reconcile(one.id, 'completed');
  store.activate(two.id); store.awaitApproval(two.id);
  await store.submit(two.id, 'before', async () => ({ value: true, signature: 'changed' }));
  assert.equal(store.get(two.id).status, 'uncertain');
}));

test('replacing the vault key cannot silently start a second idempotency history', async () => fixture(async (store, directory) => {
  await store.create(randomUUID(), 'rhe-emision', 'emision', 'stable');
  assert.throws(() => store.assertKey(Buffer.alloc(32, 8)), /bóveda/);
  assert.throws(() => new WorkStore(Buffer.alloc(32, 8), directory), /bóveda/);
  assert.equal(store.list().jobs.length, 1);
}));

test('another intent key or taxpayer alias cannot bypass an uncertain submission of the same phase', async () => fixture(async (store) => {
  const taxpayer = randomUUID();
  const first = (await store.create(randomUUID(), 'rhe-emision', 'emision', 'first', taxpayer)).job;
  store.activate(first.id); store.awaitApproval(first.id);
  await store.submit(first.id, 'old', async () => ({ value: true, signature: 'new' }));
  const alias = (await store.create(randomUUID(), 'rhe-emision', 'emision', 'different-key', taxpayer)).job;
  assert.throws(() => store.activate(alias.id), /envío incierto/);
  assert.equal(store.get(alias.id).status, 'queued');
  store.reconcile(first.id, 'completed');
  assert.equal(store.activate(alias.id).status, 'preparing');
}));
