import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';

/** Handshake only: no browser tools, vault, account data or CDP connection. */
export async function verifyInstall(transport, { spawnProcess = spawn, timeout = 30_000 } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sunat-install-check-'));
  let child, lines, timer;
  const pending = new Map();
  const fail = () => { for (const reject of pending.values()) reject(new Error('mcp_verification_failed')); pending.clear(); };
  try {
    const config = path.join(directory, '.env');
    await writeFile(config, '');
    child = spawnProcess(transport.command, transport.args, {
      cwd: directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LOCALAPPDATA: directory, DOTENV_CONFIG_PATH: config, SUNAT_OPERATOR_ID: 'default' },
    });
    child.stderr.resume();
    child.on('error', fail);
    child.on('exit', fail);
    let nextId = 0;
    const responses = new Map();
    lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        const message = JSON.parse(line);
        if (message.error) return fail();
        if (message.id !== undefined) {
          responses.get(message.id)?.(message.result);
          responses.delete(message.id); pending.delete(message.id);
        }
      } catch { fail(); }
    });
    function request(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, reject); responses.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    }
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { fail(); reject(new Error('mcp_verification_timeout')); }, timeout); });
    await Promise.race([(async () => {
      const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'sunat-installer', version: '1' } });
      if (initialized?.serverInfo?.name !== 'sunat-peru') throw new Error('unexpected_mcp_server');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const listed = await request('tools/list');
      const expected = ['sunat_estado', 'sunat_iniciar_sesion', 'sunat_brave_ejecutar_lote', 'sunat_brave_captura', 'sunat_validar_comprobante', 'sunat_trabajos', 'sunat_guias'];
      if (!Array.isArray(listed?.tools) || listed.tools.length !== expected.length || expected.some((name) => !listed.tools.some((tool) => tool.name === name))) throw new Error('unexpected_mcp_tools');
    })(), deadline]);
    return { handshake: true, tools: 7, browserConnected: false };
  } catch { throw new Error('No se pudo verificar el MCP por stdio. No se abrió Brave ni se leyó una cuenta.'); }
  finally {
    clearTimeout(timer);
    lines?.close();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit').catch(() => {});
      child.kill(); await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
}
