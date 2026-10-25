import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyActiveSunatTab, isSunatLoginUrl, isSunatSessionPageUrl } from './browser-context.js';

const menu = 'https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm';

test('standard and annual authentication stay on official credential endpoints without changing channel', () => {
  const base = 'https://api-seguridad.sunat.gob.pe/v1/clientessol/03590141-c69c-438c-a36a-8ee2a3ad9747/oauth2/';
  for (const suffix of ['login', 'loginMenuSol']) assert.equal(isSunatLoginUrl(base + suffix), true);
  for (const url of [base.replace('https:', 'http:')+'login', base.replace('api-seguridad.sunat.gob.pe', 'example.com')+'login', menu, base+'proceso-seguridad', 'https://api-seguridad.sunat.gob.pe.example.com/oauth2/login']) assert.equal(isSunatLoginUrl(url), false);
  assert.equal(isSunatSessionPageUrl('https://e-renta.sunat.gob.pe/loader/recaudaciontributaria/declaracionpago/formularios'), true);
  assert.equal(isSunatSessionPageUrl(base+'proceso-seguridad'), false);
});

test('an unchanged active SOL tab needs one chrome read and no tab selection', async () => {
  let reads = 0;
  let selections = 0;
  const result = await verifyActiveSunatTab({
    readAddress: async () => { reads++; return menu; },
    selectSunatTab: async () => { selections++; return true; },
  }, menu);
  assert.deepEqual(result, { address: menu, changed: false });
  assert.equal(reads, 1);
  assert.equal(selections, 0);
});

test('switching away and back invalidates cached page references even at the same URL', async () => {
  const addresses = ['https://chatgpt.com/', menu];
  let selections = 0;
  const result = await verifyActiveSunatTab({
    readAddress: async () => addresses.shift(),
    selectSunatTab: async () => { selections++; return true; },
  }, menu);
  assert.equal(result.changed, true);
  assert.equal(result.address, menu);
  assert.equal(selections, 1);
  assert.equal(addresses.length, 0);
});

test('top-level address changes invalidate context while iframe addresses are irrelevant', async () => {
  const driver = { readAddress: async () => menu, selectSunatTab: async () => { throw new Error('unexpected selection'); } };
  assert.equal((await verifyActiveSunatTab(driver, menu + '?session=synthetic-old')).changed, true);
  // A frame can navigate independently; only chrome is supplied to this check.
  assert.equal((await verifyActiveSunatTab(driver, menu)).changed, false);
});

test('a tab title alone cannot authorize a non-SUNAT or insecure address', async () => {
  for (const address of ['https://sunat.gob.pe.example.com/', 'http://e-menu.sunat.gob.pe/', undefined]) {
    await assert.rejects(verifyActiveSunatTab({ readAddress: async () => address, selectSunatTab: async () => true }), /HTTPS de SUNAT/);
  }
});

test('explicit navigation can start without a SOL tab but never ignores ambiguous tabs or UI failures', async () => {
  const driver = { readAddress: async () => 'https://example.com/', selectSunatTab: async () => false };
  await assert.rejects(verifyActiveSunatTab(driver), /pestaña SOL/);
  assert.equal((await verifyActiveSunatTab(driver, undefined, true)).changed, true);
  await assert.rejects(verifyActiveSunatTab({ ...driver, selectSunatTab: async () => { throw new Error('ambiguous_tab'); } }, undefined, true), /ambiguous_tab/);
  await assert.rejects(verifyActiveSunatTab({ ...driver, readAddress: async () => { throw new Error('native_failure'); } }, undefined, true), /native_failure/);
});
