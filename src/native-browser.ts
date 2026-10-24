import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { SunatAccountCredential } from './credentials.js';
import { activateBraveElement, captureBraveWindow, focusBraveElement, getBraveAddressBar, getBravePageUiState, getBraveUiState, getBraveUrl, getNativeNavigationMetrics, hasBraveWindows, invokeBraveElement, isSunatTabLabel, loginWithSavedSunatCredentialNatively, NativeUiError, rememberBraveWindow, scrollBraveDocument, selectBraveTab, sendBraveKeys, typeBraveText, typeBraveTextSequence, walkUiaElements, type UiaElement, type UiaWindow } from './windows-ui.js';

const LOGIN_TIMEOUT_MS = 30_000;

export type BrowserStep =
  | { action: 'navigate'; url: string }
  | { action: 'snapshot' }
  | { action: 'click'; ref: string }
  | { action: 'scroll'; direction: 'up' | 'down' | 'left' | 'right' }
  | { action: 'fill'; ref: string; text: string };

export interface BrowserSnapshot { text: string; url: string; fingerprint: string; capturedAt: number }
let latestSnapshot: BrowserSnapshot | undefined;
const latestSelectors = new Map<string, UiaElement>();
let referenceIds = new Map<string, string>();
let nextReferenceId = 1;

export function getLatestBrowserSnapshot(): BrowserSnapshot | undefined {
  if (latestSnapshot && Date.now() - latestSnapshot.capturedAt > 30_000) return undefined;
  return latestSnapshot;
}

function snapshotReference(line: string): string | undefined {
  return line.match(/^\s*@(?<ref>e\d+)\b/)?.groups?.ref
    ?? line.match(/\[ref=(?<ref>e\d+)\]/)?.groups?.ref;
}

export function describeSnapshotReference(snapshot: string, ref: string): { role: string; label: string; raw: string } | undefined {
  const line = snapshot.split(/\r?\n/).find((value) => snapshotReference(value) === ref);
  if (!line) return undefined;
  return describeSnapshotLine(line);
}

function describeSnapshotLine(line: string): { role: string; label: string; raw: string } {
  const roles = 'button|textbox|text field|textfield|password field|checkbox|combobox|link|heading|menuitem|treeitem|tab|option|generic';
  const role = line.match(new RegExp(`\\[(${roles})\\]`, 'i'))?.[1]
    ?? line.match(new RegExp(`^\\s*@e\\d+\\s+(${roles})\\b`, 'i'))?.[1]
    ?? line.match(new RegExp(`^\\s*-\\s*(${roles})\\b`, 'i'))?.[1]
    ?? '';
  const quoted = [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => {
    try { return JSON.parse(`"${match[1]}"`) as string; } catch { return match[1]; }
  });
  const unprefixed = line.replace(/^\s*@e\d+\s+/, '').replace(/^\s*-\s+/, '');
  return { role, label: quoted.at(-1) ?? unprefixed, raw: line.trim() };
}

function normalizeAccessibleLabel(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
}

/** Find fresh, exact interactive references for a known SUNAT menu label. */
export function findSnapshotReferencesByLabel(snapshot: string, label: string): Array<{ ref: string; role: string; label: string }> {
  const wanted = normalizeAccessibleLabel(label);
  const semanticMatches: Array<{ ref: string; role: string; label: string }> = [];
  const genericMatches: Array<{ ref: string; role: string; label: string }> = [];
  for (const line of snapshot.split(/\r?\n/)) {
    const ref = snapshotReference(line);
    if (!ref || /\[disabled\]/.test(line)) continue;
    const reference = describeSnapshotLine(line);
    if (normalizeAccessibleLabel(reference.label) !== wanted) continue;
    const match = { ref, role: reference.role, label: reference.label };
    if (/^(?:button|link|menuitem|treeitem|tab|option)$/i.test(reference.role)) semanticMatches.push(match);
    else if (/^generic$/i.test(reference.role)) genericMatches.push(match);
  }
  return semanticMatches.length ? semanticMatches : genericMatches;
}

export function isAuthenticatedSunatPage(snapshot: { text: string; url: string }): boolean {
  try {
    const url = new URL(snapshot.url);
    return url.protocol === 'https:' && url.hostname.endsWith('.sunat.gob.pe') &&
      (url.hostname === 'e-menu.sunat.gob.pe' || /\/cl-ti-itmenu\/MenuInternet/i.test(url.pathname)) &&
      !/loginMenuSol/i.test(url.pathname) &&
      snapshot.text.split(/\r?\n/).some((line) => /^\s*@e\d+\s+(?:button|link)\s+"(?:salir|cerrar sesi[oó]n|desconectar)"/i.test(line) && !/\[(?:disabled|offscreen)\]/.test(line));
  } catch { return false; }
}

export function isTaxCommitControl(reference: { role: string; label: string }): boolean {
  const text = `${reference.role} ${reference.label}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Some SOL services persist a proposal or file a request with "Generar".
  // Keep its object explicit: generating a report is ordinary consultation.
  return /type=["']submit["']|\b(presentar|presente|enviar|pagar|pague|anular|emitir|registrar|confirmar|aceptar|reemplazar|cancelar|declarar|firmar|finalizar|grabar|guardar|eliminar|excluir|submit|pay|cancel|file|delete)\b/.test(text)
    || normalizeAccessibleLabel(reference.label) === 'generar'
    || /\bgenerar\s+(?:(?:el|la|los|las|un|una)\s+)?(?:registros?|solicitud(?:es)?|pedido(?:s)?(?:\s+de\s+deuda)?)\b/.test(text)
    || /\bactualizar\s+(?:(?:la|el)\s+)?(?:propuesta|datos|informacion|registro)\b/.test(text);
}

export function isSensitiveInput(reference: { role: string; label: string }): boolean {
  const text = `${reference.role} ${reference.label}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /password|passwd|contrasena|clave|usuario|username|user\s*id|token|cookie|secret|credential|autenticacion|authorization/.test(text);
}

export function sanitizeSnapshotForMcp(snapshot: string): string {
  return snapshot.split(/\r?\n/).map((line) => {
    if (/^URL:\s*https:\/\/api-seguridad\.sunat\.gob\.pe\//i.test(line)) {
      try {
        const url = new URL(line.slice(4).trim());
        const loginPath = url.pathname.replace(/\/v1\/clientessol\/[^/]+\/oauth2\/loginMenuSol/i, '/v1/clientessol/[oculto]/oauth2/loginMenuSol');
        if (loginPath !== url.pathname) return `URL: ${url.origin}${loginPath} [parámetros de acceso ocultos]`;
        return `URL: ${url.origin}${url.pathname} [parámetros de acceso ocultos]`;
      } catch { return 'URL: acceso oficial de SUNAT [oculta]'; }
    }
    const legacy = line.match(/^([\t ]*@e\d+\s+)(.*)$/);
    const current = line.match(/^([\t ]*-\s*)(.*\[ref=e\d+\])(.*)$/);
    const match = legacy ?? current;
    if (!match) return line;
    const body = legacy ? match[2] : `${match[2]}${match[3]}`;
    const role = describeSnapshotLine(line).role;
    const quoted = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((item) => item[1].replaceAll('\\"', '"'));
    const label = `${role} ${quoted.at(-1) ?? body}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const input = /^(?:textbox|text field|textfield|password field|combobox)$/.test(role);
    if (input && (isSensitiveInput({ role, label }) || /\b(ruc|dni|documento|identificacion)\b/.test(label) || /\b\d{8,11}\b/.test(label))) {
      return legacy ? `${match[1]}[campo sensible oculto]` : `${match[1]}${match[2]} [campo sensible oculto]`;
    }
    return line.replace(/Value:\s*[^\r\n]*/gi, 'Value: [oculto]');
  }).join('\n');
}

function sanitizePageUrlForMcp(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() === 'api-seguridad.sunat.gob.pe') {
      url.pathname = url.pathname.replace(/\/v1\/clientessol\/[^/]+\/oauth2\/loginMenuSol/i, '/v1/clientessol/[oculto]/oauth2/loginMenuSol');
      url.search = '';
      url.hash = '';
    }
    return url.toString();
  } catch {
    return 'https://api-seguridad.sunat.gob.pe/[URL oculta]';
  }
}

function assertSunatUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('La navegación requiere una URL HTTPS válida de SUNAT.');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !(host === 'sunat.gob.pe' || host.endsWith('.sunat.gob.pe'))) {
    throw new Error('Por seguridad, el MCP solo navega por HTTPS en sunat.gob.pe y sus subdominios.');
  }
}

function findInputRefs(snapshot: string): Array<{ ref: string; line: string }> {
  return snapshot.split(/\r?\n/).flatMap((line) => {
    const ref = snapshotReference(line);
    return ref && /\b(textbox|text field|textfield|password field)\b/i.test(line) ? [{ ref, line }] : [];
  });
}

function findRef(snapshot: string, role: RegExp, label: RegExp): string | undefined {
  for (const line of snapshot.split(/\r?\n/)) {
    const ref = snapshotReference(line);
    if (ref && role.test(line) && label.test(line)) return ref;
  }
  return undefined;
}

function loginPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'sunat.gob.pe' || url.hostname.endsWith('.sunat.gob.pe')) && /loginMenuSol/i.test(url.pathname);
  } catch { return false; }
}

async function selectSunatWindow(state: import('./windows-ui.js').UiaInspectResult, deadlineAt?: number): Promise<UiaWindow> {
  const sunatWindows = (state.windows ?? []).filter((window) => {
    const url = getBraveUrl(window);
    return Boolean(url && (url.hostname === 'sunat.gob.pe' || url.hostname.endsWith('.sunat.gob.pe')));
  });
  if (sunatWindows.length === 1) { rememberBraveWindow(sunatWindows[0]); return sunatWindows[0]; }
  const mainWindows = (state.windows ?? []).filter((window) => window.hwnd && /brave/i.test(window.title ?? ''));
  if (sunatWindows.length === 0 && mainWindows.length === 1) {
    const sunatTabs: UiaElement[] = [];
    walkUiaElements(mainWindows[0].elements ?? [], (element) => {
      if (element.type === 'TabItem' && element.selector && isSunatTabLabel(element.name)) sunatTabs.push(element);
    });
    if (sunatTabs.length === 1) {
      await selectBraveTab(sunatTabs[0].name || sunatTabs[0].selector!, deadlineAt);
      const refreshed = await getBraveUiState(deadlineAt);
      const active = (refreshed.windows ?? []).filter((window) => {
        const url = getBraveUrl(window);
        return Boolean(url && (url.hostname === 'sunat.gob.pe' || url.hostname.endsWith('.sunat.gob.pe')));
      });
      if (active.length === 1) { rememberBraveWindow(active[0]); return active[0]; }
      throw new NativeUiError('tab_not_active', 'La pestaña SUNAT no quedó activa en Brave.');
    }
    if (sunatTabs.length > 1) throw new NativeUiError('ambiguous_tab', 'Brave tiene varias pestañas oficiales SUNAT; no se eligió ninguna.');
    rememberBraveWindow(mainWindows[0]);
    return mainWindows[0];
  }
  throw new NativeUiError('ambiguous_window', 'No se pudo identificar una única ventana de Brave para SUNAT.');
}

function roleForUia(element: UiaElement): string | undefined {
  const type = (element.type ?? '').toLowerCase();
  if (type === 'button') return 'button';
  if (type === 'hyperlink' || type === 'link') return 'link';
  if (type === 'edit') return element.isPassword || /password|clave|contrase/i.test(`${element.name ?? ''} ${element.automationId ?? ''}`) ? 'password field' : 'textbox';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'combobox') return 'combobox';
  if (type === 'tabitem') return 'tab';
  if (type === 'listitem') return 'option';
  if (type === 'menuitem') return 'menuitem';
  if (type === 'treeitem') return 'treeitem';
  if (type === 'radiobutton') return 'option';
  if (element.isInvokable || element.isEditable || type === 'dataitem' || type === 'custom') return 'generic';
  if (type === 'text' || type === 'document' || type === 'group') return 'generic';
  return undefined;
}

export function buildNativeSnapshot(window: UiaWindow, url: URL): { text: string; fingerprint: string } {
  latestSelectors.clear();
  const lines = [`URL: ${sanitizePageUrlForMcp(url.toString())}`];
  const roots: UiaElement[] = [];
  const findRoots = (elements: UiaElement[]) => {
    for (const element of elements) {
      if (element.type === 'Document' && element.isOffscreen !== true) roots.push(element);
      else findRoots(element.children ?? []);
    }
  };
  findRoots(window.elements ?? []);
  if (!roots.length) throw new NativeUiError('no_document', 'Brave todavía no muestra el documento SUNAT.');
  const nextIds = new Map<string, string>();
  const formState: unknown[] = [];
  walkUiaElements(roots, (element) => {
    const isInput = element.type === 'Edit' || element.type === 'ComboBox' || element.isEditable === true;
    const text = element.name || (isInput ? element.automationId || 'Campo de texto' : element.isInvokable ? element.automationId || 'Control sin etiqueta' : '');
    const label = text.replace(/[\r\n]+/g, ' ').trim();
    const role = roleForUia(element);
    if (role && label) {
      if (element.selector && (isInput || element.isInvokable || /^(button|link|checkbox|tab|option|menuitem|treeitem)$/.test(role))) {
        const key = `${window.hwnd}:${element.selector}`;
        const ref = referenceIds.get(key) ?? `e${nextReferenceId++}`;
        nextIds.set(key, ref);
        latestSelectors.set(ref, element);
        lines.push(`@${ref} ${role} ${JSON.stringify(label)}${element.isEnabled === false ? ' [disabled]' : ''}${element.isOffscreen ? ' [offscreen]' : ''}`);
        formState.push([element.selector, element.type, element.name, element.value, element.isEnabled, element.toggleState, element.isSelected]);
      } else {
        lines.push(`- ${role} ${JSON.stringify(label)}`);
      }
    }
  });
  referenceIds = nextIds;
  const text = lines.join('\n');
  return { text, fingerprint: createHash('sha256').update(JSON.stringify([url.toString(), text, formState])).digest('hex') };
}

async function snapshotNative(deadlineAt?: number): Promise<BrowserSnapshot> {
  let state = await getBravePageUiState(deadlineAt);
  if (!(state.windows ?? []).some((window) => {
    const url = getBraveUrl(window);
    return url?.protocol === 'https:' && (url.hostname === 'sunat.gob.pe' || url.hostname.endsWith('.sunat.gob.pe'));
  }) && !(state.windows ?? []).some((window) => getBraveAddressBar(window))) state = await getBraveUiState(deadlineAt); // A scoped read has no tab strip; rediscover it only when needed.
  const window = await selectSunatWindow(state, deadlineAt);
  const url = getBraveUrl(window);
  if (!url) throw new Error('No se pudo leer la página actual de Brave.');
  assertSunatUrl(url.toString());
  const result = buildNativeSnapshot(window, url);
  latestSnapshot = { ...result, url: sanitizePageUrlForMcp(url.toString()), capturedAt: Date.now() };
  return latestSnapshot;
}

async function fillNativeReference(ref: string, text: string, deadlineAt?: number): Promise<void> {
  const element = latestSelectors.get(ref);
  if (!element?.selector) throw new Error('La referencia de Brave ya no está vigente.');
  await focusBraveElement(element.selector, deadlineAt);
  await typeBraveText(text, true, deadlineAt, { automationId: element.automationId, name: element.name, password: false });
}

export async function loginWithSunatAccount(account: SunatAccountCredential | undefined, reuseSession: boolean, requestDeadlineAt?: number): Promise<{ authenticated: boolean; reusedSession: boolean; usedSavedBrowserCredential?: boolean; requiresUserAction?: string; code?: string }> {
  if (!account) return await loginWithSavedSunatCredentialNatively(requestDeadlineAt);
  const deadlineAt = Math.min(requestDeadlineAt ?? Number.POSITIVE_INFINITY, Date.now() + LOGIN_TIMEOUT_MS);
  try {
    try { await snapshotNative(deadlineAt); } catch { latestSnapshot = undefined; }
    let current = getLatestBrowserSnapshot();
    if (!current || (!isAuthenticatedSunatPage(current) && !loginPageUrl(current.url))) {
      await executeBrowserBatch([{ action: 'navigate', url: 'https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?pestana=%2A&agrupacion=%2A' }, { action: 'snapshot' }], deadlineAt);
      current = getLatestBrowserSnapshot();
    }
    if (current && isAuthenticatedSunatPage(current)) {
      if (reuseSession) return { authenticated: true, reusedSession: true };
      const logoutRef = findRef(current.text, /button|link/i, /salir|cerrar sesi[oó]n|desconectar/i);
      if (!logoutRef) return { authenticated: false, reusedSession: false, requiresUserAction: 'El navegador ya tiene otra sesión SUNAT. Ciérrala en la misma ventana y vuelve a intentarlo.' };
      await executeBrowserBatch([{ action: 'click', ref: logoutRef }, { action: 'snapshot' }], deadlineAt);
      current = getLatestBrowserSnapshot();
    }
    if (!current || !loginPageUrl(current.url)) return { authenticated: false, reusedSession: false, requiresUserAction: 'No se pudo verificar el formulario oficial de acceso de SUNAT en Brave.' };

    let modeSnapshot = current;
    const modeAlreadySelected = findInputRefs(current.text).some(({ line }) => new RegExp(`\\b${account.mode}\\b`, 'i').test(line));
    if (!modeAlreadySelected) {
      const modeRef = findRef(current.text, /button/i, new RegExp(`\\b${account.mode}\\b`, 'i'));
      if (!modeRef) return { authenticated: false, reusedSession: false, requiresUserAction: 'SUNAT cambió el formulario de acceso; no se enviaron credenciales.' };
      await executeBrowserBatch([{ action: 'click', ref: modeRef }, { action: 'snapshot' }], deadlineAt);
      const refreshed = getLatestBrowserSnapshot();
      if (!refreshed || !loginPageUrl(refreshed.url)) return { authenticated: false, reusedSession: false, requiresUserAction: 'No se pudo verificar el formulario oficial de acceso.' };
      modeSnapshot = refreshed;
    }

    const fields = findInputRefs(modeSnapshot.text);
    const passwordField = fields.find(({ line }) => /password|passwd|contrase[nñ]a|\bclave\b/i.test(line));
    const loginButton = findRef(modeSnapshot.text, /button/i, /iniciar sesi[oó]n|ingresar|aceptar/i);
    if (!passwordField || !loginButton) return { authenticated: false, reusedSession: false, requiresUserAction: 'El formulario de SUNAT no coincide con el formato esperado; no se enviaron credenciales.' };
    const textFields = fields.filter(({ ref }) => ref !== passwordField.ref);
    const expectedTextFields = account.mode === 'ruc' ? 2 : 1;
    const documentField = textFields.find(({ line }) => new RegExp(`\\b${account.mode}\\b|documento`, 'i').test(line)) ?? textFields[0];
    const usernameField = account.mode === 'ruc'
      ? textFields.find(({ ref, line }) => ref !== documentField?.ref && /usuario|user/i.test(line)) ?? textFields.find(({ ref }) => ref !== documentField?.ref)
      : undefined;
    if (!documentField || textFields.length !== expectedTextFields || (account.mode === 'ruc' && (!usernameField || !account.username))) {
      return { authenticated: false, reusedSession: false, requiresUserAction: 'El formulario de SUNAT no coincide con el formato esperado; no se enviaron credenciales.' };
    }

    const inputs = [{ ref: documentField.ref, text: account.document }, ...(usernameField && account.username ? [{ ref: usernameField.ref, text: account.username }] : []), { ref: passwordField.ref, text: account.password }];
    const firstInput = latestSelectors.get(documentField.ref);
    if (!firstInput?.selector) return { authenticated: false, reusedSession: false, requiresUserAction: 'El formulario cambió; no se enviaron credenciales.' };
    await focusBraveElement(firstInput.selector, deadlineAt);
    await typeBraveTextSequence(inputs.map((input) => input.text), true, deadlineAt, inputs.map((input) => {
      const element = latestSelectors.get(input.ref)!;
      return { automationId: element.automationId, name: element.name, password: input.ref === passwordField.ref };
    }));
    const submitSelector = latestSelectors.get(loginButton)?.selector;
    if (!submitSelector) return { authenticated: false, reusedSession: false, requiresUserAction: 'El botón de acceso cambió; no se envió el formulario.' };
    await invokeBraveElement(submitSelector, deadlineAt);
    await new Promise((resolve) => setTimeout(resolve, Math.min(650, Math.max(0, deadlineAt - Date.now()))));
    await executeBrowserBatch([{ action: 'snapshot' }], deadlineAt);
    const after = getLatestBrowserSnapshot();
    if (after && isAuthenticatedSunatPage(after)) return { authenticated: true, reusedSession: false };
    return { authenticated: false, reusedSession: false, requiresUserAction: 'SUNAT no confirmó el ingreso. Revisa Brave y completa allí cualquier código o verificación solicitada.' };
  } catch {
    return { authenticated: false, reusedSession: false, requiresUserAction: 'No se pudo completar el acceso nativo a SUNAT dentro de 30 segundos. Revisa Brave; no se guardaron las credenciales en el MCP.' };
  }
}
export async function executeBrowserBatch(steps: BrowserStep[], deadlineAt?: number): Promise<unknown> {
  if (process.platform !== 'win32') throw new Error('SUNAT Perú MCP solo está disponible en Windows.');
  const results: unknown[] = [];
  for (const step of steps) {
    try {
      if (step.action === 'navigate') {
        assertSunatUrl(step.url);
        const state = await getBraveUiState(deadlineAt, true, 8);
        const window = await selectSunatWindow(state, deadlineAt);
        const addressBar = getBraveAddressBar(window);
        if (!addressBar?.selector) throw new Error('Brave no expone su barra de direcciones.');
        await focusBraveElement(addressBar.selector, deadlineAt);
        await typeBraveText(step.url, true, deadlineAt, { automationId: addressBar.automationId, name: addressBar.name, password: false });
        await sendBraveKeys('enter', deadlineAt);
        latestSnapshot = undefined;
        latestSelectors.clear();
        referenceIds.clear();
        results.push({ action: 'navigate', url: sanitizePageUrlForMcp(step.url) });
      } else if (step.action === 'snapshot') {
        const fresh = await snapshotNative(deadlineAt);
        results.push({ action: 'snapshot', origin: sanitizePageUrlForMcp(fresh.url), snapshot: sanitizeSnapshotForMcp(fresh.text) });
      } else if (step.action === 'click') {
        const element = latestSelectors.get(step.ref);
        if (!latestSnapshot || !element?.selector) throw new Error('Referencia de interfaz vencida.');
        await activateBraveElement(element, deadlineAt);
        latestSnapshot = undefined;
        latestSelectors.clear();
        results.push({ action: 'click', success: true });
      } else if (step.action === 'scroll') {
        if (!getLatestBrowserSnapshot()) await snapshotNative(deadlineAt);
        await scrollBraveDocument(step.direction, deadlineAt);
        latestSnapshot = undefined;
        latestSelectors.clear();
        results.push({ action: 'scroll', success: true });
      } else {
        const reference = latestSnapshot ? describeSnapshotReference(latestSnapshot.text, step.ref) : undefined;
        if (!reference || isSensitiveInput(reference)) throw new Error('Campo no permitido o referencia vencida.');
        await fillNativeReference(step.ref, step.text, deadlineAt);
        results.push({ action: 'fill', success: true });
      }
    } catch (error) {
      latestSnapshot = undefined;
      latestSelectors.clear();
      results.push({ action: step.action, code: error instanceof NativeUiError ? error.code : 'navigation_failed', error: error instanceof Error && (error instanceof NativeUiError || error.message.includes('HTTPS')) ? error.message : 'No se pudo completar la acción en Brave con UI Automation.' });
      break;
    }
  }
  return results;
}

export async function captureBrowserScreenshot(): Promise<Buffer> {
  const current = await snapshotNative();
  if (loginPageUrl(current.url)) throw new Error('No se captura la pantalla de inicio de sesión para proteger los datos de acceso.');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sunat-mcp-'));
  const screenshotPath = path.join(tempDir, 'active-page.png');
  try {
    await captureBraveWindow(screenshotPath);
    return await readFile(screenshotPath);
  } catch {
    throw new Error('No se pudo capturar la ventana actual de Brave.');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function getNativeBrowserStatus(): Promise<{ connected: boolean; session: string; browserName?: string; message?: string; metrics?: ReturnType<typeof getNativeNavigationMetrics> }> {
  if (process.platform !== 'win32') return { connected: false, session: 'windows-native', message: 'SUNAT Perú MCP solo está disponible en Windows.' };
  try {
    const connected = await hasBraveWindows();
    return { connected, session: 'windows-native', browserName: 'Brave predeterminado del usuario', metrics: getNativeNavigationMetrics() };
  } catch {
    return { connected: false, session: 'windows-native', message: 'No se pudo acceder a la interfaz del Brave que ya está abierto.' };
  }
}
