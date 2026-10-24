import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as winapp from '@microsoft/winappcli';
const UI_COMMAND_TIMEOUT_MS = 6_000;
const UI_WORKFLOW_ID = `sunat-mcp-${process.pid}-${randomUUID()}`;
let targetWindow: number | undefined;
let documentSelector: string | undefined;
let scrollDocuments: Array<{ selector: string; directions: string }> = [];
let desktopUsed = false;
const nativeMetrics = new Map<string, { calls: number; failures: number; totalMs: number }>();

export class NativeUiError extends Error {
  constructor(public readonly code: string, message = 'Windows no pudo completar la acción en Brave.') { super(message); }
}

export function getNativeNavigationMetrics() {
  return Object.fromEntries([...nativeMetrics].map(([command, value]) => [command, {
    calls: value.calls, failures: value.failures, totalMs: Math.round(value.totalMs),
    averageMs: Math.round(value.totalMs / value.calls),
  }]));
}

export function rememberBraveWindow(window: UiaWindow): void {
  if (!window.hwnd) return;
  if (targetWindow !== window.hwnd) documentSelector = undefined;
  targetWindow = window.hwnd;
  let document: UiaElement | undefined;
  scrollDocuments = [];
  walk(window.elements ?? [], (element) => {
    if (!document && element.type === 'Document' && element.selector && element.isOffscreen !== true) document = element;
    if (element.type === 'Document' && element.selector && element.scrollDir && element.isOffscreen !== true) scrollDocuments.push({ selector: element.selector, directions: element.scrollDir });
  });
  if (document?.selector) documentSelector = document.selector;
}

function nativeErrorCode(error: unknown): string {
  try {
    const raw = error as { stderr?: string };
    const code = JSON.parse(raw.stderr ?? '{}').error?.code;
    if (typeof code === 'string' && /^[a-z_]+$/.test(code)) return code;
  } catch { /* Native text may contain account labels; do not return it. */ }
  return (error as { name?: string })?.name === 'AbortError' ? 'timeout' : 'native_failure';
}

function canRediscover(error: unknown): boolean {
  return error instanceof NativeUiError && ['element_not_found', 'stale_element', 'no_target', 'window_not_found', 'target_not_found'].includes(error.code);
}

export interface UiaElement {
  type?: string;
  name?: string;
  className?: string;
  selector?: string;
  automationId?: string;
  value?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isEnabled?: boolean;
  isOffscreen?: boolean;
  isInvokable?: boolean;
  isEditable?: boolean;
  isPassword?: boolean;
  hasMoreChildren?: boolean;
  scrollDir?: string;
  toggleState?: string;
  isSelected?: boolean;
  children?: UiaElement[];
}

export interface UiaWindow {
  hwnd?: number;
  title?: string;
  className?: string;
  elements?: UiaElement[];
}

export interface UiaInspectResult {
  windows?: UiaWindow[];
}

type SavedCredentialSelection =
  | { selected: true; state: UiaInspectResult }
  | { selected: false; reason: 'browser_unavailable' | 'sunat_window_not_found' | 'password_field_not_found' | 'suggestion_not_found' | 'multiple_suggestions' | 'selection_unverified' };

function remainingMs(deadlineAt?: number): number {
  return deadlineAt === undefined ? UI_COMMAND_TIMEOUT_MS : Math.min(UI_COMMAND_TIMEOUT_MS, deadlineAt - Date.now());
}

async function runWinApp(args: string[], deadlineAt?: number): Promise<string> {
  if (process.platform !== 'win32') throw new Error('La interfaz nativa solo está disponible en Windows.');
  const waitAt = args.indexOf('--timeout');
  const waitMs = waitAt < 0 ? 0 : Number(args[waitAt + 1]);
  const timeoutMs = Math.min(deadlineAt === undefined ? Infinity : deadlineAt - Date.now(), Math.max(UI_COMMAND_TIMEOUT_MS, waitMs + 1000));
  if (timeoutMs < 100) throw new Error('Se agotó el tiempo disponible para el control nativo de Brave.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const command = args[1];
  if (['click', 'focus', 'invoke', 'send-keys', 'screenshot', 'scroll'].includes(command)) desktopUsed = true;
  const started = performance.now();
  const metric = nativeMetrics.get(command) ?? { calls: 0, failures: 0, totalMs: 0 };
  metric.calls++;
  nativeMetrics.set(command, metric);
  try {
    const common = { ...(targetWindow ? { window: targetWindow } : { app: 'brave' }), json: true, signal: controller.signal, workflowId: UI_WORKFLOW_ID };
    let result: winapp.WinappResult;
    if (args[0] !== 'ui') throw new Error('Comando nativo no permitido.');
    if (command === 'inspect') {
      const depthAt = args.indexOf('--depth');
      const depth = depthAt < 0 ? 12 : Number(args[depthAt + 1]);
      const rootAt = args.indexOf('--root');
      result = await winapp.uiInspect({ ...common, interactive: args.includes('--interactive'), depth, ...(rootAt < 0 ? {} : { selector: args[rootAt + 1] }) });
    } else if (command === 'list-windows') {
      result = await winapp.uiListWindows({ app: 'brave', json: true, signal: controller.signal });
    } else if (command === 'yield') {
      result = await winapp.uiYield({ workflowId: UI_WORKFLOW_ID, json: true, signal: controller.signal });
    } else if (command === 'wait-for' || command === 'wait-for-native') {
      result = await winapp.uiWaitFor({ ...common, selector: args[2], timeout: waitMs, ...(command === 'wait-for' && documentSelector ? { root: documentSelector } : {}) });
    } else if (command === 'search-tab') {
      result = await winapp.uiSearch({ ...common, selector: args[2], type: 'TabItem' });
    } else if (command === 'screenshot') {
      result = await winapp.uiScreenshot({ ...common, output: args[2] });
    } else if (command === 'scroll') {
      const direction = args[3];
      result = await winapp.uiScroll({ ...common, selector: args[2], ...(direction === 'up' || direction === 'down' ? { wheel: direction === 'down' ? -3 : 3 } : { direction }) });
    } else if (command === 'click') {
      result = await winapp.uiClick({ ...common, selector: args[2] });
    } else if (command === 'focus') {
      result = await winapp.uiFocus({ ...common, selector: args[2] });
    } else if (command === 'invoke') {
      const selector = args[2];
      const actionAt = args.indexOf('--action');
      result = await winapp.uiInvoke({ ...common, selector, ...(actionAt >= 0 ? { action: args[actionAt + 1] } : {}) });
    } else if (command === 'send-keys') {
      const keys = args[2];
      const verbatim = args.includes('--verbatim');
      const transportAt = args.indexOf('--via');
      result = await winapp.uiSendKeys({ ...common, keys, ...(verbatim ? { verbatim: true } : {}), ...(transportAt >= 0 ? { via: args[transportAt + 1] } : {}) });
    } else {
      throw new Error('Comando nativo no permitido.');
    }
    return result.stdout.trim() || result.stderr.trim();
  } catch (error) {
    if (command === 'wait-for' || command === 'wait-for-native') {
      try {
        const output = (error as { stdout?: string }).stdout;
        if (output && JSON.parse(output).timedOut === true) return output;
      } catch { /* Do not expose native errors. */ }
    }
    metric.failures++;
    throw new NativeUiError(nativeErrorCode(error));
  } finally {
    metric.totalMs += performance.now() - started;
    clearTimeout(timer);
  }
}

async function inspectBrave(deadlineAt?: number, interactive = false, depth = 12, pageOnly = false): Promise<UiaInspectResult> {
  const output = await runWinApp(['ui', 'inspect', ...(interactive ? ['--interactive'] : []), '--depth', String(depth), ...(pageOnly && documentSelector ? ['--root', documentSelector] : [])], deadlineAt);
  try {
    const state = JSON.parse(output) as UiaInspectResult;
    if (state.windows?.length === 1) rememberBraveWindow(state.windows[0]);
    return state;
  } catch {
    throw new Error('WinApp devolvió una respuesta de interfaz no válida.');
  }
}

export async function getBraveUiState(deadlineAt?: number, interactive = false, depth = 12): Promise<UiaInspectResult> {
  try { return await inspectBrave(deadlineAt, interactive, depth); }
  catch (error) {
    if (!targetWindow || !canRediscover(error)) throw error;
    targetWindow = undefined;
    documentSelector = undefined;
    return await inspectBrave(deadlineAt, interactive, depth);
  }
}

export async function getBravePageUiState(deadlineAt?: number): Promise<UiaInspectResult> {
  if (targetWindow && documentSelector) {
    try { return await inspectBrave(deadlineAt, false, 12, true); }
    catch (error) {
      if (!canRediscover(error)) throw error;
      documentSelector = undefined;
    } // A new document can replace the old UIA root.
  }
  const state = await getBraveUiState(deadlineAt);
  let truncated = false;
  for (const window of state.windows ?? []) walk(window.elements ?? [], (element) => { if (element.hasMoreChildren && element.isOffscreen !== true) truncated = true; });
  return truncated && documentSelector ? await inspectBrave(deadlineAt, false, 12, true) : state;
}

export async function releaseBraveUi(): Promise<void> {
  if (!desktopUsed) return;
  desktopUsed = false;
  try { await runWinApp(['ui', 'yield']); } catch { /* A release failure must not hide the operation result. */ }
}

export async function waitForBraveLabel(label: string, timeoutMs = 8000, deadlineAt?: number): Promise<boolean> {
  const output = await runWinApp(['ui', 'wait-for', label, '--timeout', String(timeoutMs)], deadlineAt);
  return JSON.parse(output).found === true;
}

export async function captureBraveWindow(output: string): Promise<void> {
  if (!targetWindow) throw new NativeUiError('no_target');
  await runWinApp(['ui', 'screenshot', output]);
}

export async function scrollBraveDocument(direction: 'up' | 'down' | 'left' | 'right', deadlineAt?: number): Promise<void> {
  if (!documentSelector) throw new NativeUiError('no_document');
  const axis = direction === 'up' || direction === 'down' ? 'v' : 'h';
  const container = scrollDocuments.filter((item) => item.directions.includes(axis)).at(-1);
  if (!container) throw new NativeUiError('no_scroll_container', 'La página actual no expone un panel desplazable en esa dirección.');
  await runWinApp(['ui', 'scroll', container.selector, direction], deadlineAt);
}

export async function hasBraveWindows(): Promise<boolean> {
  const result = JSON.parse(await runWinApp(['ui', 'list-windows']));
  return (Array.isArray(result) ? result : result.windows ?? []).length > 0;
}

export async function focusBraveElement(selector: string, deadlineAt?: number): Promise<void> {
  await runWinApp(['ui', 'focus', selector, '-a', 'brave', '--json'], deadlineAt);
}

export async function clickBraveElement(selector: string, deadlineAt?: number): Promise<void> {
  await runWinApp(['ui', 'click', selector, '-a', 'brave', '--json'], deadlineAt);
}

export async function activateBraveElement(element: UiaElement, deadlineAt?: number): Promise<void> {
  if (!element.selector || element.isEnabled === false) throw new NativeUiError('target_disabled');
  if (element.isInvokable === true) await invokeBraveElement(element.selector, deadlineAt);
  else if (element.type === 'TabItem') await selectBraveTab(element.selector, deadlineAt);
  else await clickBraveElement(element.selector, deadlineAt);
}

export async function invokeBraveElement(selector: string, deadlineAt?: number): Promise<void> {
  await runWinApp(['ui', 'invoke', selector, '-a', 'brave', '--action', 'invoke', '--json'], deadlineAt);
}

export async function selectBraveTab(selector: string, deadlineAt?: number): Promise<void> {
  // Chromium's tab slugs from a full tree can go stale. A typed search gives a
  // fresh tab-only selector and avoids matching the page document with its title.
  const result = JSON.parse(await runWinApp(['ui', 'search-tab', selector], deadlineAt)) as { matchCount: number; hasMore?: boolean; matches: UiaElement[] };
  if (result.matchCount !== 1 || result.hasMore || !result.matches[0]?.selector) throw new NativeUiError('ambiguous_tab');
  await runWinApp(['ui', 'invoke', result.matches[0].selector, '--action', 'select'], deadlineAt);
}

export async function sendBraveKeys(keys: string, deadlineAt?: number): Promise<void> {
  await runWinApp(['ui', 'send-keys', keys, '--via', 'send-input'], deadlineAt);
}

export interface NativeTextTarget { automationId?: string; name?: string; password?: boolean }
const nativeTextCommand = Buffer.from(readFileSync(new URL('./native-input.ps1', import.meta.url), 'utf8'), 'utf16le').toString('base64');
type InputWorker = ReturnType<typeof spawn>;
let inputWorker: InputWorker | undefined;
let inputBuffer = '';
let inputSequence = 0;
let inputQueue: Promise<void> = Promise.resolve();
const pendingInput = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();

export function closeNativeInput(): void {
  const worker = inputWorker;
  inputWorker = undefined;
  worker?.kill();
  for (const request of pendingInput.values()) request.reject(new NativeUiError('native_input_stopped'));
  pendingInput.clear();
}
process.once('exit', closeNativeInput);

function getInputWorker(): InputWorker {
  if (inputWorker) return inputWorker;
  const worker = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', nativeTextCommand], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  inputWorker = worker;
  inputBuffer = '';
  worker.unref();
  for (const stream of [worker.stdin, worker.stdout, worker.stderr]) (stream as unknown as { unref?: () => void })?.unref?.();
  worker.stdout?.setEncoding('utf8');
  worker.stdout?.on('data', (chunk: string) => {
    inputBuffer += chunk;
    if (inputBuffer.length > 8192) { closeNativeInput(); return; }
    let lineEnd: number;
    while ((lineEnd = inputBuffer.indexOf('\n')) >= 0) {
      const line = inputBuffer.slice(0, lineEnd);
      inputBuffer = inputBuffer.slice(lineEnd + 1);
      try {
        const response = JSON.parse(line) as { id: number; ok: boolean };
        const request = pendingInput.get(response.id);
        pendingInput.delete(response.id);
        if (response.ok === true) request?.resolve();
        else request?.reject(new NativeUiError('native_input_rejected', 'Brave perdió el foco o el campo cambió; se detuvo la escritura.'));
      } catch { closeNativeInput(); return; }
    }
  });
  worker.stderr?.resume(); // Drain diagnostics without retaining or returning native text.
  worker.stdin?.on('error', () => { if (inputWorker === worker) closeNativeInput(); });
  const stopped = () => { if (inputWorker === worker) closeNativeInput(); };
  worker.once('error', stopped);
  worker.once('exit', stopped);
  return worker;
}

/** One on-demand MCP-owned worker; values travel only over stdin and are never logged. */
export async function typeBraveText(text: string, clear = true, deadlineAt?: number, expected?: NativeTextTarget): Promise<void> {
  await typeBraveTextSequence([text], clear, deadlineAt, [expected ?? { password: false }]);
}

export async function typeBraveTextSequence(values: string[], clear = true, deadlineAt?: number, expected: NativeTextTarget[] = []): Promise<void> {
  if (process.platform !== 'win32') throw new NativeUiError('unsupported_platform');
  if (values.length > 1 && (expected.length !== values.length || expected.some((field) => !field.automationId && !field.name))) throw new NativeUiError('unverified_field_order');
  const action = async () => {
    const timeoutMs = remainingMs(deadlineAt);
    if (timeoutMs < 100) throw new NativeUiError('timeout');
    if (values.length && !targetWindow) throw new NativeUiError('no_target');
    const worker = getInputWorker();
    const started = performance.now();
    const metric = nativeMetrics.get('text-input') ?? { calls: 0, failures: 0, totalMs: 0 };
    nativeMetrics.set('text-input', metric);
    metric.calls++;
    try {
      await new Promise<void>((resolve, reject) => {
        const id = ++inputSequence;
        const timer = setTimeout(() => { closeNativeInput(); }, timeoutMs);
        pendingInput.set(id, {
          resolve: () => { clearTimeout(timer); resolve(); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        worker.stdin?.write(JSON.stringify({ id, window: targetWindow ?? 0, values, clear, expected }) + '\n');
      });
    } catch (error) { metric.failures++; throw error; }
    finally { metric.totalMs += performance.now() - started; }
  };
  const result = inputQueue.then(action, action);
  inputQueue = result.then(() => undefined, () => undefined);
  await result;
}
export function getBraveAddressBar(window: UiaWindow): UiaElement | undefined {
  let addressBar: UiaElement | undefined;
  walk(window.elements ?? [], (element) => {
    if (!addressBar && element.type === 'Edit' && element.selector &&
      (element.automationId === 'view_1012' || /address and search bar|barra de direcciones y de busqueda/i.test(element.name ?? ''))) {
      addressBar = element;
    }
  });
  return addressBar;
}

export function getBraveUrl(window: UiaWindow): URL | undefined {
  // A typed or redirecting omnibox can differ from the rendered document.
  // Prefer the visible document, including during scoped inspections.
  let address: string | undefined;
  walk(window.elements ?? [], (element) => {
    if (!address && element.type === 'Document' && element.isOffscreen !== true && /^https?:\/\//i.test(element.value ?? '')) address = element.value;
  });
  address ??= getBraveAddressBar(window)?.value;
  if (!address) return undefined;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `https://${address}`;
    return new URL(candidate);
  } catch { return undefined; }
}

export function walkUiaElements(elements: UiaElement[], visit: (element: UiaElement) => void): void {
  walk(elements, visit);
}

function walk(elements: UiaElement[], visit: (element: UiaElement) => void): void {
  for (const element of elements) {
    visit(element);
    if (element.children) walk(element.children, visit);
  }
}

function normalized(value: string | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function isSunatTabLabel(value: string | undefined): boolean {
  const label = normalized(value);
  if (/documentos de google|google docs|notebooklm|github/.test(label)) return false;
  // Chromium decorates accessibility names with tab-group and position text.
  return /\bsunat\s*[-–—]\s*menu sol\b|\bsunat(?: sol)? operaciones en linea\b/.test(label);
}

export function getPasswordSuggestions(state: UiaInspectResult): UiaElement[] {
  const suggestions: UiaElement[] = [];
  for (const window of state.windows ?? []) {
    walk(window.elements ?? [], (element) => {
      if (element.type !== 'List' || normalized(element.name) !== 'autocompletar') return;
      const visitRows = (rows: UiaElement[]) => {
        for (const row of rows) {
          if (row.type === 'ListItem' && /^(?:contrasena de|password for)\b/i.test(normalized(row.name))) {
            if (row.selector && row.isEnabled !== false && row.isOffscreen !== true) suggestions.push(row);
            // Chromium can expose the same suggestion as nested ListItems.
            // Keep its outer row, while preserving distinct sibling accounts.
            continue;
          }
          visitRows(row.children ?? []);
        }
      };
      visitRows(element.children ?? []);
    });
  }
  const unique: UiaElement[] = [];
  for (const row of suggestions) {
    const duplicateVisibleRow = unique.some((existing) =>
      normalized(existing.name) === normalized(row.name) &&
      typeof existing.x === 'number' && typeof existing.y === 'number' &&
      typeof row.x === 'number' && typeof row.y === 'number' &&
      Math.abs(existing.x - row.x) <= 4 && Math.abs(existing.y - row.y) <= 4,
    );
    if (!duplicateVisibleRow) unique.push(row);
  }
  return unique;
}

async function selectCredentialFromInspect(initial: UiaInspectResult, deadlineAt?: number): Promise<SavedCredentialSelection> {
  const sunatWindows = (initial.windows ?? []).filter((window) => browserUrl(window));
  if (sunatWindows.length !== 1) return { selected: false, reason: 'sunat_window_not_found' };

  let uniqueSuggestions = getPasswordSuggestions(initial);
  if (uniqueSuggestions.length === 0) {
    const passwordFields: UiaElement[] = [];
    walk(sunatWindows[0].elements ?? [], (element) => {
      if (element.type === 'Edit' && element.selector && (
        element.automationId === 'txtContrasena' || /^(?:contrasena|clave|password)$/i.test(element.name ?? '')
      )) passwordFields.push(element);
    });
    const uniquePasswordFields = [...new Map(passwordFields.map((field) => [field.selector, field])).values()];
    if (uniquePasswordFields.length !== 1) return { selected: false, reason: 'password_field_not_found' };
    try {
      await runWinApp(['ui', 'click', uniquePasswordFields[0].selector!, '-a', 'brave', '--json'], deadlineAt);
    } catch {
      return { selected: false, reason: 'browser_unavailable' };
    }
    try {
      // The password-manager popup belongs to native browser chrome and can
      // appear after the click returns. Wait for its label outside the page root.
      const popup = JSON.parse(await runWinApp(['ui', 'wait-for-native', 'Autocompletar', '--timeout', '1500'], deadlineAt));
      if (!popup.found) return { selected: false, reason: 'suggestion_not_found' };
      uniqueSuggestions = getPasswordSuggestions(await inspectBrave(deadlineAt));
    } catch {
      return { selected: false, reason: 'suggestion_not_found' };
    }
  }
  if (uniqueSuggestions.length === 0) return { selected: false, reason: 'suggestion_not_found' };
  if (uniqueSuggestions.length !== 1) return { selected: false, reason: 'multiple_suggestions' };

  try {
    await runWinApp(['ui', 'invoke', uniqueSuggestions[0].selector!, '--action', 'select'], deadlineAt);
  } catch {
    return { selected: false, reason: 'browser_unavailable' };
  }

  let finalState: UiaInspectResult;
  try {
    finalState = await inspectBrave(deadlineAt);
    const stillOpen = (finalState.windows ?? []).some((window) => {
      let found = false;
      walk(window.elements ?? [], (element) => {
        if (element.type === 'List' && normalized(element.name) === 'autocompletar') found = true;
      });
      return found;
    });
    if (stillOpen) return { selected: false, reason: 'selection_unverified' };
  } catch {
    return { selected: false, reason: 'selection_unverified' };
  }

  return { selected: true, state: finalState };
}

function browserUrl(window: UiaWindow): URL | undefined {
  const url = getBraveUrl(window);
  return url?.protocol === 'https:' && (url.hostname === 'sunat.gob.pe' || url.hostname.endsWith('.sunat.gob.pe')) ? url : undefined;
}

function findLoginButton(window: UiaWindow): UiaElement | undefined {
  const buttons: UiaElement[] = [];
  walk(window.elements ?? [], (element) => {
    if (element.type === 'Button' && element.selector && element.isEnabled !== false &&
      /^(?:iniciar sesion|ingresar|login)$/i.test(normalized(element.name))) buttons.push(element);
  });
  return buttons.length === 1 ? buttons[0] : undefined;
}

function loginPageIsOpen(state: UiaInspectResult): boolean {
  const sunatWindows = (state.windows ?? []).filter((window) => browserUrl(window));
  if (sunatWindows.length !== 1) return false;
  const url = browserUrl(sunatWindows[0]);
  return Boolean(url && /loginMenuSol/i.test(url.pathname));
}

function loggedInToSunat(state: UiaInspectResult): boolean {
  const sunatWindows = (state.windows ?? []).filter((window) => browserUrl(window));
  if (sunatWindows.length !== 1) return false;
  const url = browserUrl(sunatWindows[0]);
  let logoutVisible = false;
  walk(sunatWindows[0].elements ?? [], (element) => {
    if (['Button', 'Hyperlink', 'Link'].includes(element.type ?? '') && element.isOffscreen !== true && element.isEnabled !== false && /^(?:salir|cerrar sesion|desconectar)$/.test(normalized(element.name))) logoutVisible = true;
  });
  return Boolean(url && url.hostname === 'e-menu.sunat.gob.pe' && /\/cl-ti-itmenu\/MenuInternet/i.test(url.pathname) && logoutVisible);
}

/** Log in on the existing Brave window using its one unique SUNAT password-manager suggestion. */
export async function loginWithSavedSunatCredentialNatively(deadlineAt?: number): Promise<{
  authenticated: boolean;
  reusedSession: boolean;
  usedSavedBrowserCredential?: boolean;
  requiresUserAction?: string;
  code?: string;
}> {
  let state: UiaInspectResult;
  try {
    state = await inspectBrave(deadlineAt);
  } catch {
    return { authenticated: false, reusedSession: false, requiresUserAction: 'No se pudo inspeccionar Brave con Windows UI Automation.' };
  }

  if (loggedInToSunat(state)) return { authenticated: true, reusedSession: true };

  let sunatWindows = (state.windows ?? []).filter((window) => browserUrl(window));
  if (sunatWindows.length !== 1) {
    const mainWindows = (state.windows ?? []).filter((window) => Boolean(window.hwnd) && /Brave/i.test(window.title ?? ''));
    if (mainWindows.length !== 1) {
      return { authenticated: false, reusedSession: false, requiresUserAction: 'Deja una sola ventana de Brave disponible para iniciar sesión en SUNAT.' };
    }
    const sunatTabs: UiaElement[] = [];
    walk(mainWindows[0].elements ?? [], (element) => {
      if (element.type === 'TabItem' && element.selector && isSunatTabLabel(element.name)) sunatTabs.push(element);
    });
    if (sunatTabs.length > 1) return { authenticated: false, reusedSession: false, requiresUserAction: 'Brave tiene varias pestañas de SUNAT; deja visible la pestaña en la que quieres iniciar sesión.' };

    if (sunatTabs.length === 1) {
      try {
        await selectBraveTab(sunatTabs[0].name || sunatTabs[0].selector!, deadlineAt);
      } catch {
        return { authenticated: false, reusedSession: false, requiresUserAction: 'No se pudo activar la pestaña SUNAT en Brave.' };
      }
    } else {
      try {
        const addressBar = getBraveAddressBar(mainWindows[0]);
        if (!addressBar?.selector) throw new Error('Missing address bar');
        await focusBraveElement(addressBar.selector, deadlineAt);
        await typeBraveText('https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?pestana=%2A&agrupacion=%2A', true, deadlineAt);
        await sendBraveKeys('enter', deadlineAt);
      } catch {
        return { authenticated: false, reusedSession: false, requiresUserAction: 'No se pudo abrir el acceso oficial de SUNAT en el Brave existente.' };
      }
    }
    try {
      state = await inspectBrave(deadlineAt);
    } catch {
      return { authenticated: false, reusedSession: false, requiresUserAction: 'SUNAT no terminó de cargar en Brave; revisa la pestaña existente.' };
    }
    if (loggedInToSunat(state)) return { authenticated: true, reusedSession: true };
    sunatWindows = (state.windows ?? []).filter((window) => browserUrl(window));
  }

  if (sunatWindows.length !== 1 || !loginPageIsOpen(state)) {
    return { authenticated: false, reusedSession: false, requiresUserAction: 'Brave no muestra el formulario oficial de acceso a SUNAT.' };
  }

  const selected = await selectCredentialFromInspect(state, deadlineAt);
  if (!selected.selected) {
    const message = selected.reason === 'multiple_suggestions'
      ? 'Brave muestra varias credenciales guardadas para SUNAT. No se eligió ninguna; selecciona la cuenta en el navegador.'
      : selected.reason === 'suggestion_not_found'
        ? 'Brave no mostró una credencial guardada para SUNAT. Selecciónala en el navegador.'
        : 'No se pudo seleccionar de forma segura la credencial guardada de Brave.';
    return { authenticated: false, reusedSession: false, requiresUserAction: message, code: selected.reason };
  }

  state = selected.state;
  if (!loginPageIsOpen(state)) return { authenticated: false, reusedSession: false, requiresUserAction: 'La pestaña de SUNAT cambió después de seleccionar la credencial; no se envió el formulario.' };
  sunatWindows = (state.windows ?? []).filter((window) => browserUrl(window));
  const button = sunatWindows.length === 1 ? findLoginButton(sunatWindows[0]) : undefined;
  if (!button?.selector) return { authenticated: false, reusedSession: false, requiresUserAction: 'No se encontró el botón de acceso del formulario SUNAT.' };

  try {
    await runWinApp(['ui', 'invoke', button.selector, '-a', 'brave', '--action', 'invoke', '--json'], deadlineAt);
    state = await inspectBrave(deadlineAt);
  } catch {
    return { authenticated: false, reusedSession: false, requiresUserAction: 'No se pudo enviar el formulario de acceso de SUNAT desde Brave.' };
  }

  if (loggedInToSunat(state)) return { authenticated: true, reusedSession: false, usedSavedBrowserCredential: true };
  return {
    authenticated: false,
    reusedSession: false,
    requiresUserAction: loginPageIsOpen(state)
      ? 'SUNAT no confirmó el ingreso. Revisa el mensaje que aparece en Brave y completa cualquier verificación solicitada.'
      : 'SUNAT no confirmó el ingreso. Revisa Brave y completa allí cualquier verificación solicitada.',
  };
}
