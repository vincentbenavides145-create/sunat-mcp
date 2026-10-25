import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, type Browser, type Page, type Frame, type CDPSession } from 'playwright-core';
import { NativeUiError, type UiaElement, type UiaWindow } from './windows-ui.js';
import { acquireBrowserLease } from './process-lease.js';
import { isSunatLoginUrl } from './browser-context.js';
import { entryPointUrls, isSunatEntryPoint, isOfficialSunatUrl, followSunatPopup } from './sunat-navigation.js';
export { isOfficialSunatUrl } from './sunat-navigation.js';

const execFileAsync = promisify(execFile);
const timeout = 6000;
const sunatEntryUrl = 'https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?pestana=%2A&agrupacion=%2A';
type PageOperation = (args: Record<string, unknown>) => any;
interface LoadedPageOperation { revision: string; run: PageOperation }

/** Reload only the fixed local DOM adapter; never reconnect CDP or load a model-supplied path/script. */
export class ReloadablePageOperation {
  private cached?: LoadedPageOperation & { digest: string };
  private generation = 0;
  constructor(private readonly readSource = () => readFileSync(new URL('./cdp-page.js', import.meta.url), 'utf8')) {}
  current(): LoadedPageOperation {
    try {
      const source = this.readSource();
      const digest = createHash('sha256').update(source).digest('hex');
      if (this.cached?.digest === digest) return this.cached;
      const run: unknown = new Function(`return (${source}\n)`)();
      if (typeof run !== 'function') throw new Error();
      this.cached = { digest, revision: `${digest}:${++this.generation}`, run: run as PageOperation };
      return this.cached;
    } catch {
      this.cached = undefined;
      throw new NativeUiError('cdp_adapter_invalid', 'El adaptador local de navegación no se pudo cargar. Corrige src/cdp-page.js y obtén una lectura nueva; la conexión CDP se conserva y no se ejecutó una versión anterior.');
    }
  }
}
export function browserMode(): 'hybrid' | 'uia' {
  const mode = process.env.SUNAT_BROWSER_MODE ?? 'hybrid';
  if (mode !== 'hybrid' && mode !== 'uia') throw new NativeUiError('invalid_browser_mode', 'SUNAT_BROWSER_MODE debe ser hybrid o uia.');
  return mode;
}
export function localCdpEndpoint(value = process.env.SUNAT_CDP_ENDPOINT ?? 'http://127.0.0.1:9222'): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url;
  } catch { throw new NativeUiError('invalid_cdp_endpoint', 'SUNAT_CDP_ENDPOINT debe ser una dirección HTTP local de bucle local, sin credenciales, rutas ni parámetros.'); }
}
export function validateCdpWebsocket(value: string, endpoint: URL): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'ws:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || (url.port || '80') !== (endpoint.port || '80') || url.username || url.password || url.search || url.hash || !/^\/devtools\/browser\/[\w-]+$/.test(url.pathname)) throw new Error();
    return url.toString();
  } catch { throw new NativeUiError('invalid_cdp_websocket', 'Brave devolvió un destino CDP que no es local o no coincide con el puerto configurado.'); }
}

export function localListenerOwners(output: string, port: number): string[] {
  const listeners = output.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((row) => row[0] === 'TCP' && row[1]?.endsWith(`:${port}`) && /^(?:0\.0\.0\.0:0|\[::\]:0)$/.test(row[2] ?? '') && /^\d+$/.test(row.at(-1) ?? ''));
  if (listeners.some((row) => !/^(?:127\.0\.0\.1|\[::1\]):/.test(row[1]))) throw new NativeUiError('cdp_exposed_listener', 'El puerto de depuración no está limitado a la interfaz local. No se conectó.');
  return [...new Set(listeners.map((row) => row.at(-1)!))];
}

/** Verify ownership without disclosing process command lines or profile data. */
async function assertBraveListener(endpoint: URL): Promise<void> {
  if (process.platform !== 'win32') throw new NativeUiError('unsupported_platform');
  const port = Number(endpoint.port || 80);
  try {
    const options = { windowsHide: true, timeout: 3000, maxBuffer: 2 * 1024 * 1024 };
    const result = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], options);
    const owners = localListenerOwners(result.stdout, port);
    if (!owners.length) throw new Error();
    for (const owner of owners) {
      const process = await execFileAsync('tasklist.exe', ['/FI', `PID eq ${owner}`, '/FO', 'CSV', '/NH'], options);
      if (!/^"brave\.exe",/i.test(process.stdout.trim())) throw new Error();
    }
  } catch (error) {
    if (error instanceof NativeUiError) throw error;
    throw new NativeUiError('cdp_not_brave', 'El puerto CDP configurado no está disponible o no pertenece al Brave existente.');
  }
}

async function resolveWebsocket(endpoint: URL): Promise<string> {
  try {
    const response = await fetch(new URL('/json/version', endpoint), { signal: AbortSignal.timeout(2000), redirect: 'error' });
    if (response.ok) {
      const info = await response.json() as { webSocketDebuggerUrl?: string };
      if (info.webSocketDebuggerUrl) return validateCdpWebsocket(info.webSocketDebuggerUrl, endpoint);
    }
  } catch (error) { if (error instanceof NativeUiError) throw error; }
  // Recent Chromium builds can expose a browser WebSocket without /json/version.
  // This one metadata file is read locally; no cookies or profile storage are read.
  if (process.env.LOCALAPPDATA) {
    try {
      const file = path.join(process.env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data', 'DevToolsActivePort');
      const [port, browserPath] = (await readFile(file, 'utf8')).trim().split(/\r?\n/);
      if (port === (endpoint.port || '80')) return validateCdpWebsocket(`ws://${endpoint.hostname}:${port}${browserPath}`, endpoint);
    } catch (error) { if (error instanceof NativeUiError) throw error; }
  }
  throw new NativeUiError('cdp_unavailable', 'Brave no ofrece una conexión CDP válida. Habilita el acceso de depuración del navegador existente; el MCP no lo reinicia ni toma el foco como alternativa.');
}

interface PageRead { documentId: string; url: string; title: string; focused: boolean; children: UiaElement[] }
interface Reference { frame: Frame; id: string; documentId: string }

function pageOperationError(error: unknown): NativeUiError {
  const message = (error as Error)?.message ?? '';
  const reasons: Record<string, string> = {
    cdp_authentication_required: 'SUNAT solicita autenticación. Usa el inicio de sesión nativo; CDP no lee credenciales.',
    stale_reference: 'El documento o control cambió. Obtén una lectura nueva antes de continuar.',
    label_not_clickable: 'La etiqueta del control no está dentro del área visible. No se ejecutó el clic.',
    target_obscured: 'Otro control cubre el destino. No se ejecutó el clic; revisa una lectura nueva.',
    no_scroll_container: 'La página no expone un panel desplazable.',
  };
  for (const [code, description] of Object.entries(reasons)) if (new RegExp(`\\b${code}\\b`).test(message)) return new NativeUiError(code, description);
  return new NativeUiError('cdp_operation_failed', 'La operación CDP no se pudo verificar. No se repitió ni se cambió a entrada nativa.');
}

export class CdpSunatBrowser {
  private page?: Page;
  private pendingBinding?: Promise<void>;
  private opening?: Promise<Page>;
  private references = new Map<string, Reference>();
  private frameIds = new WeakMap<Frame, number>();
  private nextFrame = 0;
  private readonly binding = randomBytes(4).readUInt32BE();
  private operation?: LoadedPageOperation;
  constructor(private readonly browser: Browser, private readonly pageOperations = new ReloadablePageOperation()) {}
  private refreshOperation(requireSameRevision = false): LoadedPageOperation {
    let next: LoadedPageOperation;
    try { next = this.pageOperations.current(); }
    catch (error) { this.references.clear(); this.operation = undefined; throw error; }
    if (this.operation?.revision !== next.revision) {
      this.references.clear();
      if (requireSameRevision) {
        throw new NativeUiError('cdp_adapter_changed', 'El adaptador de navegación cambió. Obtén una lectura nueva antes de actuar; no se repitió la acción ni se reconectó CDP.');
      }
      this.operation = next;
    }
    return this.operation!;
  }
  connected(): boolean { return this.browser.isConnected(); }
  async bind(): Promise<void> {
    if (this.pendingBinding) return this.pendingBinding;
    const pending = this.bindPage();
    this.pendingBinding = pending;
    try { await pending; }
    finally { if (this.pendingBinding === pending) this.pendingBinding = undefined; }
  }
  private async bindPage(): Promise<void> {
    if (!this.connected()) throw new NativeUiError('cdp_disconnected');
    if (this.page) {
      if (!this.page.isClosed() && isOfficialSunatUrl(this.page.url())) return;
      // Never navigate the user's replacement tab or carry its old controls forward.
      this.references.clear();
      this.page = undefined;
      this.opening = undefined;
    }
    // A failed/uncertain creation remains latched: another call must not create duplicates.
    if (this.opening) { this.page = await this.opening; return; }
    const contexts = this.browser.contexts();
    const candidates = contexts.flatMap((context) => context.pages()).filter((page) => !page.isClosed() && isOfficialSunatUrl(page.url()));
    if (candidates.length > 1) throw new NativeUiError('cdp_ambiguous_tab', 'Brave tiene varias pestañas HTTPS de SUNAT. No se eligió una cuenta ni se abrió otra pestaña.');
    if (candidates.length === 1) { this.page = candidates[0]; return; }
    if (contexts.length !== 1) throw new NativeUiError('cdp_ambiguous_context', 'No se pudo identificar un único contexto existente de Brave para abrir SUNAT. No se creó otro perfil ni navegador.');
    this.opening = this.openBackgroundPage(contexts[0]);
    this.page = await this.opening;
  }
  private async openBackgroundPage(context: ReturnType<Browser['contexts']>[number]): Promise<Page> {
    const abort = new AbortController();
    let control: CDPSession | undefined;
    try {
      control = await this.browser.newBrowserCDPSession();
      let target: Promise<{ targetId: string }>;
      const opened = context.waitForEvent('page', {
        timeout,
        signal: abort.signal,
        predicate: async (page) => {
          const expected = await target;
          const session = await context.newCDPSession(page);
          try { return (await session.send('Target.getTargetInfo')).targetInfo.targetId === expected.targetId; }
          finally { await session.detach(); }
        },
      });
      // Protocol sessions share the existing CDP connection; they do not reconnect Brave.
      target = control.send('Target.createTarget', { url: sunatEntryUrl, background: true });
      const [, page] = await Promise.all([target, opened]);
      await page.waitForURL((url) => isOfficialSunatUrl(url.toString()), { waitUntil: 'domcontentloaded', timeout });
      if (page.isClosed() || !isOfficialSunatUrl(page.url())) throw new Error();
      return page;
    } catch {
      throw new NativeUiError('cdp_tab_creation_failed', 'No se pudo verificar la nueva pestaña SUNAT. No se repitió la apertura, no se cambió el foco ni se reconectó CDP. Revisa Brave antes de recargar el MCP.');
    } finally {
      abort.abort();
      await control?.detach().catch(() => {});
    }
  }
  private async current(): Promise<Page> {
    await this.bind();
    if (isSunatLoginUrl(this.page!.url())) throw new NativeUiError('cdp_authentication_required', 'El inicio de sesión se realiza con sunat_iniciar_sesion mediante UI Automation.');
    return this.page!;
  }
  private async run(frame: Frame, args: Record<string, unknown>): Promise<any> {
    if (!this.operation) throw new NativeUiError('stale_reference');
    const { run, revision } = this.operation;
    try { return await frame.evaluate(run, { ...args, adapterRevision: revision }); }
    catch (error) { throw pageOperationError(error); }
  }
  private async frameVisible(frame: Frame, page: Page): Promise<boolean> {
    if (frame === page.mainFrame()) return true;
    const parent = frame.parentFrame();
    if (!parent || !isOfficialSunatUrl(parent.url()) || !await this.frameVisible(parent, page)) return false;
    const element = await frame.frameElement();
    try {
      return await element.isVisible() && await element.evaluate((el) => {
        if (!(el instanceof Element)) return false;
        const box = el.getBoundingClientRect();
        const x = (Math.max(0, box.left) + Math.min(innerWidth, box.right)) / 2;
        const y = (Math.max(0, box.top) + Math.min(innerHeight, box.bottom)) / 2;
        return document.elementFromPoint(x, y) === el;
      });
    } finally { await element.dispose(); }
  }
  async snapshot(): Promise<{ window: UiaWindow; url: URL; background: boolean; accountRuc?: string }> {
    this.refreshOperation();
    this.references.clear();
    const page = await this.current();
    const roots: UiaElement[] = [];
    const nextReferences = new Map<string, Reference>();
    let background = false;
    for (const frame of page.frames()) {
      if (!isOfficialSunatUrl(frame.url())) continue;
      if (!await this.frameVisible(frame, page)) continue;
      const read = await this.run(frame, { operation: 'snapshot' }) as PageRead;
      if (frame === page.mainFrame()) background = !read.focused;
      if (!isOfficialSunatUrl(read.url)) throw new NativeUiError('cdp_session_changed');
      let frameId = this.frameIds.get(frame);
      if (!frameId) { frameId = ++this.nextFrame; this.frameIds.set(frame, frameId); }
      const prefix = `cdp:${frameId}:${read.documentId}`;
      const visit = (element: UiaElement) => {
        if (element.selector) {
          const id = element.selector;
          element.selector = `${prefix}:${id}`;
          nextReferences.set(element.selector, { frame, id, documentId: read.documentId });
        }
        element.children?.forEach(visit);
      };
      read.children.forEach(visit);
      roots.push({ type: 'Document', selector: prefix, name: read.title, value: read.url, children: read.children });
    }
    if (!roots.length) throw new NativeUiError('cdp_no_document');
    this.references = nextReferences;
    const accountRuc: unknown = await this.run(page.mainFrame(), { operation: 'account' });
    return { window: { hwnd: this.binding, title: 'SUNAT (CDP)', elements: roots }, url: new URL(page.url()), background, ...(typeof accountRuc === 'string' && /^\d{11}$/.test(accountRuc) ? { accountRuc } : {}) };
  }
  private async element(selector: string) {
    const operation = this.refreshOperation(true);
    await this.current();
    const reference = this.references.get(selector);
    if (!reference || !isOfficialSunatUrl(reference.frame.url()) || !await this.frameVisible(reference.frame, this.page!)) throw new NativeUiError('stale_reference');
    let handle;
    try { handle = await reference.frame.evaluateHandle(operation.run, { operation: 'element', id: reference.id, documentId: reference.documentId, adapterRevision: operation.revision }); }
    catch (error) { throw pageOperationError(error); }
    const element = handle.asElement();
    if (!element) { await handle.dispose(); throw new NativeUiError('stale_reference'); }
    return element;
  }
  async click(selector: string): Promise<{ contextChanged: boolean }> {
    let dispatched = false;
    const element = await this.element(selector);
    try {
      const reference = this.references.get(selector)!;
      const entryPoint = await this.run(reference.frame, { operation: 'entry-point', id: reference.id, documentId: reference.documentId });
      if (isSunatEntryPoint(entryPoint)) {
        dispatched = true;
        await this.navigate(entryPointUrls[entryPoint]);
        return { contextChanged: true };
      }
      const tag = await element.evaluate((el) => el.tagName);
      if (tag === 'OPTION') {
        const value = await element.getAttribute('value');
        const parent = await element.evaluateHandle((el) => el.closest('select'));
        try { if (!parent.asElement()) throw new NativeUiError('stale_reference'); dispatched = true; await parent.asElement()!.selectOption(value ?? { label: await element.innerText() }, { timeout, force: true }); }
        finally { await parent.dispose(); }
      } else {
        const reference = this.references.get(selector)!;
        await this.run(reference.frame, { operation: 'scroll-element', id: reference.id, documentId: reference.documentId });
        const position = await this.run(reference.frame, { operation: 'point', id: reference.id, documentId: reference.documentId });
        if (!await this.frameVisible(reference.frame, this.page!)) throw new NativeUiError('target_obscured');
        const popup = await followSunatPopup(this.page!, () => { dispatched = true; return element.click({ timeout, noWaitAfter: true, force: true, position }); });
        if (popup) {
          this.references.clear();
          this.page = popup;
          this.opening = undefined;
          return { contextChanged: true };
        }
      }
      return { contextChanged: false };
    } catch (error) {
      this.references.clear();
      const failure = error instanceof NativeUiError ? error : new NativeUiError('cdp_click_failed', 'No se pudo verificar el clic CDP. No se repitió.');
      failure.actionDispatched = dispatched;
      throw failure;
    }
    finally { await element.dispose(); }
  }
  async fill(selector: string, text: string): Promise<void> {
    const element = await this.element(selector);
    try {
      if (await element.evaluate((el) => el.tagName) === 'SELECT') await element.selectOption({ label: text }, { timeout, force: true });
      else {
        const menuSearch = await element.evaluate((el) => el.id === 'txtBusca' && location.hostname === 'e-menu.sunat.gob.pe' && /^\/cl-ti-itmenu\/MenuInternet\.htm$/i.test(location.pathname));
        if (menuSearch === true) {
          // SOL's menu filter listens to keyboard events, not just input/change.
          // Keep keyboard delivery inside the bound CDP page, never on Windows.
          await element.fill('', { timeout, force: true });
          if (text) await element.type(text, { timeout });
          else await element.press('End', { timeout });
        } else await element.fill(text, { timeout, force: true });
      }
    } finally { await element.dispose(); }
  }
  async scroll(direction?: string, selector?: string): Promise<void> {
    if (selector) {
      this.refreshOperation(true);
      await this.current();
      const reference = this.references.get(selector);
      if (!reference || !isOfficialSunatUrl(reference.frame.url()) || !await this.frameVisible(reference.frame, this.page!)) throw new NativeUiError('stale_reference');
      await this.run(reference.frame, { operation: 'scroll-element', id: reference.id, documentId: reference.documentId });
    } else {
      this.refreshOperation();
      const page = await this.current();
      const visibleFrames = [];
      for (const candidate of page.frames()) if (isOfficialSunatUrl(candidate.url()) && await this.frameVisible(candidate, page)) visibleFrames.push(candidate);
      const frame = visibleFrames.at(-1);
      if (!frame) throw new NativeUiError('cdp_no_document');
      await this.run(frame, { operation: 'scroll', direction });
    }
  }
  async navigate(url: string): Promise<void> {
    if (!isOfficialSunatUrl(url)) throw new NativeUiError('foreign_url');
    this.refreshOperation();
    // Navigation to a public entry also works when the current tab is at login.
    await this.bind();
    try { await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout }); }
    finally { this.references.clear(); }
  }
  async waitForLabel(label: string, waitMs: number, stopOnGate = false): Promise<boolean> {
    const page = await this.current();
    const deadline = Date.now() + Math.max(1, waitMs);
    // An iframe can still be about:blank at entry, or be attached later. Only
    // inspect current official, visible frames during this requested wait.
    do {
      if (!this.connected() || page.isClosed() || !isOfficialSunatUrl(page.url())) return false;
      for (const frame of page.frames()) {
        if (!isOfficialSunatUrl(frame.url())) continue;
        try {
          if (!await this.frameVisible(frame, page)) continue;
          if (await frame.getByText(label, { exact: true }).first().isVisible()) return true;
          if (stopOnGate && await frame.getByText(/no se encuentra registrado como obligado|no est[aá] registrado como obligado|acceso no autorizado|no (?:se encuentra|est[aá]) autorizado|no tiene acceso/i).first().isVisible()) return false;
        } catch { /* A loading/replaced frame is checked fresh on the next condition read. */ }
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining)));
    } while (Date.now() <= deadline);
    return false;
  }
  async screenshot(): Promise<Buffer> { return await (await this.current()).screenshot({ timeout }); }
  async disconnect(): Promise<void> { await this.browser.close(); }
}

/** One permission-bearing connection per MCP session, shared even during startup. */
export class CdpSessionConnection<T extends { connected(): boolean; disconnect(): Promise<void> }> {
  private current?: T;
  private pending?: Promise<T>;
  private failed = false;
  private closed = false;
  constructor(private readonly create: () => Promise<T>) {}
  state(): 'idle' | 'connecting' | 'connected' | 'blocked' | 'closed' {
    if (this.closed) return 'closed';
    if (this.current?.connected()) return 'connected';
    if (this.current || this.failed) return 'blocked';
    return this.pending ? 'connecting' : 'idle';
  }
  get(): Promise<T> {
    if (this.closed) return Promise.reject(new NativeUiError('cdp_session_closed', 'La sesión CDP terminó. No se abrió otra conexión.'));
    if (this.current?.connected()) return Promise.resolve(this.current);
    if (this.current) this.failed = true;
    if (this.failed) return Promise.reject(new NativeUiError('cdp_reconnect_required', 'La conexión CDP falló o se perdió. No se volvió a solicitar depuración. Recarga el MCP cuando quieras iniciar una nueva conexión.'));
    if (this.pending) return this.pending;
    const pending = Promise.resolve().then(this.create).then(async (connection) => {
      if (this.closed) {
        await connection.disconnect();
        throw new NativeUiError('cdp_session_closed', 'La sesión MCP terminó mientras se conectaba CDP.');
      }
      this.current = connection;
      return connection;
    });
    this.pending = pending;
    void pending.then(() => { this.pending = undefined; }, () => { this.pending = undefined; this.failed = true; });
    return pending;
  }
  async close(): Promise<void> {
    this.closed = true;
    const current = this.current;
    this.current = undefined;
    await current?.disconnect();
  }
}

async function connectInitialCdp(): Promise<CdpSunatBrowser> {
  const endpoint = localCdpEndpoint();
  acquireBrowserLease();
  await assertBraveListener(endpoint);
  const websocket = await resolveWebsocket(endpoint);
  try {
    const browser = await chromium.connectOverCDP(websocket, { timeout: 30_000, noDefaults: true });
    return new CdpSunatBrowser(browser);
  } catch (error) {
    const reason = (error as Error)?.name === 'TimeoutError' ? 'cdp_connection_timeout' : 'cdp_unavailable';
    throw new NativeUiError(reason, 'Brave no aceptó la conexión CDP local. Revisa su autorización de depuración; no se cambió el foco ni se reinició el navegador.');
  }
}
const connection = new CdpSessionConnection(connectInitialCdp);
export function getCdpBrowser(): Promise<CdpSunatBrowser> { return connection.get(); }
export function getCdpConnectionState() { return connection.state(); }
export async function disconnectCdp(): Promise<void> {
  await connection.close();
}
