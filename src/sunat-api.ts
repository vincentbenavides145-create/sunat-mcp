import { createHash } from 'node:crypto';

const API_SCOPE = 'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes';
const TOKEN_BASE_URL = 'https://api-seguridad.sunat.gob.pe/v1/clientesextranet';
const CPE_API_BASE_URL = 'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes';

export interface SunatConfig {
  ruc: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
}

export interface ValidateCpeInput {
  issuerRuc: string;
  documentType: string;
  series: string;
  number: number;
  issueDate: string;
  amount?: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const tokenRequests = new Map<string, Promise<string>>();

function tokenCacheKey(config: SunatConfig): string {
  return createHash('sha256').update(`${config.ruc}\0${config.clientId}\0${config.clientSecret}`).digest('hex');
}

export interface SunatCpeResponse {
  success?: boolean;
  message?: string;
  data?: {
    estadoCp?: string | number;
    estadoRuc?: string;
    condDomiRuc?: string;
    Observaciones?: string[];
    observaciones?: string[];
  };
  errorCode?: string;
}

export function readSunatConfig(env: NodeJS.ProcessEnv = process.env): SunatConfig | null {
  const { SUNAT_RUC, SUNAT_CLIENT_ID, SUNAT_CLIENT_SECRET } = env;
  if (!SUNAT_RUC || !SUNAT_CLIENT_ID || !SUNAT_CLIENT_SECRET) return null;

  const timeoutValue = Number(env.SUNAT_TIMEOUT_MS ?? 15000);
  return {
    ruc: SUNAT_RUC.trim(),
    clientId: SUNAT_CLIENT_ID.trim(),
    clientSecret: SUNAT_CLIENT_SECRET,
    timeoutMs: Number.isInteger(timeoutValue) && timeoutValue >= 1000 ? timeoutValue : 15000,
  };
}

export async function validateCpe(config: SunatConfig, input: ValidateCpeInput): Promise<SunatCpeResponse> {
  const url = `${CPE_API_BASE_URL}/${config.ruc}/validarcomprobante`;
  const body = {
    numRuc: input.issuerRuc,
    codComp: input.documentType,
    numeroSerie: input.series,
    numero: input.number,
    fechaEmision: input.issueDate,
    ...(input.amount === undefined ? {} : { monto: input.amount }),
  };

  const send = (token: string) => fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  let response = await send(await getAccessToken(config));
  if (response.status === 401) {
    tokenCache.delete(tokenCacheKey(config));
    response = await send(await getAccessToken(config));
  }

  if (!response.ok) {
    throw new Error(`SUNAT rechazó la consulta del comprobante (HTTP ${response.status}).`);
  }

  return (await response.json()) as SunatCpeResponse;
}

async function getAccessToken(config: SunatConfig): Promise<string> {
  const key = tokenCacheKey(config);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  tokenCache.delete(key);
  const existingRequest = tokenRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = requestAccessToken(config, key);
  tokenRequests.set(key, request);
  try {
    return await request;
  } finally {
    tokenRequests.delete(key);
  }
}

async function requestAccessToken(config: SunatConfig, key: string): Promise<string> {
  const url = `${TOKEN_BASE_URL}/${encodeURIComponent(config.clientId)}/oauth2/token/`;
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: API_SCOPE,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form,
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`SUNAT no pudo emitir el token de acceso (HTTP ${response.status}).`);
  }

  const token = (await response.json()) as TokenResponse;
  if (!token.access_token) throw new Error('SUNAT respondió sin un token de acceso válido.');
  if (typeof token.expires_in === 'number' && Number.isFinite(token.expires_in) && token.expires_in > 60) {
    tokenCache.set(key, { value: token.access_token, expiresAt: Date.now() + (token.expires_in - 60) * 1000 });
  }
  return token.access_token;
}
