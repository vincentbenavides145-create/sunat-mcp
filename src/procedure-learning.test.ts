import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserSnapshot } from './native-browser.js';

// Separate test process, temporary storage: never touch the user's learning.
const directory = await mkdtemp(path.join(os.tmpdir(), 'sunat-learning-test-'));
process.env.LOCALAPPDATA = directory;
const learning = await import('./procedure-learning.js');
const file = path.join(directory, 'SUNAT MCP', 'learning', 'procedures.json');
let time = 0;
const snapshot = (text = 'Consulta', url = 'https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm'): BrowserSnapshot => ({ text, url, capturedAt: ++time, fingerprint: 'synthetic' });
beforeEach(async () => {
  learning.resetProcedureLearning();
  await rm(path.dirname(file), { recursive: true, force: true });
});
after(async () => { await rm(directory, { recursive: true, force: true }); });
const saved = async () => JSON.parse(await readFile(file, 'utf8'));
const variants = async (key: string): Promise<any[]> => Object.values((await saved()).procedures[key]);

test('learning persists canonical steps across batches and omits unknown private labels', async () => {
  await learning.selectProcedureLearning('ficha-ruc', 'consulta', snapshot());
  learning.observeProcedureStep('click', 'Mis Datos del RUC');
  learning.observeProcedureStep('fill', 'Etiqueta privada de prueba');
  await learning.observeProcedureSnapshot(snapshot('Datos generales'));
  const flow = learning.getProcedureLearningFlowId();
  await learning.selectProcedureLearning();
  assert.equal(learning.getProcedureLearningFlowId(), flow);
  learning.observeProcedureStep('click', 'Consultar');
  await learning.observeProcedureSnapshot(snapshot('Resultado de consulta'));
  const entries = await variants('ficha-ruc:consulta');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].steps.length, 2);
  assert.equal(entries[0].omittedControls, 1);
  assert.equal(entries[0].completions, 0);
  const disk = await readFile(file, 'utf8');
  assert.doesNotMatch(disk, /Etiqueta privada|Resultado de consulta|https:|synthetic/);
  assert.match(await learning.renderProcedureLearning('ficha-ruc'), /Pasos observados/);
});

test('a fresh rendered result counts once, while buttons do not certify completion', async () => {
  await learning.selectProcedureLearning('devolucion-1649', 'presentacion', snapshot());
  learning.observeProcedureStep('click', 'Enviar solicitud');
  await learning.observeProcedureSnapshot(snapshot('@e1 button "Solicitud registrada correctamente"'));
  assert.equal((await variants('devolucion-1649:presentacion'))[0].completions, 0);
  await learning.observeProcedureSnapshot(snapshot('Su solicitud fue registrada correctamente'));
  await learning.observeProcedureSnapshot(snapshot('Su solicitud fue registrada correctamente'));
  assert.equal((await variants('devolucion-1649:presentacion'))[0].completions, 1);
  assert.doesNotMatch(await readFile(file, 'utf8'), /Su solicitud fue/);
});

test('an old success message and a preliminary constancia are not new completion', async () => {
  await learning.selectProcedureLearning('devolucion-1649', 'presentacion', snapshot('Su solicitud fue registrada correctamente'));
  learning.observeProcedureStep('click', 'Consultar');
  await learning.observeProcedureSnapshot(snapshot('Su solicitud fue registrada correctamente'));
  assert.equal((await variants('devolucion-1649:presentacion'))[0].completions, 0);
  await learning.observeProcedureSnapshot(snapshot('Vista previa - Constancia de presentación - Número de orden'));
  assert.equal((await variants('devolucion-1649:presentacion'))[0].completions, 0);
});

test('changing phase preserves steps, changes flow identity and resets the result baseline', async () => {
  await learning.selectProcedureLearning('devolucion-1649', 'preparacion', snapshot());
  learning.observeProcedureStep('click', 'Siguiente');
  const flow = learning.getProcedureLearningFlowId();
  await learning.selectProcedureLearning('devolucion-1649', 'presentacion', snapshot());
  assert.notEqual(learning.getProcedureLearningFlowId(), flow);
  learning.observeProcedureStep('click', 'Enviar solicitud');
  await learning.observeProcedureSnapshot(snapshot('Su solicitud fue registrada correctamente'));
  const item = (await variants('devolucion-1649:presentacion'))[0];
  assert.equal(item.steps.length, 2);
  assert.equal(item.completions, 1);
});

test('login pages, foreign origins and account resets cannot complete an observed flow', async () => {
  await learning.selectProcedureLearning('devolucion-1649', 'presentacion', snapshot());
  learning.observeProcedureStep('click', 'Enviar solicitud');
  const success = 'Su solicitud fue registrada correctamente';
  await learning.observeProcedureSnapshot(snapshot(success, 'https://example.org/'));
  await learning.observeProcedureSnapshot(snapshot(success, 'https://api-seguridad.sunat.gob.pe/oauth2/login'));
  learning.resetProcedureLearning();
  await learning.observeProcedureSnapshot(snapshot(success));
  assert.equal(await learning.renderProcedureLearning(), '');
});

test('only catalog procedures or confirmed local route IDs can start learning', async () => {
  await assert.rejects(learning.selectProcedureLearning('arbitrary-account-label'));
  await learning.selectProcedureLearning('ficha-ruc', 'consulta');
  await assert.rejects(learning.selectProcedureLearning(undefined, 'pago'));
});

test('stored data is reconstructed without arbitrary properties or labels', async () => {
  await learning.selectProcedureLearning('ficha-ruc', 'consulta', snapshot());
  learning.observeProcedureStep('click', 'Consultar');
  await learning.observeProcedureSnapshot(snapshot());
  const store = await saved();
  const entries = store.procedures['ficha-ruc:consulta'];
  const item = Object.values(entries)[0] as any;
  item.extra = 'private text';
  item.result = 'private result';
  item.completions = 99;
  entries['a'.repeat(32)] = { ...item, steps: [{ action: 'click', control: 'private label' }] };
  await writeFile(file, JSON.stringify(store));
  const rendered = await learning.renderProcedureLearning();
  assert.doesNotMatch(rendered, /private|99 resultados/);
  assert.match(rendered, /0 resultados comprobados/);
});

test('failed learning storage never retries or interrupts the SUNAT action', async () => {
  await learning.selectProcedureLearning('ficha-ruc', 'consulta', snapshot());
  learning.observeProcedureStep('click', 'Consultar');
  await rm(path.join(directory, 'SUNAT MCP'), { recursive: true, force: true });
  await writeFile(path.join(directory, 'SUNAT MCP'), 'not a directory');
  await assert.doesNotReject(learning.observeProcedureSnapshot(snapshot()));
  await rm(path.join(directory, 'SUNAT MCP'), { force: true });
});
