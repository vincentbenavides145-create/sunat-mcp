import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildApprovalFingerprint } from './approval-state.js';
import { beginBravePageContext, scrollBraveElementIntoView } from './windows-ui.js';
import { browserMode, getCdpBrowser, getCdpConnectionState } from './cdp-browser.js';
import { isSunatLoginUrl, isSunatSessionPageUrl } from './browser-context.js';
import type { SunatAccountCredential } from './credentials.js';
import { assertAccountRuc, rucFromHeader } from './account-session.js';
import { acquireBrowserLease } from './process-lease.js';
import { activateBraveElement, captureBraveWindow, findBraveRouteControl, focusBraveElement, getBraveAddressBar, getBravePageUiState, getBraveUiState, getBraveUrl, getNativeNavigationMetrics, hasBraveWindows, invokeBraveElement, isSunatTabLabel, loginWithSavedSunatCredentialNatively, NativeUiError, rememberBraveWindow, scrollBraveDocument, selectBraveTab, sendBraveKeys, typeBraveText, typeBraveTextSequence, walkUiaElements, type UiaElement, type UiaWindow, type UiaSearchResult } from './windows-ui.js';

const LOGIN_TIMEOUT_MS = 30_000;

export type BrowserStep =
  | { action: 'navigate'; url: string }
  | { action: 'snapshot' }
  | { action: 'click'; ref: string }
  | { action: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; ref?: never }
  | { action: 'scroll'; ref: string; direction?: never }
  | { action: 'fill'; ref: string; text: string };

export interface BrowserSnapshot { text: string; url: string; fingerprint: string; approvalFingerprint?: string; capturedAt: number; pageHasFocus?: boolean; accountRuc?: string; formValues?: Array<{ field: string; value: string }> }

/** Keep action outcomes and one final page reading, without repeating whole pages. */
export function compactBrowserResults(outputs: unknown[]): unknown[] {
  let lastSnapshot = -1;
  for (let index = outputs.length - 1; index >= 0; index--) {
    const item = outputs[index];
    if (item && typeof item === 'object' && 'snapshot' in item && typeof item.snapshot === 'string') { lastSnapshot = index; break; }
  }
  return outputs.map((item, index) => {
    if (index === lastSnapshot || !item || typeof item !== 'object' || !('snapshot' in item) || typeof item.snapshot !== 'string') return item;
    const { snapshot: _snapshot, ...rest } = item;
    return { ...rest, snapshotOmitted: true };
  });
}
let latestSnapshot: BrowserSnapshot | undefined;
const latestSelectors = new Map<string, UiaElement>();
const navigationReferences = new Set<string>();
let referenceIds = new Map<string, string>();
let nextReferenceId = 1;
let nativeLogin = false;
let lastEngine: 'uia' | 'cdp' | undefined;
const useCdp = () => !nativeLogin && browserMode() === 'hybrid';

function invalidateReferences(): void {
  latestSnapshot = undefined;
  latestSelectors.clear();
  navigationReferences.clear();
}

export async function beginBrowserInteraction(allowNavigation = false, deadlineAt?: number): Promise<void> {
  acquireBrowserLease();
  const engine = useCdp() ? 'cdp' : 'uia';
  if (lastEngine !== engine) invalidateReferences();
  lastEngine = engine;
  if (engine === 'cdp') {
    try { await (await getCdpBrowser()).bind(); }
    catch (error) { invalidateReferences(); throw error; }
    return;
  }
  try {
    if (!await beginBravePageContext(allowNavigation, deadlineAt)) return;
  } catch (error) {
    latestSnapshot = undefined;
    latestSelectors.clear();
    navigationReferences.clear();
    throw error;
  }
  latestSnapshot = undefined;
  latestSelectors.clear();
  navigationReferences.clear();
}

export function getLatestBrowserSnapshot(): BrowserSnapshot | undefined {
  if (latestSnapshot && Date.now() - latestSnapshot.capturedAt > 30_000) return undefined;
  return latestSnapshot;
}

/** Current rendered form values for the human approval, never stale values from another client. */
export function getCurrentFormValues(): Array<{ field: string; value: string }> {
  return getLatestBrowserSnapshot()?.formValues ?? [];
}

function snapshotReference(line: string): string | undefined {
  return line.match(/^\s*@(?<ref>e\d+)\b/)?.groups?.ref
    ?? line.match(/\[ref=(?<ref>e\d+)\]/)?.groups?.ref;
}

export function describeSnapshotReference(snapshot: string, ref: string): { role: string; label: string; raw: string; navigation?: boolean } | undefined {
  const line = snapshot.split(/\r?\n/).find((value) => snapshotReference(value) === ref);
  if (!line) return undefined;
  const reference = describeSnapshotLine(line);
  const native = latestSelectors.get(ref);
  return { ...reference, ...(navigationReferences.has(ref) && native?.name === reference.label ? { navigation: true } : {}) };
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
export function findSnapshotReferencesByLabel(snapshot: string, label: string, options: { includeOffscreen?: boolean } = {}): Array<{ ref: string; role: string; label: string }> {
  const wanted = normalizeAccessibleLabel(label);
  const semanticMatches: Array<{ ref: string; role: string; label: string }> = [];
  const genericMatches: Array<{ ref: string; role: string; label: string }> = [];
  for (const line of snapshot.split(/\r?\n/)) {
    const ref = snapshotReference(line);
    if (!ref || /\[disabled\]/.test(line) || !options.includeOffscreen && /\[offscreen\]/.test(line)) continue;
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
    return isSunatSessionPageUrl(url.toString()) &&
      snapshot.text.split(/\r?\n/).some((line) => /^\s*@e\d+\s+(?:button|link)\s+"(?:salir|cerrar sesi[oó]n|desconectar)"/i.test(line) && !/\[(?:disabled|offscreen)\]/.test(line));
  } catch { return false; }
}

export function isTaxCommitControl(reference: { role: string; label: string; navigation?: boolean }): boolean {
  const label = normalizeAccessibleLabel(reference.label);
  // A tab selects a panel. Service titles are harmless only with native menu
  // ancestry, never merely because the model supplied a link or a saved route.
  if (reference.role === 'tab') return false;
  if (/^(?:cancelar (?:busqueda|filtro)|cerrar (?:ayuda|vista previa)|volver|regresar)$/.test(label)) return false;
  if (reference.navigation && /^(?:registrar comprobantes de pago|emitir recibos? por honorarios?(?: electronicos?)?|emitir factura(?: electronica)?|emitir boleta de venta|emitir comprobantes de pago|declarar y pagar|consultar y pagar)$/.test(label)) return false;
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
    if (/^URL:\s*https:\/\//i.test(line)) return `URL: ${sanitizePageUrlForMcp(line.slice(4).trim())}`;
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

export function sanitizePageUrlForMcp(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() === 'api-seguridad.sunat.gob.pe') {
      url.pathname = url.pathname.replace(/\/v1\/clientessol\/[^/]+\/oauth2\/loginMenuSol/i, '/v1/clientessol/[oculto]/oauth2/loginMenuSol');
    }
    // SOL also sends serialized account/session data on ordinary service URLs.
    // Keep the real URL only in process for routing and approval comparisons.
    url.search = '';
    url.hash = '';
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

export type FocusedRouteResult = 'clicked' | 'expanded' | 'snapshot_required' | 'ambiguous' | 'session_changed';

export function exactRouteSearchMatches(search: UiaSearchResult, label: string): UiaElement[] | undefined {
  if (search.hasMore || search.matchCount > search.matches.length) return undefined;
  const matches = new Map<string, UiaElement>();
  for (const candidate of search.matches) {
    const element = candidate.isInvokable || /^(Hyperlink|Link|TabItem|MenuItem|TreeItem|ListItem)$/.test(candidate.type ?? '') ? candidate : candidate.invokableAncestor;
    if (element?.selector && element.isEnabled !== false && element.isOffscreen !== true && normalizeAccessibleLabel(element.name ?? '') === normalizeAccessibleLabel(label)) matches.set(element.selector, element);
  }
  return [...matches.values()];
}

/** Only safe known navigation. Ambiguous or tax-looking controls require a full decision snapshot. */
export async function executeFocusedRouteStep(label: string, expectedUrl: string): Promise<FocusedRouteResult> {
  if (useCdp()) {
    const fresh = await snapshotNative();
    if (fresh.url !== expectedUrl) return 'session_changed';
    const matches = findSnapshotReferencesByLabel(fresh.text, label);
    if (matches.length > 1) return 'ambiguous';
    if (!matches.length) return 'snapshot_required';
    const reference = describeSnapshotReference(fresh.text, matches[0].ref);
    if (!reference || isTaxCommitControl(reference)) return 'snapshot_required';
    if (/\[expanded\]/.test(reference.raw)) return 'expanded';
    try { await (await getCdpBrowser()).click(latestSelectors.get(matches[0].ref)!.selector!); }
    finally { invalidateReferences(); }
    return 'clicked';
  }
  const focused = await findBraveRouteControl(label, expectedUrl);
  if (!focused) return 'snapshot_required';
  const url = getBraveUrl(focused.window);
  if (!url || url.toString() !== expectedUrl) return 'session_changed';
  assertSunatUrl(url.toString());
  const matches = exactRouteSearchMatches(focused.search, label);
  if (!matches || matches.length > 1) return 'ambiguous';
  if (!matches.length) return 'snapshot_required';
  const reference = { role: roleForUia(matches[0]) ?? 'generic', label: matches[0].name ?? '' };
  if (isTaxCommitControl(reference)) return 'snapshot_required';
  // An exception here is an uncertain action: callers must stop, never retry it.
  try { await activateBraveElement(matches[0]); }
  finally { latestSnapshot = undefined; latestSelectors.clear(); navigationReferences.clear(); }
  return 'clicked';
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
  return isSunatLoginUrl(value);
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

export function buildNativeSnapshot(window: UiaWindow, url: URL): { text: string; fingerprint: string; approvalFingerprint: string; formValues: Array<{ field: string; value: string }> } {
  latestSelectors.clear();
  navigationReferences.clear();
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
  const formValues: Array<{ field: string; value: string }> = [];
  const containsInput = (element: UiaElement): boolean => element.isEditable === true || /^(Edit|ComboBox|CheckBox|RadioButton)$/.test(element.type ?? '') || (element.children ?? []).some(containsInput);
  const visit = (element: UiaElement, inMenu = false) => {
    const menu = inMenu || (/^(Menu|MenuBar|Tree|Tab)$/.test(element.type ?? '') || element.automationId === 'divSubMenuIzquierda') && !containsInput(element);
    const isInput = element.type === 'Edit' || element.type === 'ComboBox' || element.isEditable === true;
    const text = element.name || (isInput ? element.automationId || 'Campo de texto' : element.isInvokable ? element.automationId || 'Control sin etiqueta' : '');
    const label = text.replace(/[\r\n]+/g, ' ').trim();
    const role = roleForUia(element);
    if (/^(Edit|ComboBox|CheckBox|RadioButton)$/.test(element.type ?? '') && element.automationId !== 'txtBusca' && !element.isPassword && !isSensitiveInput({ role: element.type ?? '', label: `${element.name ?? ''} ${element.automationId ?? ''}` })) formValues.push({ field: element.name || element.automationId || 'Campo', value: element.value ?? element.toggleState ?? String(element.isSelected ?? '') });
    if (role && label) {
      if (element.selector && (isInput || element.isInvokable || /^(button|link|checkbox|tab|option|menuitem|treeitem)$/.test(role))) {
        const key = `${window.hwnd}:${element.selector}`;
        const ref = referenceIds.get(key) ?? `e${nextReferenceId++}`;
        nextIds.set(key, ref);
        latestSelectors.set(ref, element);
        const profileTab = url.hostname === 'e-menu.sunat.gob.pe' && /^\/cl-ti-itmenu\/MenuInternet\.htm$/i.test(url.pathname) && element.type === 'TabItem' && /^divOpcionServicio[123]$/.test(element.automationId ?? '') && /^(personas|empresas|operador de comercio exterior)$/.test(normalizeAccessibleLabel(label));
        if ((menu || profileTab) && /^(Hyperlink|Link|MenuItem|TreeItem|TabItem|ListItem)$/.test(element.type ?? '')) navigationReferences.add(ref);
        lines.push(`@${ref} ${role} ${JSON.stringify(label)}${element.isEnabled === false ? ' [disabled]' : ''}${element.isOffscreen ? ' [offscreen]' : ''}${element.expandState === 'expanded' ? ' [expanded]' : ''}`);
        formState.push([element.selector, element.type, element.name, element.value, element.isEnabled, element.toggleState, element.isSelected]);
      } else {
        lines.push(`- ${role} ${JSON.stringify(label)}`);
      }
    }
    for (const child of element.children ?? []) visit(child, menu);
  };
  for (const root of roots) visit(root);
  referenceIds = nextIds;
  const text = lines.join('\n');
  return { text, fingerprint: createHash('sha256').update(JSON.stringify([url.toString(), text, formState])).digest('hex'), approvalFingerprint: buildApprovalFingerprint(window, url, roots), formValues };
}

async function snapshotNative(deadlineAt?: number): Promise<BrowserSnapshot> {
  if (useCdp()) {
    try {
      const { window, url, background, accountRuc } = await (await getCdpBrowser()).snapshot();
      const result = buildNativeSnapshot(window, url);
      latestSnapshot = { ...result, url: url.toString(), capturedAt: Date.now(), pageHasFocus: !background, accountRuc };
      return latestSnapshot;
    } catch (error) {
      invalidateReferences();
      if (error instanceof NativeUiError) throw error;
      throw new NativeUiError('cdp_read_failed', 'No se pudo leer la página SUNAT mediante CDP. No se activó Brave ni se reintentó una acción.');
    }
  }
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
  latestSnapshot = { ...result, url: url.toString(), capturedAt: Date.now() };
  return latestSnapshot;
}

async function fillNativeReference(ref: string, text: string, deadlineAt?: number): Promise<void> {
  const element = latestSelectors.get(ref);
  if (!element?.selector) throw new Error('La referencia de Brave ya no está vigente.');
  if (useCdp()) { await (await getCdpBrowser()).fill(element.selector, text); return; }
  await focusBraveElement(element.selector, deadlineAt);
  await typeBraveText(text, true, deadlineAt, { automationId: element.automationId, name: element.name, password: false });
}

export async function loginWithSunatAccount(account: SunatAccountCredential | undefined, reuseSession: boolean, requestDeadlineAt?: number) {
  acquireBrowserLease();
  // Prepare/reuse the official background tab before native credential entry.
  // This shares the persistent connection and never navigates an unrelated tab.
  if (browserMode() === 'hybrid') await (await getCdpBrowser()).bind();
  nativeLogin = true;
  invalidateReferences();
  try {
    await beginBravePageContext(true, requestDeadlineAt);
    return await loginNativelyWithSunatAccount(account, reuseSession, requestDeadlineAt);
  }
  finally { nativeLogin = false; lastEngine = undefined; invalidateReferences(); }
}

/** Verify fresh rendered emitter identity; the cached account key never authorizes a transaction. */
export async function verifySunatAccount(expectedRuc: string): Promise<void> {
  await snapshotNative();
  if (!latestSnapshot || !isAuthenticatedSunatPage(latestSnapshot)) throw new Error('SUNAT no muestra una sesión autenticada verificable.');
  let actual = latestSnapshot.accountRuc;
  if (!actual && useCdp()) {
    const header = latestSnapshot.text.split('\n').find((line) => /^@e\d+ link "Bienvenido,/.test(line));
    const ref = header?.match(/^@(e\d+)/)?.[1];
    if (ref) {
      const opened = await executeBrowserBatch([{ action: 'click', ref }, { action: 'snapshot' }]);
      if ((opened as unknown[]).some((item) => Boolean(item && typeof item === 'object' && 'error' in item))) throw new Error('No se pudo verificar la cabecera de la cuenta.');
      actual = getLatestBrowserSnapshot()?.accountRuc;
      // Close only the same harmless account-header toggle, then refresh refs.
      const close = getLatestBrowserSnapshot()?.text.split('\n').find((line) => /^@e\d+ link "Bienvenido,/.test(line))?.match(/^@(e\d+)/)?.[1];
      if (close) await executeBrowserBatch([{ action: 'click', ref: close }, { action: 'snapshot' }]);
    }
  }
  if (!actual && !useCdp()) {
    const state = await getBravePageUiState();
    const texts: string[] = [];
    const visit = (node: UiaElement, header = false) => {
      if (node.isOffscreen || node.isPassword || /^(Edit|ComboBox)$/.test(node.type ?? '')) return;
      const inside = header || node.automationId === 'divCabecera';
      if (inside && node.name) texts.push(node.name);
      node.children?.forEach((child) => visit(child, inside));
    };
    for (const window of state.windows ?? []) window.elements?.forEach((node) => visit(node));
    actual = rucFromHeader(texts.join(' '));
  }
  try { assertAccountRuc(expectedRuc, actual); }
  catch (error) { invalidateReferences(); throw error; }
}

export function resetBrowserContext(): void { invalidateReferences(); referenceIds.clear(); }

async function loginNativelyWithSunatAccount(account: SunatAccountCredential | undefined, reuseSession: boolean, requestDeadlineAt?: number): Promise<{ authenticated: boolean; reusedSession: boolean; usedSavedBrowserCredential?: boolean; requiresUserAction?: string; code?: string }> {
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
  for (const [index, step] of steps.entries()) {
    try {
      if (step.action === 'navigate') {
        assertSunatUrl(step.url);
        if (useCdp()) {
          await (await getCdpBrowser()).navigate(step.url);
          invalidateReferences();
          referenceIds.clear();
          results.push({ action: 'navigate', transport: 'cdp', url: sanitizePageUrlForMcp(step.url) });
          continue;
        }
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
        const fresh = index > 0 && steps[index - 1].action === 'snapshot' && getLatestBrowserSnapshot() || await snapshotNative(deadlineAt);
        results.push({ action: 'snapshot', transport: useCdp() ? 'cdp' : 'uia', ...(fresh.pageHasFocus === undefined ? {} : { pageHasFocus: fresh.pageHasFocus }), origin: sanitizePageUrlForMcp(fresh.url), snapshot: sanitizeSnapshotForMcp(fresh.text) });
      } else if (step.action === 'click') {
        const element = latestSelectors.get(step.ref);
        if (!latestSnapshot || !element?.selector) throw new Error('Referencia de interfaz vencida.');
        const change = useCdp() ? await (await getCdpBrowser()).click(element.selector) : undefined;
        if (!useCdp()) await activateBraveElement(element, deadlineAt);
        latestSnapshot = undefined;
        latestSelectors.clear();
        results.push({ action: 'click', transport: useCdp() ? 'cdp' : 'uia', success: true, ...(change?.contextChanged ? { contextChanged: true } : {}) });
      } else if (step.action === 'scroll') {
        if (step.ref) {
          const element = getLatestBrowserSnapshot() && latestSelectors.get(step.ref);
          if (!element?.selector || element.isEnabled === false) throw new NativeUiError('stale_reference', 'Toma una lectura nueva antes de desplazar este control.');
          if (useCdp()) await (await getCdpBrowser()).scroll(undefined, element.selector);
          else await scrollBraveElementIntoView(element.selector, deadlineAt);
        } else {
          if (!getLatestBrowserSnapshot()) await snapshotNative(deadlineAt);
          if (useCdp()) await (await getCdpBrowser()).scroll(step.direction);
          else await scrollBraveDocument(step.direction!, deadlineAt);
        }
        latestSnapshot = undefined;
        latestSelectors.clear();
        results.push({ action: 'scroll', transport: useCdp() ? 'cdp' : 'uia', success: true });
      } else {
        const reference = latestSnapshot ? describeSnapshotReference(latestSnapshot.text, step.ref) : undefined;
        if (!reference || isSensitiveInput(reference)) throw new Error('Campo no permitido o referencia vencida.');
        await fillNativeReference(step.ref, step.text, deadlineAt);
        results.push({ action: 'fill', transport: useCdp() ? 'cdp' : 'uia', success: true });
      }
    } catch (error) {
      latestSnapshot = undefined;
      latestSelectors.clear();
      results.push({ action: step.action, code: error instanceof NativeUiError ? error.code : 'navigation_failed', ...(error instanceof NativeUiError && error.actionDispatched !== undefined ? { actionDispatched: error.actionDispatched } : {}), error: error instanceof Error && (error instanceof NativeUiError || error.message.includes('HTTPS')) ? error.message : `No se pudo completar la acción en Brave mediante ${useCdp() ? 'CDP' : 'UI Automation'}. No se reintentó el clic.` });
      break;
    }
  }
  return results;
}

export async function captureBrowserScreenshot(): Promise<Buffer> {
  const current = await snapshotNative();
  if (loginPageUrl(current.url)) throw new Error('No se captura la pantalla de inicio de sesión para proteger los datos de acceso.');
  if (useCdp()) return await (await getCdpBrowser()).screenshot();
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

export async function waitForBrowserLabel(label: string, timeoutMs = 8000, stopOnGate = false): Promise<boolean> {
  if (useCdp()) return await (await getCdpBrowser()).waitForLabel(label, timeoutMs, stopOnGate);
  return await import('./windows-ui.js').then((ui) => ui.waitForBraveLabel(label, timeoutMs));
}

export async function getNativeBrowserStatus(): Promise<{ connected: boolean; session: string; browserName?: string; message?: string; cdpConnected?: boolean; cdpState?: string; mode?: string; metrics?: ReturnType<typeof getNativeNavigationMetrics> }> {
  if (process.platform !== 'win32') return { connected: false, session: 'windows-native', message: 'SUNAT Perú MCP solo está disponible en Windows.' };
  try {
    const connected = await hasBraveWindows();
    if (browserMode() === 'hybrid') {
      const cdpState = getCdpConnectionState();
      return { connected, session: 'windows-hybrid', mode: 'hybrid', cdpConnected: cdpState === 'connected', cdpState, browserName: 'Brave existente', metrics: getNativeNavigationMetrics() };
    }
    return { connected, session: 'windows-native', browserName: 'Brave predeterminado del usuario', metrics: getNativeNavigationMetrics() };
  } catch {
    return { connected: false, session: 'windows-native', message: 'No se pudo acceder a la interfaz del Brave que ya está abierto.' };
  }
}
