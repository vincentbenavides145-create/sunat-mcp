import assert from 'node:assert/strict';
import { test, after, beforeEach } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(os.tmpdir(), 'sunat-menu-learning-test-'));
process.env.LOCALAPPDATA = directory;
const learning = await import('./learning.js');
const file = path.join(directory, 'SUNAT MCP', 'learning', 'profile.json');
beforeEach(async () => { await rm(path.dirname(file), { recursive: true, force: true }); });
after(async () => { await rm(directory, { recursive: true, force: true }); });

test('only verified menu controls can extend a learned route, never form actions or input IDs', () => {
  assert.equal(learning.isLearnableMenuControl({ role: 'option', label: 'Emitir Factura', navigation: true }), true);
  assert.equal(learning.isLearnableMenuControl({ role: 'tab', label: 'Empresas', navigation: true }), true);
  assert.equal(learning.isLearnableMenuControl({ role: 'button', label: 'Emitir Factura' }), false);
  assert.equal(learning.isLearnableMenuControl({ role: 'link', label: 'Ficha RUC' }), false);
  for (const label of ['Continuar', 'Buscar', 'Consultar', 'Limpiar', 'tipdoc', 'medioPagoId', 'formaPago1']) {
    assert.equal(learning.isLearnableMenuControl({ role: 'option', label, navigation: true }), false);
  }
});

test('legacy form routes disappear from execution and profile while valid long menu routes remain', async () => {
  await mkdir(path.dirname(file), { recursive: true });
  const usage = { successfulNavigations: 1, lastSuccessfulNavigation: '2026-01-01T00:00:00.000Z' };
  const safe = Array.from({ length: 12 }, (_, i) => `Sección de navegación ${i}`);
  await writeFile(file, JSON.stringify({ schemaVersion: 1, routes: {
    'aprendida-bad': { ...usage, path: ['SEE SOL', 'Continuar'], destination: 'Continuar' },
    'aprendida-field': { ...usage, path: ['medioPagoId'], destination: 'medioPagoId' },
    'aprendida-query': { ...usage, path: ['Mi fraccionamiento', 'Precalificación', 'Consultar'], destination: 'Consultar' },
    'aprendida-safe': { ...usage, path: safe, destination: safe.at(-1) },
  } }));
  assert.equal(await learning.getLearnedRoute('aprendida-bad'), undefined);
  assert.equal(await learning.getLearnedRoute('aprendida-field'), undefined);
  assert.equal(await learning.getLearnedRoute('aprendida-query'), undefined);
  assert.deepEqual((await learning.getLearnedRoute('aprendida-safe'))?.path, safe);
  assert.doesNotMatch(await learning.renderPersonalProfile(), /aprendida-bad|medioPagoId/);
  await learning.rememberDiscoveredNavigation(['Empresas', 'Ficha RUC']);
  const disk = await readFile(file, 'utf8');
  assert.doesNotMatch(disk, /Continuar|medioPagoId|aprendida-bad|aprendida-query/);
  assert.match(disk, /aprendida-safe/);
});

test('new form-only routes are rejected without creating a learning file', async () => {
  assert.equal(await learning.rememberDiscoveredNavigation(['Validar RUC o DNI', 'Continuar']), false);
  await assert.rejects(readFile(file, 'utf8'), { code: 'ENOENT' });
});
