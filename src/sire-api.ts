import type { SunatAccountCredential } from './credentials.js';

const SIRE_SCOPE = 'https://api-sire.sunat.gob.pe';
const TOKEN_BASE_URL = 'https://api-seguridad.sunat.gob.pe/v1/clientessol';

export type SireAccessStatus =
  | 'no_configurada'
  | 'cuenta_no_compatible'
  | 'validada'
  | 'api_credenciales_rechazadas'
  | 'sol_credenciales_rechazadas'
  | 'permiso_sire_no_habilitado'
  | 'rechazo_sunat'
  | 'error_temporal';

export interface SireAccessCheck {
  status: SireAccessStatus;
  message: string;
  checkedAt: string;
  networkAttempted: boolean;
}

interface OAuthErrorResponse {
  error?: unknown;
}

function result(status: SireAccessStatus, message: string, networkAttempted: boolean): SireAccessCheck {
  return { status, message, checkedAt: new Date().toISOString(), networkAttempted };
}

function timeoutMs(): number {
  const configured = Number(process.env.SUNAT_TIMEOUT_MS ?? 15000);
  return Number.isInteger(configured) && configured >= 1000 && configured <= 120000 ? configured : 15000;
}

function classifyOAuthError(code: unknown): { status: SireAccessStatus; message: string } | undefined {
  if (typeof code !== 'string') return undefined;
  switch (code.toLowerCase()) {
    case 'invalid_client':
      return { status: 'api_credenciales_rechazadas', message: 'SUNAT rechazó las credenciales de la aplicación API.' };
    case 'invalid_grant':
      return { status: 'sol_credenciales_rechazadas', message: 'SUNAT rechazó el usuario SOL o la Clave SOL de esta cuenta.' };
    case 'unauthorized_client':
    case 'invalid_scope':
    case 'access_denied':
      return { status: 'permiso_sire_no_habilitado', message: 'La aplicación no tiene habilitado el acceso API requerido para SIRE.' };
    default:
      return undefined;
  }
}

export async function checkSireApiAccess(account: SunatAccountCredential): Promise<SireAccessCheck> {
  if (!account.sireApi) {
    return result('no_configurada', 'Esta cuenta no tiene credenciales API SIRE guardadas localmente.', false);
  }
  if (account.mode !== 'ruc' || account.document.length !== 11 || !account.username?.trim()) {
    return result('cuenta_no_compatible', 'La autenticación API SIRE requiere una cuenta con RUC y usuario SOL.', false);
  }

  const url = `${TOKEN_BASE_URL}/${encodeURIComponent(account.sireApi.clientId)}/oauth2/token/`;
  const form = new URLSearchParams({
    grant_type: 'password',
    scope: SIRE_SCOPE,
    client_id: account.sireApi.clientId,
    client_secret: account.sireApi.clientSecret,
    username: `${account.document}${account.username}`,
    password: account.password,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(timeoutMs()),
    });

    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        return result('error_temporal', `SUNAT no pudo validar la conexión ahora (HTTP ${response.status}).`, true);
      }
      const errorBody = await response.json().catch(() => null) as OAuthErrorResponse | null;
      const classified = classifyOAuthError(errorBody?.error);
      if (classified) return result(classified.status, classified.message, true);
      return result('rechazo_sunat', `SUNAT rechazó la validación de acceso (HTTP ${response.status}).`, true);
    }

    const token = await response.json().catch(() => null) as { access_token?: unknown } | null;
    if (typeof token?.access_token !== 'string' || !token.access_token) {
      return result('rechazo_sunat', 'SUNAT respondió sin confirmar el acceso API SIRE.', true);
    }
    return result('validada', 'SUNAT emitió un token: la cuenta y la aplicación tienen acceso API SIRE.', true);
  } catch {
    return result('error_temporal', 'No se pudo contactar a SUNAT para validar el acceso. Revisa la conexión e inténtalo de nuevo.', true);
  }
}
