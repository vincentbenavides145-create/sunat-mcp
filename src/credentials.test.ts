import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

test('Windows vault selects one account, distinguishes accounts and preserves API credentials on reimport', { skip: process.platform !== 'win32', timeout: 180_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sunat-vault-test-'));
  process.env.LOCALAPPDATA = directory;
  const vault = await import('./credentials.js');
  const first = { accountKey: 'Cuenta sintética A', mode: 'ruc' as const, document: '00000000000', username: 'TEST', password: 'synthetic-password-only', sireApi: { clientId: 'synthetic-client', clientSecret: 'synthetic-api-secret' } };
  try {
    assert.equal((await vault.getSunatCredentialVaultStatus()).credentialCount, 0);
    // A pre-upgrade SecureString vault is read and migrated without changing the account.
    const legacy = await new Promise<string>((resolve, reject) => {
      const script = '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false); $plain = [Console]::In.ReadToEnd(); ConvertFrom-SecureString (ConvertTo-SecureString -String $plain -AsPlainText -Force)';
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 60_000, stdio: ['pipe', 'pipe', 'ignore'], env: {
        SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA,
        TEMP: process.env.TEMP, TMP: process.env.TMP, Path: process.env.Path ?? process.env.PATH,
      } });
      let output = ''; child.stdout.on('data', (chunk) => { output += chunk; });
      child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error('Synthetic legacy vault failed')));
      child.stdin.end(JSON.stringify({ version: 1, accounts: [first] }));
    });
    const vaultFolder = path.join(directory, 'SUNAT MCP', 'credentials');
    await mkdir(vaultFolder, { recursive: true });
    await writeFile(path.join(vaultFolder, 'accounts.dpapi.json'), JSON.stringify({ version: 1, encrypted: legacy }));
    assert.equal((await vault.findSunatAccountCredential()).accountKey, first.accountKey);
    assert.equal(JSON.parse(await readFile(path.join(vaultFolder, 'accounts.dpapi.json'), 'utf8')).encoding, 'utf8-dpapi');
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
    const before = await vault.findSunatAccountCredential(first.accountKey);
    await vault.saveSunatAccountCredentials([{ ...first, accountKey: 'Alias de la misma cuenta', username: 'OTHER' }]);
    const alias = await vault.findSunatAccountCredential('Alias de la misma cuenta');
    assert.notEqual(alias.id, before.id);
    assert.equal(alias.taxpayerId, before.taxpayerId);
    await vault.saveSunatAccountCredentials([{ ...first, password: 'changed-synthetic-password', sireApi: undefined }]);
    assert.equal((await vault.findSunatAccountCredential(first.accountKey)).id, before.id, 'credential rotation keeps logical work IDs');
    const operational = await vault.getOperationalVault();
    assert.equal(operational.key.length, 32);
    assert.doesNotMatch(await readFile(path.join(directory, 'SUNAT MCP', 'credentials', 'accounts.dpapi.json'), 'utf8'), new RegExp(operational.key.toString('hex')));
    await vault.saveSunatAccountCredentials([{ ...first, document: '00000000003', sireApi: undefined }]);
    const replaced = await vault.findSunatAccountCredential(first.accountKey);
    assert.notEqual(replaced.id, before.id);
    assert.equal(replaced.sireApi, undefined, 'credentials of another taxpayer cannot carry over');
    const many = Array.from({ length: 501 }, (_, i) => ({ accountKey: `Synthetic bulk ${i}`, mode: 'ruc' as const, document: String(i + 1000).padStart(11, '0'), username: 'TEST', password: 'synthetic-bulk-password' }));
    await vault.saveSunatAccountCredentials(many);
    assert.ok((await vault.getSunatCredentialVaultStatus()).credentialCount > 500, 'capacity is bounded by the protected payload size, not an arbitrary account count');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
