import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

test('stdio handshake, seven distinct tools, workflows and browser-free work management', { timeout: 120_000 }, async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sunat-mcp-test-'));
  const previousLocal = process.env.LOCALAPPDATA;
  const previousOperator = process.env.SUNAT_OPERATOR_ID;
  process.env.LOCALAPPDATA = directory;
  process.env.SUNAT_OPERATOR_ID = 'default';
  const vault = await import('./credentials.js');
  await vault.saveSunatAccountCredentials([{ accountKey: 'Synthetic account', mode: 'ruc', document: '00000000001', username: 'TEST', password: 'synthetic-password-only' }]);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href, path.join(root, 'src', 'index.ts')], {
    cwd: directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LOCALAPPDATA: directory, DOTENV_CONFIG_PATH: path.join(directory, '.env'), SUNAT_BROWSER_MODE: 'hybrid', SUNAT_CDP_ENDPOINT: 'https://remote.invalid' },
  });
  context.signal.addEventListener('abort', () => { child.kill(); }, { once: true });
  let nextId = 0;
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter?.reject(new Error(message.error.message));
        else waiter?.resolve(message.result);
      }
    } catch { for (const waiter of pending.values()) waiter.reject(new Error('stdout contains non-JSON-RPC data')); }
  });
  child.stderr.resume();
  child.on('error', (error) => { for (const waiter of pending.values()) waiter.reject(error); });
  child.on('exit', () => { for (const waiter of pending.values()) waiter.reject(new Error('MCP exited before responding')); });
  async function request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++nextId;
    const response = new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return response;
  }
  try {
    const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'sunat-test', version: '1' } });
    assert.equal(initialized.serverInfo.name, 'sunat-peru');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const listed = await request('tools/list');
    assert.deepEqual(listed.tools.map((item: any) => item.name).sort(), ['sunat_estado', 'sunat_iniciar_sesion', 'sunat_brave_ejecutar_lote', 'sunat_brave_captura', 'sunat_validar_comprobante', 'sunat_trabajos', 'sunat_guias'].sort());
    const resources = await request('resources/list');
    assert.equal(resources.resources.length, 4);
    const flows = JSON.parse((await request('resources/read', { uri: 'sunat://flujos' })).contents[0].text);
    assert.equal(flows.length, 30);
    const createArgs = { accion: 'crear', cuenta: 'Synthetic account', procedureId: 'declara-facil-621', operation: 'presentacion', claveOperacion: 'synthetic-private-period-key' };
    const created = await request('tools/call', { name: 'sunat_trabajos', arguments: createArgs });
    assert.equal(created.isError, undefined);
    const job = created.structuredContent.result.jobs[0].job;
    const repeatedJob = await request('tools/call', { name: 'sunat_trabajos', arguments: createArgs });
    assert.equal(repeatedJob.structuredContent.result.jobs[0].existing, true);
    assert.equal(repeatedJob.structuredContent.result.jobs[0].job.id, job.id);
    const jobs = await request('tools/call', { name: 'sunat_trabajos', arguments: { accion: 'listar' } });
    assert.equal(jobs.structuredContent.result.jobs.length, 1);
    assert.doesNotMatch(JSON.stringify(jobs), /Synthetic account|00000000001|synthetic-private-period-key|synthetic-password/);
    const paused = await request('tools/call', { name: 'sunat_trabajos', arguments: { accion: 'pausar', trabajoId: job.id } });
    assert.equal(paused.structuredContent.result.job.status, 'paused');
    const templates = await request('resources/templates/list');
    assert.ok(templates.resourceTemplates.some((item: any) => item.uriTemplate === 'sunat://procedimientos/{id}'));
    const catalog = JSON.parse(await readFile(path.join(root, 'data', 'operation-index.json'), 'utf8'));
    assert.equal(catalog.publicProcedureGuide.records.length, 30);
    const guideCatalog = JSON.parse(await readFile(path.join(root, 'data', 'official-guides.json'), 'utf8'));
    const coverage = await request('tools/call', { name: 'sunat_guias', arguments: { accion: 'cobertura' } });
    assert.equal(coverage.isError, undefined);
    assert.equal(coverage.structuredContent.result.total, guideCatalog.records.length);
    assert.equal(coverage.structuredContent.result.localProcedures, 30);
    assert.equal(coverage.structuredContent.result.reading.unavailable, undefined);
    assert.ok(coverage.structuredContent.result.removed.unavailable >= 131);
    const prepared = await request('tools/call', { name: 'sunat_guias', arguments: { accion: 'buscar', consulta: 'emitir boleta', canal: 'sol-web', operacion: 'emision' } });
    assert.equal(prepared.structuredContent.result.results[0].procedureId, 'see-sol-factura');
    assert.ok(prepared.structuredContent.result.results[0].steps.length);
    assert.ok(prepared.structuredContent.result.results[0].checks.length);
    assert.equal(typeof prepared.structuredContent.result.results[0].localObservations, 'string');
    assert.equal(prepared.structuredContent.result.results[0].needsSourceReview, false);
    const consultation = await request('tools/call', { name: 'sunat_guias', arguments: { accion: 'buscar', consulta: 'consultar NPS', canal: 'sol-web' } });
    assert.deepEqual(consultation.structuredContent.result.results.map((r: any) => r.id), ['nps-consulta']);
    const preparedRead = await request('tools/call', { name: 'sunat_guias', arguments: { accion: 'leer', id: 'nps-generacion' } });
    assert.match(preparedRead.structuredContent.result.markdown, /Punto decisivo/);
    assert.equal(preparedRead.structuredContent.result.needsLiveCheck, true);
    const guideSearch = await request('tools/call', { name: 'sunat_guias', arguments: { accion: 'buscar', consulta: 'nps', tipo: 'video', cantidad: 1 } });
    assert.ok(guideSearch.structuredContent.result.total > 0);
    const guideRead = await request('tools/call', { name: 'sunat_guias', arguments: { accion: 'leer', id: guideSearch.structuredContent.result.results[0].id } });
    assert.equal(guideRead.isError, undefined);
    assert.equal(guideRead.structuredContent.result.reading, 'transcript-reviewed');
    assert.ok(guideRead.structuredContent.result.summary.length > 0);
    assert.ok(guideRead.structuredContent.result.steps.some((step: any) => step.at));
    const absentGuide = await request('tools/call', { name: 'sunat_guias', arguments: { accion: 'leer', id: 'guia-ffffffffffffffffffff' } });
    assert.equal(absentGuide.isError, true);
    for (const card of catalog.publicProcedureGuide.records) {
      const result = await request('resources/read', { uri: card.resourceUri });
      assert.match(result.contents[0].text, new RegExp('^## ' + card.id + ' — '));
      assert.equal((result.contents[0].text.match(/^## [a-z0-9-]+ — /gm) ?? []).length, 1);
    }
    for (const uri of ['sunat://operaciones', 'sunat://perfil', 'sunat://procedimientos']) {
      assert.ok((await request('resources/read', { uri })).contents[0].text.length > 0);
    }
    const invalid = await request('tools/call', { name: 'sunat_brave_ejecutar_lote', arguments: { routeId: 'ficha-ruc', steps: [{ action: 'snapshot' }] } });
    assert.equal(invalid.isError, true);
    const browserTool = listed.tools.find((tool: any) => tool.name === 'sunat_brave_ejecutar_lote');
    assert.equal(browserTool.annotations.destructiveHint, true);
    assert.deepEqual(browserTool.inputSchema.properties.entryPoint.enum, ['declaraciones-pagos', 'tramites-consultas', 'renta-anual-personas', 'renta-anual-empresas']);
    for (const args of [{ entryPoint: 'other-account' }, { entryPoint: 'declaraciones-pagos', steps: [{ action: 'snapshot' }] }, { entryPoint: 'renta-anual-personas', routeId: 'ficha-ruc' }]) {
      assert.equal((await request('tools/call', { name: 'sunat_brave_ejecutar_lote', arguments: args })).isError, true);
    }
    for (const step of [{ action: 'scroll' }, { action: 'scroll', ref: 'e1', direction: 'down' }, { action: 'scroll', ref: 'chrome-tab' }]) {
      const rejected = await request('tools/call', { name: 'sunat_brave_ejecutar_lote', arguments: { steps: [step] } });
      assert.equal(rejected.isError, true);
      assert.match(JSON.stringify(rejected), /scroll|ref|direction/);
    }
    const unknown = await request('tools/call', { name: 'sunat_brave_ejecutar_lote', arguments: { procedureId: 'unknown-account', steps: [{ action: 'snapshot' }] } });
    assert.equal(unknown.isError, true);
    const unavailable = await request('tools/call', { name: 'sunat_brave_ejecutar_lote', arguments: { steps: [{ action: 'snapshot' }] } });
    assert.equal(unavailable.isError, true);
    assert.match(JSON.stringify(unavailable), /HTTP local/);
    const repeated = await request('tools/call', { name: 'sunat_brave_ejecutar_lote', arguments: { steps: [{ action: 'snapshot' }] } });
    assert.equal(repeated.isError, true);
    assert.match(JSON.stringify(repeated), /No se volvió a solicitar depuración/);
    const entry = await request('tools/call', { name: 'sunat_brave_ejecutar_lote', arguments: { entryPoint: 'declaraciones-pagos' } });
    assert.equal(entry.isError, true);
    assert.match(JSON.stringify(entry), /No se volvió a solicitar depuración/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    lines.close();
    await rm(directory, { recursive: true, force: true });
    if (previousLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previousLocal;
    if (previousOperator === undefined) delete process.env.SUNAT_OPERATOR_ID; else process.env.SUNAT_OPERATOR_ID = previousOperator;
  }
});
