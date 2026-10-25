import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, stat, lstat, copyFile, mkdtemp, symlink, unlink, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyInstall } from './verify-install.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (value) => path.resolve(value).replaceAll('\\', '/').toLowerCase();
const skillFiles = ['SKILL.md', 'references/revisiones-locales.md'];

export function installationCommandError(error) {
  const output = String(error?.stderr ?? '') + String(error?.message ?? '');
  const code = /is not recognized|no se reconoce/i.test(output) ? 'lifecycle_command_failed'
    : /gyp ERR! find VS/.test(output) ? 'build_tools_unavailable'
    : output.match(/\b(?:ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EACCES|EPERM|ERESOLVE|CERT_HAS_EXPIRED|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)\b/)?.[0]
      || (String(error?.code) === 'ETIMEDOUT' ? 'ETIMEDOUT' : /NODE_MODULE_VERSION/.test(output) ? 'native_abi_mismatch' : 'command_failed');
  return new Error(`Falló un comando de instalación (${code}). Comprueba conexión, permisos y requisitos. No se mostraron argumentos ni salida privada.`);
}

/** npm-generated Windows cmd shims use unquoted SET paths. Keep shell metacharacters out of their cwd. */
export async function withNpmDirectory(root, task) {
  const unsafe = /[&|<>^()%!\r\n"]/;
  if (process.platform !== 'win32' || !unsafe.test(root)) return task(root);
  const base = !unsafe.test(os.tmpdir()) ? os.tmpdir() : path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Temp');
  if (unsafe.test(base)) throw new Error('No se encontró una carpeta temporal compatible para los scripts de npm.');
  const directory = await mkdtemp(path.join(base, 'sunat-npm-'));
  const junction = path.join(directory, 'project');
  let linked = false;
  try {
    await symlink(root, junction, 'junction'); linked = true;
    return await task(junction);
  } finally {
    // Unlink only the junction; never recursively delete its project target.
    if (linked) await unlink(junction);
    await rmdir(directory);
  }
}

function run(command, args, options = {}) {
  try { return execFileSync(command, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, maxBuffer: 4 * 1024 * 1024, ...options }); }
  catch (error) { throw installationCommandError(error); }
}

export async function findCodex(node, env = process.env, execute = run) {
  let found = [];
  try { found = execute('where.exe', ['codex']).trim().split(/\r?\n/); } catch { /* Check the desktop bundle next. */ }
  const bundled = path.join(env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin');
  if (env.LOCALAPPDATA && existsSync(bundled)) {
    const versions = await readdir(bundled, { withFileTypes: true });
    const candidates = await Promise.all(versions.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const executable = path.join(bundled, entry.name, 'codex.exe');
      return { executable, time: await stat(executable).then((value) => value.mtimeMs).catch(() => 0) };
    }));
    found.push(...candidates.sort((a, b) => b.time - a.time).filter((entry) => entry.time).map((entry) => entry.executable));
  }
  for (const executable of [...new Set(found)]) {
    let cli;
    if (/\.exe$/i.test(executable)) cli = { command: executable, args: [] };
    else if (/\.cmd$/i.test(executable)) {
      // Execute the npm CLI's JS entry directly: no cmd.exe interpolation.
      const entry = path.join(path.dirname(executable), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (existsSync(entry)) cli = { command: node, args: [entry] };
    }
    if (cli) { try { execute(cli.command, [...cli.args, '--version']); return cli; } catch { /* An old bundle may have been removed. */ } }
  }
  throw new Error('No se encontró la CLI de Codex ni su copia incluida en la aplicación. Instala o actualiza Codex antes de registrar el MCP.');
}

/** Inspect only loopback metadata, never open a CDP WebSocket or change Brave. */
export async function detectBrowserMode(env = process.env, execute = run, fetchMetadata = fetch) {
  const ports = [9222];
  if (env.LOCALAPPDATA) {
    try {
      const port = Number((await readFile(path.join(env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data', 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]);
      if (Number.isInteger(port) && port > 0 && port < 65536) ports.unshift(port);
    } catch { /* No enabled endpoint is normal on a new installation. */ }
  }
  let output;
  try { output = execute('netstat.exe', ['-ano', '-p', 'tcp']); } catch { return { mode: 'uia' }; }
  for (const port of [...new Set(ports)]) {
    const rows = output.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((row) => row[0] === 'TCP' && row[1]?.endsWith(`:${port}`) && /^(?:0\.0\.0\.0:0|\[::\]:0)$/.test(row[2] ?? '') && /^\d+$/.test(row.at(-1) ?? ''));
    if (!rows.length || rows.some((row) => !/^(?:127\.0\.0\.1|\[::1\]):/.test(row[1]))) continue;
    let owned = true;
    for (const pid of new Set(rows.map((row) => row.at(-1)))) {
      try { if (!/^"brave\.exe",/i.test(execute('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']).trim())) owned = false; }
      catch { owned = false; }
    }
    if (!owned) continue;
    const endpoint = `http://${rows.some((row) => row[1].startsWith('127.0.0.1:')) ? '127.0.0.1' : '[::1]'}:${port}`;
    try {
      const response = await fetchMetadata(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
      const info = response.ok ? await response.json() : undefined;
      if (info?.webSocketDebuggerUrl) {
        const url = new URL(info.webSocketDebuggerUrl);
        if (url.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && Number(url.port) === port && !url.username && !url.password && !url.search && !url.hash && /^\/devtools\/browser\/[\w-]+$/.test(url.pathname)) return { mode: 'hybrid', endpoint };
      }
    } catch { /* The existing metadata file may identify the endpoint instead. */ }
    try {
      const contents = await readFile(path.join(env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data', 'DevToolsActivePort'), 'utf8');
      const [savedPort, browserPath] = contents.trim().split(/\r?\n/);
      if (Number(savedPort) === port && /^\/devtools\/browser\/[\w-]+$/.test(browserPath)) return { mode: 'hybrid', endpoint };
    } catch { /* Do not request permission or reconnect. */ }
  }
  return { mode: 'uia' };
}

export async function assertNoActiveBrowser(env = process.env) {
  const file = path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'SUNAT MCP', 'runtime', 'coordination.sqlite');
  if (!existsSync(file)) return;
  let database;
  try {
    const { default: Database } = await import('better-sqlite3');
    database = new Database(file, { readonly: true, fileMustExist: true });
    const owner = database.prepare('SELECT pid FROM leases WHERE resource = ?').get('existing-brave');
    if (Number.isSafeInteger(owner?.pid)) {
      try { process.kill(owner.pid, 0); }
      catch (error) { if (error.code === 'ESRCH') return; throw error; }
      throw new Error('active_browser');
    }
  } catch { throw new Error('Hay una sesión MCP activa o no se pudo verificar su bloqueo. Detén ese servidor antes de reinstalar; no se interrumpió ni se cambiaron dependencias.'); }
  finally { database?.close(); }
}

export async function planSkill(root, codexDirectory) {
  const directory = path.join(codexDirectory, 'skills', 'sunat-peru');
  const marker = path.join(directory, '.sunat-mcp-managed.json');
  let managed;
  try { managed = JSON.parse(await readFile(marker, 'utf8')); } catch { /* A matching unmanaged skill can be adopted without replacing text. */ }
  const files = [];
  for (const name of skillFiles) {
    const source = path.join(root, '.agents', 'skills', 'sunat', name);
    const destination = path.join(directory, name);
    for (let current = destination; normalize(current).startsWith(normalize(directory)); current = path.dirname(current)) {
      if (await lstat(current).then((entry) => entry.isSymbolicLink()).catch(() => false)) throw new Error('La skill de destino contiene un enlace simbólico; no se modificó.');
      if (current === directory) break;
    }
    const content = await readFile(source);
    const existing = await readFile(destination).catch((error) => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (existing && hash(existing) !== hash(content) && managed?.files?.[name] !== hash(existing)) throw new Error('Ya existe una skill SUNAT ajena o modificada por el usuario. Se conservó; no se sobrescribió.');
    files.push({ name, destination, content, changed: !existing || hash(content) !== hash(existing) });
  }
  return { directory, marker, files };
}

function isSameInstallation(server, root, transport) {
  if (server?.transport?.type !== 'stdio') return false;
  const current = server.transport;
  return current.command === transport.command && JSON.stringify(current.args) === JSON.stringify(transport.args)
    || /^(?:node|node\.exe)$/i.test(path.basename(current.command ?? ''))
      && typeof current.cwd === 'string' && normalize(current.cwd) === normalize(root)
      && JSON.stringify(current.args) === JSON.stringify(['--import', 'tsx', './src/index.ts']);
}

export async function setup({ root = projectRoot, node = process.execPath, env = process.env, platform = process.platform, mode = 'auto', check = false,
  execute = run, locateCodex = findCodex, detect = detectBrowserMode, verify = verifyInstall, log = console.log } = {}) {
  if (platform !== 'win32') throw new Error('La instalación de SUNAT MCP requiere Windows.');
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('La instalación requiere Node.js 20 o posterior; se recomienda 22 o 24.');
  if (!['auto', 'hybrid', 'uia'].includes(mode)) throw new Error('Modo de instalación no válido.');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'sunat-peru-mcp') throw new Error('La carpeta no es una distribución SUNAT MCP.');
  const codexDirectory = path.resolve(env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const cli = await locateCodex(node, env, execute);
  const cliEnv = { ...env, CODEX_HOME: codexDirectory };
  const callCodex = (args) => execute(cli.command, [...cli.args, ...args], { env: cliEnv, cwd: root });
  let servers;
  try { servers = JSON.parse(callCodex(['mcp', 'list', '--json'])); if (!Array.isArray(servers)) throw new Error(); }
  catch { throw new Error('Codex no pudo leer su configuración. Se conservó intacta y no se inició la instalación.'); }
  const existing = servers.find((server) => server.name === 'sunat_peru');
  const transport = { command: node, args: ['--import', pathToFileURL(path.join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href, path.join(root, 'scripts', 'start.mjs')] };
  if (existing && (!isSameInstallation(existing, root, transport) || existing.enabled === false)) throw new Error('La entrada sunat_peru existente apunta a otra instalación o está deshabilitada. Se conservó sin sustituirla.');
  const skill = await planSkill(root, codexDirectory);
  if (check) {
    if (!existing || !existsSync(path.join(root, '.env')) || skill.files.some((file) => file.changed)) throw new Error('La instalación aún no está completa. Ejecuta el instalador sin --check.');
    await verify(transport);
    return { installed: true, registration: 'verified', tools: 7, browserConnected: false };
  }
  const npm = env.npm_execpath || path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(npm)) throw new Error('No se encontró npm junto a Node.js. Repara su instalación antes de continuar.');
  const modules = path.join(root, 'node_modules');
  const stampPath = path.join(modules, '.sunat-install.json');
  const expectedStamp = { schemaVersion: 1, lock: hash(await readFile(path.join(root, 'package-lock.json'))), abi: process.versions.modules };
  let previousStamp;
  try { previousStamp = JSON.parse(await readFile(stampPath, 'utf8')); } catch { /* A first installation has no marker. */ }
  const reuseDependencies = JSON.stringify(previousStamp) === JSON.stringify(expectedStamp)
    && existsSync(path.join(modules, 'tsx', 'dist', 'loader.mjs')) && existsSync(path.join(modules, 'better-sqlite3', 'package.json'));
  if (!reuseDependencies) {
    await assertNoActiveBrowser(env);
    log('Instalando dependencias del proyecto…');
    await withNpmDirectory(root, (cwd) => execute(node, [npm, 'ci', '--no-fund', '--no-audit'], { cwd, env, timeout: 600_000 }));
  } else log('Las dependencias ya corresponden al lockfile y al runtime; se conservan.');
  const configPath = path.join(root, '.env');
  let browser = { mode: 'preserved' };
  if (!existsSync(configPath)) {
    browser = mode === 'auto' ? await detect(env, execute) : { mode, ...(mode === 'hybrid' ? { endpoint: 'http://127.0.0.1:9222' } : {}) };
    let template = await readFile(path.join(root, '.env.example'), 'utf8');
    template = template.replace(/^SUNAT_BROWSER_MODE=.*$/m, `SUNAT_BROWSER_MODE=${browser.mode}`);
    if (browser.endpoint) template = template.replace(/^SUNAT_CDP_ENDPOINT=.*$/m, `SUNAT_CDP_ENDPOINT=${browser.endpoint}`);
    try { await writeFile(configPath, template, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; browser = { mode: 'preserved' }; }
  }
  log('Verificando el servidor sin conectar el navegador…');
  await verify(transport);
  if (!await lstat(modules).then((entry) => entry.isSymbolicLink()).catch(() => false)) {
    await mkdir(modules, { recursive: true });
    await writeFile(stampPath, JSON.stringify(expectedStamp) + '\n', { mode: 0o600 });
  }
  for (const file of skill.files) if (file.changed) { await mkdir(path.dirname(file.destination), { recursive: true }); await writeFile(file.destination, file.content, { mode: 0o600 }); }
  await writeFile(skill.marker, JSON.stringify({ schemaVersion: 1, files: Object.fromEntries(skill.files.map((file) => [file.name, hash(file.content)])) }) + '\n', { mode: 0o600 });
  if (!existing) {
    const config = path.join(codexDirectory, 'config.toml');
    if (existsSync(config)) {
      const backup = path.join(codexDirectory, 'sunat-install-backups');
      await mkdir(backup, { recursive: true });
      await copyFile(config, path.join(backup, `config-${Date.now()}-${randomUUID()}.toml`));
    }
    try { callCodex(['mcp', 'add', 'sunat_peru', '--env', `DOTENV_CONFIG_PATH=${configPath}`, '--', transport.command, ...transport.args]); }
    catch { /* Check the actual persisted result once; never replay an uncertain write. */ }
    let registered;
    try { registered = JSON.parse(callCodex(['mcp', 'get', 'sunat_peru', '--json'])); }
    catch { throw new Error('No se pudo verificar el registro en Codex. No se repitió el registro; la copia local de configuración se conserva.'); }
    if (!isSameInstallation(registered, root, transport) || registered.enabled === false) throw new Error('Codex no confirmó el registro esperado. No se sustituyó ninguna otra integración.');
  }
  log(`Instalación verificada: 7 herramientas; modo ${browser.mode}.`);
  return { installed: true, registration: existing ? 'reused' : 'created', mode: browser.mode, tools: 7, browserConnected: false, activation: 'client_reload_required' };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg, index) => !['--check', '--mode'].includes(arg) && args[index - 1] !== '--mode') || args.includes('--mode') && !['auto', 'hybrid', 'uia'].includes(args[args.indexOf('--mode') + 1])) throw new Error('Argumento no válido. Usa --check o --mode auto|hybrid|uia.');
    const result = await setup({ check: args.includes('--check'), mode: args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'auto' });
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
