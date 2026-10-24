import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('stdio handshake, five tools, procedure resources and invalid batch rejection', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sunat-mcp-test-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const child = spawn(process.execPath, [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(root, 'src', 'index.ts')], {
    cwd: directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LOCALAPPDATA: directory, DOTENV_CONFIG_PATH: path.join(directory, '.env') },
  });
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
    assert.deepEqual(listed.tools.map((item: any) => item.name).sort(), ['sunat_estado', 'sunat_iniciar_sesion', 'sunat_brave_ejecutar_lote', 'sunat_brave_captura', 'sunat_validar_comprobante'].sort());
    const resources = await request('resources/list');
    assert.equal(resources.resources.length, 3);
    const templates = await request('resources/templates/list');
    assert.ok(templates.resourceTemplates.some((item: any) => item.uriTemplate === 'sunat://procedimientos/{id}'));
    const catalog = JSON.parse(await readFile(path.join(root, 'data', 'operation-index.json'), 'utf8'));
    assert.equal(catalog.publicProcedureGuide.records.length, 27);
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
    const unknown = await request('tools/call', { name: 'sunat_brave_ejecutar_lote', arguments: { procedureId: 'unknown-account', steps: [{ action: 'snapshot' }] } });
    assert.equal(unknown.isError, true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    lines.close();
    await rm(directory, { recursive: true, force: true });
  }
});
