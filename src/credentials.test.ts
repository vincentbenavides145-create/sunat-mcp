import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('Windows vault selects one account, distinguishes accounts and preserves API credentials on reimport', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sunat-vault-test-'));
  process.env.LOCALAPPDATA = directory;
  const vault = await import('./credentials.js');
  const first = { accountKey: 'Cuenta sintética A', mode: 'ruc' as const, document: '00000000000', username: 'TEST', password: 'synthetic-password-only', sireApi: { clientId: 'synthetic-client', clientSecret: 'synthetic-api-secret' } };
  try {
    assert.equal((await vault.getSunatCredentialVaultStatus()).credentialCount, 0);
    await vault.saveSunatAccountCredentials([first]);
    assert.equal((await vault.findSunatAccountCredential()).accountKey, first.accountKey);
    const encrypted = await readFile(path.join(directory, 'SUNAT MCP', 'credentials', 'accounts.dpapi.json'), 'utf8');
    assert.doesNotMatch(encrypted, /synthetic-password|synthetic-api|Cuenta sintética/);
    await vault.saveSunatAccountCredentials([{ ...first, sireApi: undefined }]);
    assert.deepEqual((await vault.findSunatAccountCredential(first.accountKey)).sireApi, first.sireApi);
    await vault.saveSunatAccountCredentials([{ accountKey: 'Cuenta sintética B', mode: 'dni', document: '00000000', password: 'another-synthetic-password' }]);
    assert.equal((await vault.getSunatCredentialVaultStatus()).credentialCount, 2);
    await assert.rejects(vault.findSunatAccountCredential(), /varias/);
    assert.equal((await vault.findSunatAccountCredential('cuenta sintetica a')).mode, 'ruc');
    assert.equal((await vault.findSunatAccountCredential('Cuenta sintética B')).mode, 'dni');
    await assert.rejects(vault.findSunatAccountCredential('missing'), /coincidencia exacta/);
    await assert.rejects(vault.saveSunatAccountCredentials([first, first]), /duplicados/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
