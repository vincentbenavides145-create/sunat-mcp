import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { operatorDirectory } from './operator-storage.js';
import { ProcessLease } from './process-lease.js';

export type SunatLoginMode = 'ruc' | 'dni';

export interface SunatSireApiCredential {
  clientId: string;
  clientSecret: string;
}

export interface SunatAccountCredential {
  id?: string;
  taxpayerId?: string;
  accountKey: string;
  mode: SunatLoginMode;
  document: string;
  username?: string;
  password: string;
  sessionRuc?: string;
  sireApi?: SunatSireApiCredential;
}

interface VaultPayload {
  version: 1;
  accounts: SunatAccountCredential[];
  operationKey?: string;
}

interface VaultEnvelope {
  version: 1;
  encrypted: string;
  encoding?: 'utf8-dpapi';
}

const vaultDirectory = path.join(operatorDirectory(), 'credentials');
const vaultPath = path.join(vaultDirectory, 'accounts.dpapi.json');
const maxSecretPayloadBytes = 2_000_000;
const vaultLease = new ProcessLease('vault-' + createHash('sha256').update(vaultPath).digest('hex'));
let vaultWrites: Promise<unknown> = Promise.resolve();

const protectScript = [
  '$ErrorActionPreference = "Stop"',
  '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '$plain = [Console]::In.ReadToEnd()',
  'Add-Type -AssemblyName System.Security',
  '$bytes = [Text.Encoding]::UTF8.GetBytes($plain)',
  'try { $cipher = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($cipher)) } finally { [Array]::Clear($bytes, 0, $bytes.Length) }',
].join('; ');

const legacyUnprotectScript = [
  '$ErrorActionPreference = "Stop"',
  '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '$cipher = [Console]::In.ReadToEnd()',
  '$secure = ConvertTo-SecureString -String $cipher',
  '$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
  'try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }',
].join('; ');

const unprotectScript = [
  '$ErrorActionPreference = "Stop"',
  '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
  'Add-Type -AssemblyName System.Security',
  '$cipher = [Convert]::FromBase64String([Console]::In.ReadToEnd())',
  '$bytes = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  'try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes)) } finally { [Array]::Clear($bytes, 0, $bytes.Length) }',
].join('; ');

export function normalizeAccountKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-PE');
}

function runDpapi(script: string, input: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('El almacén cifrado de cuentas solo funciona en Windows.');
  const maxInput = script === protectScript ? maxSecretPayloadBytes : maxSecretPayloadBytes * 2;
  if (Buffer.byteLength(input, 'utf8') > maxInput) throw new Error('La planilla supera el límite permitido para credenciales.');
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, Path: process.env.Path ?? process.env.PATH },
    });
    const stdout: Buffer[] = [];
    let length = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Windows no respondió al proteger las credenciales.'));
    }, 60_000);
    child.stdout.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > maxSecretPayloadBytes * 2) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          reject(new Error('La respuesta del almacén de credenciales superó el límite permitido.'));
        }
        return;
      }
      stdout.push(chunk);
    });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('No se pudo iniciar el servicio local de protección de credenciales de Windows.'));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error('Windows no pudo proteger o recuperar las credenciales.'));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8').trim());
    });
    child.stdin.end(input, 'utf8');
  });
}

function validateAccount(account: SunatAccountCredential): void {
  if (account.id !== undefined && !/^[a-f0-9-]{36}$/.test(account.id)) throw new Error('Identificador local de cuenta no válido.');
  if (account.taxpayerId !== undefined && !/^[a-f0-9-]{36}$/.test(account.taxpayerId)) throw new Error('Identificador local de contribuyente no válido.');
  if (!account.accountKey.trim() || account.accountKey.length > 160) throw new Error('Cada fila requiere un nombre de cuenta único de hasta 160 caracteres.');
  if (account.mode !== 'ruc' && account.mode !== 'dni') throw new Error('El tipo de documento debe ser RUC o DNI.');
  const document = account.document.replace(/\D/g, '');
  if (document !== account.document || (account.mode === 'ruc' ? document.length !== 11 : document.length !== 8)) {
    throw new Error('La columna de RUC/DNI contiene un valor con formato incorrecto.');
  }
  if (account.mode === 'ruc' && !account.username?.trim()) throw new Error('Cada cuenta de acceso por RUC requiere su usuario SOL.');
  if (!account.password || account.password.length > 256) throw new Error('La columna de Clave SOL contiene un valor vacío o demasiado largo.');
  if (account.sessionRuc !== undefined && (!/^\d{11}$/.test(account.sessionRuc) || account.mode === 'ruc' && account.sessionRuc !== account.document)) throw new Error('El RUC de sesión esperado no coincide con el formato de la cuenta.');
  if (account.sireApi !== undefined) {
    if (account.mode !== 'ruc' || !account.username?.trim()) throw new Error('Las credenciales API SIRE requieren una cuenta con RUC y usuario SOL.');
    if (typeof account.sireApi.clientId !== 'string' || !account.sireApi.clientId.trim() || account.sireApi.clientId.length > 256
      || typeof account.sireApi.clientSecret !== 'string' || !account.sireApi.clientSecret.trim() || account.sireApi.clientSecret.length > 2048) {
      throw new Error('Las credenciales API SIRE están incompletas o superan el límite permitido.');
    }
  }
}

async function readVault(): Promise<VaultPayload> {
  let envelope: VaultEnvelope;
  try {
    envelope = JSON.parse(await readFile(vaultPath, 'utf8')) as VaultEnvelope;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { version: 1, accounts: [] };
    throw new Error('No se pudo leer el almacén local de credenciales.');
  }
  if (envelope.version !== 1 || typeof envelope.encrypted !== 'string' || envelope.encoding !== undefined && envelope.encoding !== 'utf8-dpapi') throw new Error('El almacén de credenciales tiene un formato desconocido.');
  let decrypted: string;
  try {
    decrypted = await runDpapi(envelope.encoding === 'utf8-dpapi' ? unprotectScript : legacyUnprotectScript, envelope.encrypted);
  } catch {
    throw new Error('No se pudo descifrar el almacén. Inícialo desde la misma cuenta de Windows que lo importó.');
  }
  try {
    const payload = JSON.parse(decrypted) as VaultPayload;
    if (payload.version !== 1 || !Array.isArray(payload.accounts)) throw new Error('invalid');
    if (payload.operationKey !== undefined && !/^[a-f0-9]{64}$/.test(payload.operationKey)) throw new Error('invalid');
    const ids = new Set<string>();
    for (const account of payload.accounts) validateAccount(account);
    for (const account of payload.accounts) if (account.id) { if (ids.has(account.id)) throw new Error('invalid'); ids.add(account.id); }
    return payload;
  } catch {
    throw new Error('El almacén descifrado no cumple el formato esperado.');
  }
}

export async function saveSunatAccountCredentials(imported: SunatAccountCredential[]): Promise<{ added: number; updated: number }> {
  if (imported.length === 0) throw new Error('La importación debe contener al menos una cuenta.');
  const byKey = new Map<string, SunatAccountCredential>();
  for (const account of imported) {
    validateAccount(account);
    const normalized = normalizeAccountKey(account.accountKey);
    if (byKey.has(normalized)) throw new Error('La planilla tiene nombres de cuenta duplicados. Asigna un nombre único a cada cuenta y repite la importación.');
    byKey.set(normalized, account);
  }

  return await mutateVault(async (existing) => {
  const merged = new Map(existing.accounts.map((account) => [normalizeAccountKey(account.accountKey), account]));
  let added = 0;
  let updated = 0;
  for (const [key, account] of byKey) {
    if (merged.has(key)) updated++;
    else added++;
    const previous = merged.get(key);
    const sameIdentity = previous?.document === account.document && previous.mode === account.mode && previous.sessionRuc === account.sessionRuc;
    merged.set(key, { ...account, id: sameIdentity ? previous.id ?? randomUUID() : randomUUID(), taxpayerId: sameIdentity ? previous.taxpayerId : undefined, ...(!account.sireApi && sameIdentity && previous?.sireApi ? { sireApi: previous.sireApi } : {}) });
  }
  existing.accounts = [...merged.values()];
  return { added, updated };
  });
}

async function mutateVault<T>(mutation: (payload: VaultPayload) => Promise<T>): Promise<T> {
  const pending = vaultWrites.then(async () => {
    vaultLease.acquire();
    try {
      const payload = await readVault();
      const result = await mutation(payload);
      payload.operationKey ??= randomBytes(32).toString('hex');
      for (const account of payload.accounts) account.id ??= randomUUID();
      const taxpayers = new Map<string, string>();
      const identity = (account: SunatAccountCredential) => account.mode === 'ruc' ? account.document : account.sessionRuc ?? `dni:${account.document}`;
      for (const account of payload.accounts) if (account.taxpayerId) taxpayers.set(identity(account), account.taxpayerId);
      for (const account of payload.accounts) {
        account.taxpayerId = taxpayers.get(identity(account)) ?? randomUUID();
        taxpayers.set(identity(account), account.taxpayerId);
      }
      await writeVault(payload);
      return result;
    } finally { vaultLease.release(); }
  });
  vaultWrites = pending.catch(() => undefined);
  return pending;
}

async function writeVault(payload: VaultPayload): Promise<void> {
  const plaintext = JSON.stringify(payload);
  const encrypted = await runDpapi(protectScript, plaintext);
  const envelope: VaultEnvelope = { version: 1, encrypted, encoding: 'utf8-dpapi' };
  await mkdir(vaultDirectory, { recursive: true });
  const tempPath = `${vaultPath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(envelope)}\n`, { encoding: 'utf8', flag: 'w' });
  await rename(tempPath, vaultPath);
}

async function operationalVault(): Promise<VaultPayload> {
  const payload = await readVault();
  if (payload.operationKey && payload.accounts.every((account) => account.id && account.taxpayerId)) return payload;
  return await mutateVault(async (current) => current);
}

export async function findSunatAccountCredential(accountKey?: string): Promise<SunatAccountCredential> {
  const payload = await operationalVault();
  if (!accountKey?.trim()) {
    if (payload.accounts.length === 1) return payload.accounts[0];
    if (payload.accounts.length === 0) throw new Error('No hay cuentas importadas en el almacén local.');
    throw new Error('Hay varias cuentas importadas. Indica cuál usar por el nombre registrado en la planilla.');
  }
  const normalized = normalizeAccountKey(accountKey);
  const account = payload.accounts.find((entry) => normalizeAccountKey(entry.accountKey) === normalized);
  if (!account) throw new Error('No se encontró una coincidencia exacta en el almacén local. Revisa el nombre de cuenta o vuelve a importar la planilla.');
  return account;
}

/** Metadata and HMAC key remain local; the ledger stores only opaque IDs/digests. */
export async function getOperationalVault(): Promise<{ key: Buffer; accounts: SunatAccountCredential[] }> {
  const payload = await operationalVault();
  return { key: Buffer.from(payload.operationKey!, 'hex'), accounts: payload.accounts };
}

/** Return non-identifying local vault status; never exposes account names or secrets. */
export async function getSunatCredentialVaultStatus(): Promise<{ vaultAvailable: boolean; credentialCount: number }> {
  const payload = await readVault();
  return { vaultAvailable: payload.accounts.length > 0, credentialCount: payload.accounts.length };
}
