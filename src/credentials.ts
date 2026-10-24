import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type SunatLoginMode = 'ruc' | 'dni';

export interface SunatSireApiCredential {
  clientId: string;
  clientSecret: string;
}

export interface SunatAccountCredential {
  accountKey: string;
  mode: SunatLoginMode;
  document: string;
  username?: string;
  password: string;
  sireApi?: SunatSireApiCredential;
}

interface VaultPayload {
  version: 1;
  accounts: SunatAccountCredential[];
}

interface VaultEnvelope {
  version: 1;
  encrypted: string;
}

const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
const vaultDirectory = path.join(localAppData, 'SUNAT MCP', 'credentials');
const vaultPath = path.join(vaultDirectory, 'accounts.dpapi.json');
const maxAccounts = 500;
const maxSecretPayloadBytes = 2_000_000;

const protectScript = [
  '$ErrorActionPreference = "Stop"',
  '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '$plain = [Console]::In.ReadToEnd()',
  '$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force',
  '[Console]::Out.Write((ConvertFrom-SecureString -SecureString $secure))',
].join('; ');

const unprotectScript = [
  '$ErrorActionPreference = "Stop"',
  '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '$cipher = [Console]::In.ReadToEnd()',
  '$secure = ConvertTo-SecureString -String $cipher',
  '$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
  'try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }',
].join('; ');

export function normalizeAccountKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-PE');
}

function runDpapi(script: string, input: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('El almacén cifrado de cuentas solo funciona en Windows.');
  if (Buffer.byteLength(input, 'utf8') > maxSecretPayloadBytes) throw new Error('La planilla supera el límite permitido para credenciales.');
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
    }, 15_000);
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
  if (!account.accountKey.trim() || account.accountKey.length > 160) throw new Error('Cada fila requiere un nombre de cuenta único de hasta 160 caracteres.');
  if (account.mode !== 'ruc' && account.mode !== 'dni') throw new Error('El tipo de documento debe ser RUC o DNI.');
  const document = account.document.replace(/\D/g, '');
  if (document !== account.document || (account.mode === 'ruc' ? document.length !== 11 : document.length !== 8)) {
    throw new Error('La columna de RUC/DNI contiene un valor con formato incorrecto.');
  }
  if (account.mode === 'ruc' && !account.username?.trim()) throw new Error('Cada cuenta de acceso por RUC requiere su usuario SOL.');
  if (!account.password || account.password.length > 256) throw new Error('La columna de Clave SOL contiene un valor vacío o demasiado largo.');
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
  if (envelope.version !== 1 || typeof envelope.encrypted !== 'string') throw new Error('El almacén de credenciales tiene un formato desconocido.');
  let decrypted: string;
  try {
    decrypted = await runDpapi(unprotectScript, envelope.encrypted);
  } catch {
    throw new Error('No se pudo descifrar el almacén. Inícialo desde la misma cuenta de Windows que lo importó.');
  }
  try {
    const payload = JSON.parse(decrypted) as VaultPayload;
    if (payload.version !== 1 || !Array.isArray(payload.accounts) || payload.accounts.length > maxAccounts) throw new Error('invalid');
    for (const account of payload.accounts) validateAccount(account);
    return payload;
  } catch {
    throw new Error('El almacén descifrado no cumple el formato esperado.');
  }
}

export async function saveSunatAccountCredentials(imported: SunatAccountCredential[]): Promise<{ added: number; updated: number }> {
  if (imported.length === 0 || imported.length > maxAccounts) throw new Error(`La importación debe contener entre 1 y ${maxAccounts} cuentas.`);
  const byKey = new Map<string, SunatAccountCredential>();
  for (const account of imported) {
    validateAccount(account);
    const normalized = normalizeAccountKey(account.accountKey);
    if (byKey.has(normalized)) throw new Error('La planilla tiene nombres de cuenta duplicados. Asigna un nombre único a cada cuenta y repite la importación.');
    byKey.set(normalized, account);
  }

  const existing = await readVault();
  const merged = new Map(existing.accounts.map((account) => [normalizeAccountKey(account.accountKey), account]));
  let added = 0;
  let updated = 0;
  for (const [key, account] of byKey) {
    if (merged.has(key)) updated++;
    else added++;
    const previous = merged.get(key);
    merged.set(key, account.sireApi || !previous?.sireApi ? account : { ...account, sireApi: previous.sireApi });
  }
  if (merged.size > maxAccounts) throw new Error(`El almacén no puede superar ${maxAccounts} cuentas.`);
  const plaintext = JSON.stringify({ version: 1, accounts: [...merged.values()] } satisfies VaultPayload);
  const encrypted = await runDpapi(protectScript, plaintext);
  const envelope: VaultEnvelope = { version: 1, encrypted };
  await mkdir(vaultDirectory, { recursive: true });
  const tempPath = `${vaultPath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(envelope)}\n`, { encoding: 'utf8', flag: 'w' });
  await rename(tempPath, vaultPath);
  return { added, updated };
}

export async function findSunatAccountCredential(accountKey?: string): Promise<SunatAccountCredential> {
  const payload = await readVault();
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

/** Return non-identifying local vault status; never exposes account names or secrets. */
export async function getSunatCredentialVaultStatus(): Promise<{ vaultAvailable: boolean; credentialCount: number }> {
  const payload = await readVault();
  return { vaultAvailable: payload.accounts.length > 0, credentialCount: payload.accounts.length };
}
