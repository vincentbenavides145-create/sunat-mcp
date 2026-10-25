import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertAccountRuc, bindAccount, rucFromHeader } from './account-session.js';
import { randomUUID } from 'node:crypto';

test('cached client names cannot replace an exact, fresh RUC match', () => {
  assert.doesNotThrow(() => assertAccountRuc('00000000001', '00000000001'));
  for (const actual of [undefined, '', '00000000', '00000000002']) assert.throws(() => assertAccountRuc('00000000001', actual));
  assert.equal(rucFromHeader('Bienvenido Cliente RUC: 00000000001'), '00000000001');
  assert.equal(rucFromHeader('RUC: 00000000001 RUC: 00000000002'), undefined);
});

test('DNI access requires an explicit vault mapping; identity is never guessed from a document number', () => {
  const account = { id: randomUUID(), accountKey: 'synthetic-client', mode: 'dni' as const, document: '00000000', password: 'synthetic-only' };
  assert.throws(() => bindAccount(account), /RUC de sesión/);
  assert.equal(bindAccount({ ...account, sessionRuc: '00000000001' }).ruc, '00000000001');
});
