import { createHash } from 'node:crypto';

/**
 * Safe diagnostics for CDP failures.
 *
 * A raw Playwright/page exception can embed page text, URLs, selectors, RUC/DNI values or form data, and the
 * project forbids exposing those in errors, logs or procedure documents. This module therefore never forwards
 * the original message: it classifies it into a closed set of reasons and adds only technical booleans and a
 * short digest of the normalised message so repeated occurrences can be correlated.
 */
export type CdpFailureStage = 'read' | 'frame' | 'element' | 'click';

export type CdpFailureReason =
  | 'execution_context_destroyed'
  | 'frame_detached'
  | 'target_closed'
  | 'connection_closed'
  | 'timeout'
  | 'serialization'
  | 'adapter_exception'
  | 'unknown';

export interface CdpDiagnostic {
  stage: CdpFailureStage;
  reason: CdpFailureReason;
  /** Fixed adapter operation name (snapshot, account, element...), only when it matches a strict pattern. */
  operation?: string;
  /** Standard JavaScript error class, or `Other`. Never an arbitrary name. */
  errorName: string;
  frameDetached?: boolean;
  pageClosed?: boolean;
  loginPage?: boolean;
  /** First 8 hex characters of a hash of the normalised message; correlates repeats without exposing content. */
  digest: string;
}

export interface CdpFailureContext {
  stage: CdpFailureStage;
  operation?: unknown;
  frameDetached?: boolean;
  pageClosed?: boolean;
  loginPage?: boolean;
}

// Order matters: the first match wins and the more specific messages come first.
const reasonPatterns: ReadonlyArray<readonly [CdpFailureReason, RegExp]> = [
  ['execution_context_destroyed', /execution context was destroyed|cannot find context with specified id|inspected target navigated or closed/i],
  ['frame_detached', /frame (?:was|has been|got) detached|detached frame/i],
  ['target_closed', /target (?:page, context or browser has been )?closed|(?:page|context|browser) has been closed/i],
  ['connection_closed', /connection closed|websocket|session closed|browser has disconnected|connection terminated/i],
  ['timeout', /timeout\s*\d*\s*ms exceeded|timed out/i],
  ['serialization', /object reference chain is too long|do not know how to serialize|circular|not serializable|cannot serialize/i],
];

const knownErrorNames = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'EvalError', 'URIError', 'TimeoutError']);
const adapterErrorNames = new Set(['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'EvalError']);

const stages: ReadonlySet<string> = new Set<CdpFailureStage>(['read', 'frame', 'element', 'click']);
const reasons: ReadonlySet<string> = new Set<CdpFailureReason>(['execution_context_destroyed', 'frame_detached', 'target_closed', 'connection_closed', 'timeout', 'serialization', 'adapter_exception', 'unknown']);

/**
 * Rebuild a diagnostic from an untrusted value (for example one copied between result layers).
 * Only whitelisted fields with strictly validated values survive; anything else is dropped.
 */
export function sanitizeCdpDiagnostic(value: unknown): CdpDiagnostic | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.stage !== 'string' || !stages.has(raw.stage) || typeof raw.reason !== 'string' || !reasons.has(raw.reason)) return undefined;
  const bool = (key: string) => (typeof raw[key] === 'boolean' ? { [key]: raw[key] as boolean } : {});
  return {
    stage: raw.stage as CdpFailureStage,
    reason: raw.reason as CdpFailureReason,
    ...(typeof raw.operation === 'string' && /^[a-z][a-z-]{0,31}$/.test(raw.operation) ? { operation: raw.operation } : {}),
    errorName: typeof raw.errorName === 'string' && (raw.errorName === 'Other' || knownErrorNames.has(raw.errorName)) ? raw.errorName : 'Other',
    ...bool('frameDetached'),
    ...bool('pageClosed'),
    ...bool('loginPage'),
    digest: typeof raw.digest === 'string' && /^[0-9a-f]{8}$/.test(raw.digest) ? raw.digest : '00000000',
  };
}

/** Human-readable (Spanish) description of each reason, safe to show to the person and the model. */
export const cdpReasonDescriptions: Readonly<Record<CdpFailureReason, string>> = {
  execution_context_destroyed: 'la página navegó o se recargó durante la operación',
  frame_detached: 'el marco de la página se desprendió durante la operación',
  target_closed: 'la pestaña, el contexto o Brave se cerró',
  connection_closed: 'la conexión CDP se cerró',
  timeout: 'la operación superó el tiempo límite',
  serialization: 'el resultado de la página no se pudo serializar',
  adapter_exception: 'el adaptador local de la página lanzó una excepción',
  unknown: 'causa no clasificada',
};

/** Reasons where the page itself changed underneath the operation, so a fresh read is the correct next step. */
export function isPageChangeReason(reason: CdpFailureReason): boolean {
  return reason === 'execution_context_destroyed' || reason === 'frame_detached';
}

function readMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : '';
}

function readName(error: unknown): string {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && knownErrorNames.has(name) ? name : 'Other';
}

/** Strip everything that could carry page data before hashing, so the digest only reflects the message shape. */
function normalise(message: string): string {
  return message
    .slice(0, 400)
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '<q>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyCdpFailure(error: unknown): { reason: CdpFailureReason; errorName: string } {
  const message = readMessage(error);
  const errorName = readName(error);
  for (const [reason, pattern] of reasonPatterns) if (pattern.test(message)) return { reason, errorName };
  return { reason: adapterErrorNames.has(errorName) ? 'adapter_exception' : 'unknown', errorName };
}

export function diagnoseCdpFailure(error: unknown, context: CdpFailureContext): CdpDiagnostic {
  const { reason, errorName } = classifyCdpFailure(error);
  const operation = typeof context.operation === 'string' && /^[a-z][a-z-]{0,31}$/.test(context.operation) ? context.operation : undefined;
  return {
    stage: context.stage,
    reason,
    ...(operation ? { operation } : {}),
    errorName,
    ...(context.frameDetached !== undefined ? { frameDetached: context.frameDetached } : {}),
    ...(context.pageClosed !== undefined ? { pageClosed: context.pageClosed } : {}),
    ...(context.loginPage !== undefined ? { loginPage: context.loginPage } : {}),
    digest: createHash('sha256').update(normalise(readMessage(error))).digest('hex').slice(0, 8),
  };
}

/** Spanish message for a classified failure. Mentions the technical cause but never the original text. */
export function describeCdpFailure(diagnostic: CdpDiagnostic, base: string): string {
  const detail = `${base} (causa: ${cdpReasonDescriptions[diagnostic.reason]}).`;
  return isPageChangeReason(diagnostic.reason) ? `${detail} La página cambió; obtén una lectura nueva antes de continuar.` : detail;
}
