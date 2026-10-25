import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, cp, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { setup, planSkill, detectBrowserMode, findCodex, assertNoActiveBrowser, installationCommandError, withNpmDirectory } from './setup.mjs';
import { verifyInstall } from './verify-install.mjs';

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sunat-setup-test-'));
  const root = path.join(directory, "proyecto ñ con espacios ' & símbolos");
  const codexDirectory = path.join(directory, 'codex');
  await mkdir(path.join(root, '.agents', 'skills', 'sunat', 'references'), { recursive: true });
  await mkdir(codexDirectory);
  await writeFile(path.join(root, 'package.json'), '{"name":"sunat-peru-mcp"}');
  await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}');
  await writeFile(path.join(root, '.env.example'), 'SUNAT_BROWSER_MODE=hybrid\nSUNAT_CDP_ENDPOINT=http://127.0.0.1:9222\nSUNAT_CLIENT_SECRET=\n');
  await writeFile(path.join(root, '.agents', 'skills', 'sunat', 'SKILL.md'), 'Generic SUNAT instructions');
  await writeFile(path.join(root, '.agents', 'skills', 'sunat', 'references', 'revisiones-locales.md'), 'Generic procedure instructions');
  const npm = path.join(directory, 'npm-cli.js');
  await writeFile(npm, '// synthetic npm');
  const original = 'model = "preserved-model"\n[mcp_servers.other]\ncommand="preserved-command"\n';
  await writeFile(path.join(codexDirectory, 'config.toml'), original);
  const calls = [];
  const servers = [{ name: 'other', enabled: true, transport: { type: 'stdio', command: 'preserved-command', args: [] } }];
  const env = { ...process.env, CODEX_HOME: codexDirectory, LOCALAPPDATA: directory, npm_execpath: npm };
  const execute = (command, args, options) => {
    calls.push({ command, args, cwd: options?.cwd });
    if (args[0] === npm) return '';
    if (args[0] === 'mcp' && args[1] === 'list') return JSON.stringify(servers);
    if (args[0] === 'mcp' && args[1] === 'get') return JSON.stringify(servers.find((entry) => entry.name === args[2]));
    if (args[0] === 'mcp' && args[1] === 'add') {
      const split = args.indexOf('--');
      const entry = { name: args[2], enabled: true, transport: { type: 'stdio', command: args[split + 1], args: args.slice(split + 2) } };
      servers.push(entry);
      return '';
    }
    throw new Error('unexpected synthetic command');
  };
  const options = { root, env, platform: 'win32', execute, locateCodex: async () => ({ command: 'codex.exe', args: [] }), detect: async () => ({ mode: 'uia' }), verify: async () => ({ tools: 7 }), log: () => {} };
  return { directory, root, codexDirectory, original, servers, calls, options, dispose: () => rm(directory, { recursive: true, force: true }) };
}

test('setup installs, creates private config and skill, registers absolute paths, preserves unrelated integrations and repeats without duplicates', async () => {
  const f = await fixture();
  try {
    const installed = await setup(f.options);
    assert.equal(installed.registration, 'created');
    assert.equal(installed.mode, 'uia');
    assert.equal(installed.browserConnected, false);
    assert.equal(installed.activation, 'client_reload_required');
    assert.match(await readFile(path.join(f.root, '.env'), 'utf8'), /SUNAT_BROWSER_MODE=uia/);
    const registered = f.servers.find((entry) => entry.name === 'sunat_peru');
    assert.ok(path.isAbsolute(registered.transport.command));
    assert.match(registered.transport.args[1], /^file:\/\//);
    assert.ok(path.isAbsolute(registered.transport.args[2]));
    assert.match(registered.transport.args[2], /start\.mjs$/);
    assert.equal(await readFile(path.join(f.codexDirectory, 'config.toml'), 'utf8'), f.original);
    assert.equal((await readdir(path.join(f.codexDirectory, 'sunat-install-backups'))).length, 1);
    assert.equal(await readFile(path.join(f.codexDirectory, 'skills', 'sunat-peru', 'SKILL.md'), 'utf8'), 'Generic SUNAT instructions');
    assert.equal((await setup(f.options)).registration, 'reused');
    assert.equal(f.calls.filter((call) => call.args[1] === 'add').length, 1);
    assert.equal(f.servers.filter((entry) => entry.name === 'sunat_peru').length, 1);
    assert.equal(f.servers[0].transport.command, 'preserved-command');
    assert.equal((await setup({ ...f.options, check: true })).registration, 'verified');
  } finally { await f.dispose(); }
});

test('existing environment secrets and an existing registration are preserved without putting them in command arguments', async () => {
  const f = await fixture();
  try {
    const configuration = 'SUNAT_BROWSER_MODE=hybrid\nSUNAT_CLIENT_SECRET=synthetic-private-value\n';
    await writeFile(path.join(f.root, '.env'), configuration);
    await setup(f.options);
    assert.equal(await readFile(path.join(f.root, '.env'), 'utf8'), configuration);
    assert.doesNotMatch(JSON.stringify(f.calls), /synthetic-private-value/);
    assert.equal((await setup(f.options)).mode, 'preserved');
  } finally { await f.dispose(); }
});

test('foreign registrations and user-edited skills stop before dependency installation or config changes', async () => {
  const f = await fixture();
  try {
    f.servers.push({ name: 'sunat_peru', transport: { type: 'streamable_http', url: 'https://example.com' } });
    await assert.rejects(setup(f.options), /existente/);
    assert.equal(f.calls.filter((call) => call.args[1] === 'ci').length, 0);
    f.servers.pop();
    const skill = path.join(f.codexDirectory, 'skills', 'sunat-peru');
    await mkdir(skill, { recursive: true });
    await writeFile(path.join(skill, 'SKILL.md'), 'User instructions');
    await assert.rejects(setup(f.options), /skill SUNAT ajena/);
    assert.equal(f.calls.filter((call) => call.args[1] === 'ci').length, 0);
    assert.equal(await readFile(path.join(skill, 'SKILL.md'), 'utf8'), 'User instructions');
  } finally { await f.dispose(); }
});

test('managed skill upgrades replace only unmodified installer-owned content', async () => {
  const f = await fixture();
  try {
    await setup(f.options);
    await writeFile(path.join(f.root, '.agents', 'skills', 'sunat', 'SKILL.md'), 'Updated generic instructions');
    const plan = await planSkill(f.root, f.codexDirectory);
    assert.equal(plan.files[0].changed, true);
    await setup(f.options);
    const destination = path.join(f.codexDirectory, 'skills', 'sunat-peru', 'SKILL.md');
    assert.equal(await readFile(destination, 'utf8'), 'Updated generic instructions');
    await writeFile(destination, 'User-edited instructions');
    await assert.rejects(setup(f.options), /skill SUNAT ajena/);
    assert.equal(await readFile(destination, 'utf8'), 'User-edited instructions');
  } finally { await f.dispose(); }
});

test('dependency and handshake failures never register an unverified server', async () => {
  for (const kind of ['npm', 'handshake']) {
    const f = await fixture();
    try {
      const options = { ...f.options };
      if (kind === 'npm') options.execute = (command, args, config) => { if (args[1] === 'ci') throw new Error('synthetic install failure'); return f.options.execute(command, args, config); };
      else options.verify = async () => { throw new Error('synthetic handshake failure'); };
      await assert.rejects(setup(options));
      assert.equal(f.calls.filter((call) => call.args[1] === 'add').length, 0);
      assert.equal(await readFile(path.join(f.codexDirectory, 'config.toml'), 'utf8'), f.original);
    } finally { await f.dispose(); }
  }
});

test('an uncertain Codex registration is reconciled by reading it once, never by replaying add', async () => {
  const f = await fixture();
  try {
    const execute = (command, args, config) => {
      const result = f.options.execute(command, args, config);
      if (args[1] === 'add') throw new Error('synthetic transport timeout');
      return result;
    };
    assert.equal((await setup({ ...f.options, execute })).registration, 'created');
    assert.equal(f.calls.filter((call) => call.args[1] === 'add').length, 1);
  } finally { await f.dispose(); }
});

test('automatic browser choice uses verified loopback Brave metadata without opening a CDP connection', async () => {
  const calls = [];
  const execute = (command) => command === 'netstat.exe' ? 'TCP 127.0.0.1:9222 0.0.0.0:0 LISTENING 7' : '"brave.exe","7"';
  const metadata = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/allowed-id' }) }; };
  assert.deepEqual(await detectBrowserMode({}, execute, metadata), { mode: 'hybrid', endpoint: 'http://127.0.0.1:9222' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^http:\/\/127\.0\.0\.1:9222\/json\/version$/);
  assert.equal(calls[0].options.redirect, 'error');
  for (const bad of [() => 'TCP 0.0.0.0:9222 0.0.0.0:0 LISTENING 7', (command) => command === 'netstat.exe' ? 'TCP 127.0.0.1:9222 0.0.0.0:0 LISTENING 7' : '"other.exe","7"']) {
    assert.deepEqual(await detectBrowserMode({}, bad, () => { throw new Error('must not fetch'); }), { mode: 'uia' });
  }
  assert.deepEqual(await detectBrowserMode({}, execute, async () => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://example.com:9222/devtools/browser/id' }) })), { mode: 'uia' });
});

test('check-only has no installation writes and a missing registration cannot be called ready', async () => {
  const f = await fixture();
  try {
    await assert.rejects(setup({ ...f.options, check: true }), /no está completa/);
    assert.equal(f.calls.length, 1);
    assert.equal(await readFile(path.join(f.codexDirectory, 'config.toml'), 'utf8'), f.original);
    assert.deepEqual((await readdir(f.root)).sort(), ['.agents', '.env.example', 'package-lock.json', 'package.json']);
  } finally { await f.dispose(); }
});

test('the installer protects a live browser lease without changing or deleting its database', async () => {
  const f = await fixture();
  let db;
  try {
    const { default: Database } = await import('better-sqlite3');
    const directory = path.join(f.directory, 'SUNAT MCP', 'runtime');
    await mkdir(directory, { recursive: true });
    db = new Database(path.join(directory, 'coordination.sqlite'));
    db.exec('CREATE TABLE leases (resource TEXT PRIMARY KEY, pid INTEGER)');
    db.prepare('INSERT INTO leases VALUES (?, ?)').run('existing-brave', process.pid);
    await assert.rejects(assertNoActiveBrowser(f.options.env), /sesión MCP activa/);
    assert.equal(db.prepare('SELECT pid FROM leases').get().pid, process.pid);
    await assert.rejects(setup(f.options), /sesión MCP activa/);
    assert.equal(f.calls.filter((call) => call.args[1] === 'ci').length, 0);
  } finally { db?.close(); await f.dispose(); }
});

test('matching dependency stamps permit a repeat without npm ci; a changed lockfile protects an active session', async () => {
  const f = await fixture();
  let db;
  try {
    await setup(f.options);
    await mkdir(path.join(f.root, 'node_modules', 'tsx', 'dist'), { recursive: true });
    await writeFile(path.join(f.root, 'node_modules', 'tsx', 'dist', 'loader.mjs'), '// synthetic module');
    await mkdir(path.join(f.root, 'node_modules', 'better-sqlite3'), { recursive: true });
    await writeFile(path.join(f.root, 'node_modules', 'better-sqlite3', 'package.json'), '{}');
    const { default: Database } = await import('better-sqlite3');
    const runtime = path.join(f.directory, 'SUNAT MCP', 'runtime');
    await mkdir(runtime, { recursive: true });
    db = new Database(path.join(runtime, 'coordination.sqlite'));
    db.exec('CREATE TABLE leases (resource TEXT PRIMARY KEY, pid INTEGER)');
    db.prepare('INSERT INTO leases VALUES (?, ?)').run('existing-brave', process.pid);
    await setup(f.options);
    assert.equal(f.calls.filter((call) => call.args[1] === 'ci').length, 1);
    await writeFile(path.join(f.root, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}');
    await assert.rejects(setup(f.options), /sesión MCP activa/);
    assert.equal(f.calls.filter((call) => call.args[1] === 'ci').length, 1);
  } finally { db?.close(); await f.dispose(); }
});

test('real Codex registers and checks the launch wrapper from an isolated home without browser or live account access', { timeout: 180_000, skip: process.platform !== 'win32' }, async (context) => {
  let cli;
  try { cli = await findCodex(process.execPath); } catch { context.skip('Codex CLI is not installed on this runner'); return; }
  const f = await fixture();
  try {
    const repository = fileURLToPath(new URL('../', import.meta.url));
    // A genuinely new installation with spaces/Unicode, isolated from the user's .env.
    for (const directory of ['src', 'data', '.agents/skills/sunat']) await cp(path.join(repository, directory), path.join(f.root, directory), { recursive: true });
    for (const name of ['package.json', 'package-lock.json', '.env.example']) await cp(path.join(repository, name), path.join(f.root, name));
    await mkdir(path.join(f.root, 'scripts'));
    await cp(path.join(repository, 'scripts', 'start.mjs'), path.join(f.root, 'scripts', 'start.mjs'));
    const fullInstall = process.env.SUNAT_SETUP_FULL_SMOKE === '1';
    if (!fullInstall) await symlink(path.join(repository, 'node_modules'), path.join(f.root, 'node_modules'), 'junction');
    const installEnv = fullInstall ? { ...f.options.env, npm_execpath: path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') } : f.options.env;
    const execute = (command, args, options = {}) => {
      if (!fullInstall && args[0] === f.options.env.npm_execpath) return ''; // Dependencies supplied by the test environment unless a full smoke is explicitly requested.
      try { return execFileSync(command, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, ...options }); }
      catch (error) {
        if (fullInstall && args[1] === 'ci') {
          const output = String(error.stderr ?? '');
          context.diagnostic(JSON.stringify({
            npmCode: output.match(/npm error code ([A-Z_0-9]+)/)?.[1],
            package: output.match(/npm error path .*?[\\/]node_modules[\\/]([\w@.-]+(?:[\\/][\w.-]+)?)/)?.[1],
            commandNotRecognized: /is not recognized|no se reconoce/i.test(output),
            tlsFailure: /certificate|CERT_|SSL/i.test(output),
            missingBuildTools: /gyp ERR! find VS/.test(output),
            missingPrebuilt: /No prebuilt binaries found/i.test(output),
            cleanupWarning: /npm warn cleanup/.test(output),
          }));
        }
        throw installationCommandError(error);
      }
    };
    const options = { ...f.options, env: installEnv, execute, locateCodex: async () => cli, verify: verifyInstall };
    assert.equal((await setup(options)).registration, 'created');
    assert.equal((await setup({ ...options, check: true })).tools, 7);
    assert.equal((await setup(options)).registration, 'reused');
    const text = await readFile(path.join(f.codexDirectory, 'config.toml'), 'utf8');
    assert.match(text, /preserved-model/);
    assert.match(text, /preserved-command/);
    assert.equal((text.match(/\[mcp_servers\.sunat_peru\]/g) ?? []).length, 1);
  } finally { await f.dispose(); }
});

test('stdio verification kills a hung server and never requests browser tools', { timeout: 10_000 }, async () => {
  await assert.rejects(verifyInstall({ command: process.execPath, args: ['-e', 'setInterval(()=>{}, 1000)'] }, { timeout: 50 }), /No se pudo verificar/);
  await assert.rejects(verifyInstall({ command: path.join(os.tmpdir(), 'sunat-not-existing-executable'), args: [] }, { timeout: 50 }), /No se pudo verificar/);
});

test('stdio verification requests only initialize and tools/list, never browser or account operations', { timeout: 10_000 }, async () => {
  const f = await fixture();
  try {
    const trace = path.join(f.directory, 'rpc-methods.jsonl');
    const names = ['sunat_estado', 'sunat_iniciar_sesion', 'sunat_brave_ejecutar_lote', 'sunat_brave_captura', 'sunat_validar_comprobante', 'sunat_trabajos', 'sunat_guias'];
    const source = `const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(trace)},m.method+'\\n');if(m.id)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{serverInfo:{name:'sunat-peru'}}:{tools:${JSON.stringify(names)}.map(name=>({name}))}}));});`;
    assert.equal((await verifyInstall({ command: process.execPath, args: ['-e', source] })).tools, 7);
    assert.deepEqual((await readFile(trace, 'utf8')).trim().split('\n'), ['initialize', 'notifications/initialized', 'tools/list']);
  } finally { await f.dispose(); }
});

test('PowerShell entrypoint detects existing prerequisites and forwards check/mode without installing or opening Brave', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    await cp(new URL('../install.ps1', import.meta.url), path.join(f.directory, 'install.ps1'));
    const application = path.join(f.directory, 'BraveSoftware', 'Brave-Browser', 'Application');
    await mkdir(application, { recursive: true });
    await writeFile(path.join(application, 'brave.exe'), 'synthetic placeholder, never executed');
    await mkdir(path.join(f.directory, 'scripts'));
    await writeFile(path.join(f.directory, 'scripts', 'setup.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)));');
    const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(f.directory, 'install.ps1'), '-Check', '-Mode', 'uia'], { env: { ...process.env, LOCALAPPDATA: f.directory }, encoding: 'utf8', windowsHide: true });
    assert.deepEqual(JSON.parse(output.trim()), ['--mode', 'uia', '--check']);
    assert.doesNotMatch(output, /Instalando requisito/);
  } finally { await f.dispose(); }
});

test('installation diagnostics expose only recognized technical codes, never captured output or secrets', () => {
  for (const [source, code] of [['npm error ENOTFOUND synthetic-private-data', 'ENOTFOUND'], ['gyp ERR! find VS synthetic-private-data', 'build_tools_unavailable'], ['unknown synthetic-private-data', 'command_failed']]) {
    const error = installationCommandError({ stderr: source, message: 'synthetic-private-message' });
    assert.match(error.message, new RegExp(code));
    assert.doesNotMatch(error.message, /synthetic-private/);
  }
});

test('npm receives a safe junction for special Windows paths and cleanup leaves the project intact', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  let alias;
  try {
    const npm = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    await withNpmDirectory(f.root, async (cwd) => {
      alias = cwd;
      assert.doesNotMatch(cwd, /[&|<>^()%!]/);
      const prefix = execFileSync(process.execPath, [npm, 'prefix'], { cwd, encoding: 'utf8', windowsHide: true }).trim();
      assert.equal(path.resolve(prefix).toLowerCase(), path.resolve(cwd).toLowerCase());
      assert.equal(await readFile(path.join(cwd, 'package.json'), 'utf8'), '{"name":"sunat-peru-mcp"}');
    });
    await assert.rejects(readFile(path.join(alias, 'package.json')));
    assert.equal(await readFile(path.join(f.root, 'package.json'), 'utf8'), '{"name":"sunat-peru-mcp"}');
  } finally { await f.dispose(); }
});
