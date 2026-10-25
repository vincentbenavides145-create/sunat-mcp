import type { SunatAccountCredential } from './credentials.js';
import { createHash } from 'node:crypto';

export interface AccountBinding { id: string; key: string; ruc: string; credentialVersion: string }
export function bindAccount(account: SunatAccountCredential): AccountBinding {
  const ruc = account.mode === 'ruc' ? account.document : account.sessionRuc;
  if (!account.id || !ruc || !/^\d{11}$/.test(ruc)) throw new Error('Esta cuenta requiere un RUC de sesión esperado en la bóveda antes de operar. Para acceso DNI, importa también su RUC de sesión.');
  return { id: account.id, key: account.accountKey, ruc, credentialVersion: createHash('sha256').update(JSON.stringify([account.mode, account.document, account.username, account.password])).digest('hex') };
}
export function assertAccountRuc(expected: string, actual?: string): void {
  if (!actual || !/^\d{11}$/.test(actual)) throw new Error('No se pudo verificar el RUC en la cabecera autenticada de SUNAT. No se ejecutó la operación.');
  if (actual !== expected) throw new Error('La cuenta activa en SUNAT no coincide con la cuenta solicitada. Se invalidó el contexto; no se ejecutó la operación.');
}

/** Parse only an already-scoped, rendered account header, never a receiver/form field or page body. */
export function rucFromHeader(text: string): string | undefined {
  const values = [...new Set([...text.matchAll(/\bRUC\s*[:#-]?\s*(\d{11})(?!\d)/gi)].map((match) => match[1]))];
  return values.length === 1 ? values[0] : undefined;
}
