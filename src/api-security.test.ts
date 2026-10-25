import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCpe } from './sunat-api.js';
import { checkSireApiAccess } from './sire-api.js';

test('CPE token and data requests reject redirects rather than forwarding credentials or fiscal data', async (context) => {
  const urls: URL[] = [];
  context.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.equal(init.redirect, 'error');
    const url = new URL(input);
    urls.push(url);
    return Response.json(url.hostname === 'api-seguridad.sunat.gob.pe' ? { access_token: 'synthetic-token', expires_in: 0 } : { success: true });
  });
  const result = await validateCpe({ ruc: '00000000001', clientId: 'synthetic-client', clientSecret: 'synthetic-secret', timeoutMs: 1000 }, { issuerRuc: '00000000002', documentType: '01', series: 'TEST', number: 1, issueDate: '01/01/2000' });
  assert.equal(result.success, true);
  assert.deepEqual(urls.map((url) => url.hostname), ['api-seguridad.sunat.gob.pe', 'api.sunat.gob.pe']);
  assert.ok(urls.every((url) => url.protocol === 'https:'));
});

test('SIRE credential checks reject redirects and expose no raw network failure details', async (context) => {
  context.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.equal(new URL(input).hostname, 'api-seguridad.sunat.gob.pe');
    assert.equal(init.redirect, 'error');
    throw new TypeError('synthetic private network detail');
  });
  const result = await checkSireApiAccess({ accountKey: 'Synthetic account', mode: 'ruc', document: '00000000001', username: 'TEST', password: 'synthetic-password', sireApi: { clientId: 'synthetic-client', clientSecret: 'synthetic-secret' } });
  assert.equal(result.status, 'error_temporal');
  assert.equal(result.networkAttempted, true);
  assert.doesNotMatch(JSON.stringify(result), /synthetic|password|private network/);
});
