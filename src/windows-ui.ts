/** Windows UI Automation access to the existing Brave window: inspection, focus, clicks, keys and native text input. */

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as winapp from '@microsoft/winappcli';
import { verifyActiveSunatTab } from './browser-context.js';
import { NativeUiError } from './native-ui-error.js';
import { getBraveAddressBar, getBraveUrl, isSunatTabLabel, selectBraveMainWindow, walk, type UiaElement, type UiaInspectResult, type UiaSearchResult, type UiaWindow } from './uia-model.js';

// Public surface kept stable for existing importers; the implementations live in the modules below.
export { NativeUiError } from './native-ui-error.js';
export { findLoginButton, getBraveAddressBar, getBraveUrl, getPasswordSuggestions, isSunatTabLabel, selectBraveMainWindow, walkUiaElements, type UiaElement, type UiaInspectResult, type UiaSearchResult, type UiaWindow } from './uia-model.js';

const UI_COMMAND_TIMEOUT_MS = 6_000;

const UI_WORKFLOW_ID = `sunat-mcp-${process.pid}-${randomUUID()}`;

let targetWindow: number | undefined;

let documentSelector: string | undefined;

let scrollDocuments: Array<{ selector: string; directions: string }> = [];

let desktopUsed = false;

let foregroundReady = false;

let lastDesktopActivityAt = 0;

let lastTopLevelAddress: string | undefined;

const nativeMetrics = new Map<string, { calls: number; failures: number; totalMs: number }>();

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

function remainingMs(deadlineAt?: number): number {
  return deadlineAt === undefined ? UI_COMMAND_TIMEOUT_MS : Math.min(UI_COMMAND_TIMEOUT_MS, deadlineAt - Date.now());
}

export async function runWinApp(args: string[], deadlineAt?: number): Promise<string> {
  if (process.platform !== 'win32') throw new Error('La interfaz nativa solo está disponible en Windows.');
  const waitAt = args.indexOf('--timeout');
  const waitMs = waitAt < 0 ? 0 : Number(args[waitAt + 1]);
  const timeoutMs = Math.min(deadlineAt === undefined ? Infinity : deadlineAt - Date.now(), Math.max(UI_COMMAND_TIMEOUT_MS, waitMs + 1000));
  if (timeoutMs < 100) throw new Error('Se agotó el tiempo disponible para el control nativo de Brave.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const command = args[1];
  if (['click', 'focus', 'invoke', 'send-keys', 'screenshot', 'scroll', 'scroll-into-view'].includes(command)) desktopUsed = true;
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
    } else if (command === 'route-control') {
      result = await winapp.uiInspect({ ...common, selector: args[2], ancestors: true });
    } else if (command === 'screenshot') {
      result = await winapp.uiScreenshot({ ...common, output: args[2] });
    } else if (command === 'scroll') {
      const direction = args[3];
      result = await winapp.uiScroll({ ...common, selector: args[2], ...(direction === 'up' || direction === 'down' ? { wheel: direction === 'down' ? -3 : 3 } : { direction }) });
    } else if (command === 'scroll-into-view') {
      result = await winapp.uiScrollIntoView({ ...common, selector: args[2] });
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
    if (['click', 'focus', 'invoke', 'send-keys', 'scroll', 'scroll-into-view'].includes(command)) lastDesktopActivityAt = Date.now();
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

export async function inspectBrave(deadlineAt?: number, interactive = false, depth = 12, pageOnly = false): Promise<UiaInspectResult> {
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
      if (!canRediscover(error) && !(error instanceof NativeUiError && error.code === 'internal_error')) throw error;
      documentSelector = undefined;
    } // A new document can replace the old UIA root.
  }
  // Discover browser chrome/tabs before reading a document. The active tab can
  // be a large unrelated page; snapshotNative will select the existing SOL tab.
  // Keep document containers: interactive-only filtering may omit the outer
  // SOL document and leave only its embedded error/form document.
  const state = await getBraveUiState(deadlineAt, false, 8);
  if (!documentSelector && (state.windows ?? []).some((window) => {
    const url = getBraveUrl(window);
    return url?.protocol === 'https:' && (url.hostname === 'sunat.gob.pe' || url.hostname.endsWith('.sunat.gob.pe'));
  })) return await getBraveUiState(deadlineAt);
  let truncated = false;
  for (const window of state.windows ?? []) walk(window.elements ?? [], (element) => { if (element.hasMoreChildren && element.isOffscreen !== true) truncated = true; });
  return truncated && documentSelector ? await inspectBrave(deadlineAt, false, 12, true) : state;
}

export async function releaseBraveUi(): Promise<void> {
  foregroundReady = false;
  if (!desktopUsed) return;
  desktopUsed = false;
  try { await runWinApp(['ui', 'yield']); } catch { /* A release failure must not hide the operation result. */ }
}

/** One cheap chrome check at tool entry prevents reading an inactive document. */
export async function beginBravePageContext(allowNavigation = false, deadlineAt?: number): Promise<boolean> {
  foregroundReady = false;
  if (!targetWindow) {
    const windows = JSON.parse(await runWinApp(['ui', 'list-windows'], deadlineAt));
    targetWindow = selectBraveMainWindow(windows);
    if (!targetWindow) throw new NativeUiError('ambiguous_window', 'No se identificó una única ventana principal de Brave. Las ventanas auxiliares del navegador no se seleccionan.');
  }
  try {
    const result = await verifyActiveSunatTab({
      readAddress: async () => {
        const state = JSON.parse(await runWinApp(['ui', 'inspect', '--root', 'view_1012', '--depth', '1'], deadlineAt)) as UiaInspectResult;
        const window = state.windows?.find((item) => item.hwnd === targetWindow);
        const value = window && getBraveAddressBar(window)?.value;
        if (!value) throw new NativeUiError('address_unavailable');
        return getBraveUrl({ elements: [{ type: 'Edit', selector: 'view_1012', automationId: 'view_1012', value }] })?.toString();
      },
      selectSunatTab: async () => {
        const search = JSON.parse(await runWinApp(['ui', 'search-tab', 'SUNAT'], deadlineAt)) as UiaSearchResult;
        const matches = search.matches.filter((item) => isSunatTabLabel(item.name));
        if (!search.hasMore && matches.length === 0) return false;
        if (search.hasMore || matches.length !== 1 || !matches[0].selector) throw new NativeUiError('ambiguous_tab', 'No se encontró una única pestaña SOL existente.');
        await runWinApp(['ui', 'invoke', matches[0].selector, '--action', 'select'], deadlineAt);
        return true;
      },
    }, lastTopLevelAddress, allowNavigation);
    lastTopLevelAddress = result.address;
    if (result.changed) { documentSelector = undefined; scrollDocuments = []; foregroundReady = false; }
    return result.changed;
  } catch (error) {
    documentSelector = undefined;
    scrollDocuments = [];
    lastTopLevelAddress = undefined;
    if (canRediscover(error)) targetWindow = undefined;
    throw error;
  }
}

async function prepareBraveForeground(deadlineAt?: number): Promise<void> {
  if (foregroundReady && Date.now() - lastDesktopActivityAt < 2500) return;
  // Desktop affinity expires after four seconds. A long read/approval may
  // allow another workflow to change tabs; never act on that old page map.
  if (await beginBravePageContext(false, deadlineAt)) throw new NativeUiError('context_changed', 'Brave cambió de pestaña durante el lote. Revisa una lectura nueva antes de continuar.');
  // Tab selection alone does not activate the window for physical input.
  await focusBraveElement('view_1012', deadlineAt);
}

export async function waitForBraveLabel(label: string, timeoutMs = 8000, deadlineAt?: number): Promise<boolean> {
  const output = await runWinApp(['ui', 'wait-for', label, '--timeout', String(timeoutMs)], deadlineAt);
  return JSON.parse(output).found === true;
}

/** One narrow UIA read includes the target and its real document ancestors. */
export async function findBraveRouteControl(label: string, expectedUrl: string, deadlineAt?: number): Promise<{ window: UiaWindow; search: UiaSearchResult } | undefined> {
  if (!targetWindow || !documentSelector) return undefined;
  try {
    const state = JSON.parse(await runWinApp(['ui', 'route-control', label], deadlineAt)) as UiaInspectResult;
    const window = state.windows?.find((item) => item.hwnd === targetWindow);
    if (!window || !getBraveUrl(window)) return undefined;
    if (getBraveUrl(window)!.toString() !== expectedUrl) return { window, search: { matchCount: 0, matches: [] } };
    const matches: UiaElement[] = [];
    let inDocument = false;
    const collect = (elements: UiaElement[], inside = false) => {
      for (const element of elements) {
        const document = inside || element.type === 'Document';
        if (document) { inDocument = true; matches.push(element); }
        collect(element.children ?? [], document);
      }
    };
    collect(window.elements ?? []);
    return inDocument ? { window, search: { matchCount: matches.length, matches } } : undefined;
  } catch (error) {
    if (canRediscover(error) || error instanceof NativeUiError && /ambiguous/.test(error.code)) return undefined;
    throw error;
  }
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
  await prepareBraveForeground(deadlineAt);
  await runWinApp(['ui', 'scroll', container.selector, direction], deadlineAt);
}

export async function scrollBraveElementIntoView(selector: string, deadlineAt?: number): Promise<void> {
  await prepareBraveForeground(deadlineAt);
  await runWinApp(['ui', 'scroll-into-view', selector], deadlineAt);
}

export async function hasBraveWindows(): Promise<boolean> {
  const result = JSON.parse(await runWinApp(['ui', 'list-windows']));
  return (Array.isArray(result) ? result : result.windows ?? []).length > 0;
}

export async function focusBraveElement(selector: string, deadlineAt?: number): Promise<void> {
  await runWinApp(['ui', 'focus', selector, '-a', 'brave', '--json'], deadlineAt);
  foregroundReady = true;
}

export async function clickBraveElement(selector: string, deadlineAt?: number): Promise<void> {
  await prepareBraveForeground(deadlineAt);
  await runWinApp(['ui', 'click', selector, '-a', 'brave', '--json'], deadlineAt);
}

export async function activateBraveElement(element: UiaElement, deadlineAt?: number): Promise<void> {
  if (!element.selector || element.isEnabled === false) throw new NativeUiError('target_disabled');
  if (element.type === 'TabItem') await selectBraveTab(element.selector, deadlineAt);
  else if (/^(ComboBox|ListItem|RadioButton|CheckBox)$/.test(element.type ?? '')) await clickBraveElement(element.selector, deadlineAt);
  else if (element.isInvokable === true) await invokeBraveElement(element.selector, deadlineAt);
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
  documentSelector = undefined;
  scrollDocuments = [];
  foregroundReady = false;
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
