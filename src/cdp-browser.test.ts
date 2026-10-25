import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { JSDOM } from 'jsdom';
import type { Browser, Frame, Page } from 'playwright-core';
import { CdpSunatBrowser, CdpSessionConnection, ReloadablePageOperation, localCdpEndpoint, validateCdpWebsocket, isOfficialSunatUrl, localListenerOwners } from './cdp-browser.js';
import { buildNativeSnapshot, describeSnapshotReference, findSnapshotReferencesByLabel, isTaxCommitControl } from './native-browser.js';
import { entryPointUrls, type SunatEntryPoint } from './sunat-navigation.js';
import type { UiaElement } from './windows-ui.js';

const menu = 'https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm';
const source = readFileSync(new URL('./cdp-page.js', import.meta.url), 'utf8');
function fixture(html: string, url = menu) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute('data-zero')) return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
    const offscreen = this.hasAttribute('data-below');
    return { x: 0, y: offscreen ? 900 : 10, left: 0, top: offscreen ? 900 : 10, right: 100, bottom: offscreen ? 930 : 40, width: 100, height: 30, toJSON: () => ({}) };
  };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.document.elementFromPoint = () => dom.window.document.querySelector('button')!;
  const run = dom.window.eval(`(${source})`) as (args: Record<string, unknown>) => any;
  return { dom, run };
}
const walk = (nodes: UiaElement[]): UiaElement[] => nodes.flatMap((node) => [node, ...walk(node.children ?? [])]);
function popupFree(page: Page): Page {
  const session = Object.assign(new EventEmitter(), { send: async () => ({}), detach: async () => {} });
  const context = { newCDPSession: async () => session };
  return Object.assign(page, {
    context: () => context,
    waitForEvent: (_event: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
}

test('local adapter reload caches unchanged content and detects edits without a watcher or mtime dependency', () => {
  let contents = '(args) => ({ version: 1, operation: args.operation })';
  const loader = new ReloadablePageOperation(() => contents);
  const first = loader.current();
  assert.equal(loader.current(), first);
  contents = '(args) => ({ version: 2, operation: args.operation })';
  const second = loader.current();
  assert.notEqual(second.revision, first.revision);
  assert.deepEqual(second.run({ operation: 'snapshot' }), { version: 2, operation: 'snapshot' });
  assert.equal(loader.current(), second);
});

test('an invalid, missing or partially saved adapter stops safely, then recovers without reusing old references', () => {
  let contents = '(args) => args.operation';
  let missing = false;
  const loader = new ReloadablePageOperation(() => {
    if (missing) throw new Error('synthetic-private-path');
    return contents;
  });
  const first = loader.current();
  for (const invalid of ['(args) => {', '42', '(() => { throw new Error("synthetic-private-source") })()']) {
    contents = invalid;
    assert.throws(() => loader.current(), (error: any) => error.code === 'cdp_adapter_invalid' && !/synthetic-private/.test(error.message));
  }
  missing = true;
  assert.throws(() => loader.current(), (error: any) => error.code === 'cdp_adapter_invalid' && !/synthetic-private/.test(error.message));
  missing = false;
  contents = '(args) => args.operation';
  const recovered = loader.current();
  assert.notEqual(recovered.revision, first.revision);
  assert.equal(recovered.run({ operation: 'snapshot' }), 'snapshot');
});

test('a live driver reloads DOM code on its existing connection and invalidates references and tax fingerprints', async () => {
  const { dom } = fixture('<button>Consultar</button>');
  let contents = source;
  const loader = new ReloadablePageOperation(() => contents);
  let attempts = 0;
  let disconnected = 0;
  let clicks = 0;
  let evaluations = 0;
  const evaluate = (fn: Function, args: Record<string, unknown>) => {
    evaluations++;
    const run = dom.window.eval(`(${fn.toString()})`) as (args: Record<string, unknown>) => unknown;
    return run(args);
  };
  const handle = { evaluate: async () => 'BUTTON', click: async () => { clicks++; }, dispose: async () => {}, asElement: () => handle };
  const frame = {
    url: () => menu,
    evaluate: async (fn: Function, args: Record<string, unknown>) => evaluate(fn, args),
    evaluateHandle: async (fn: Function, args: Record<string, unknown>) => { evaluate(fn, args); return handle; },
  } as unknown as Frame;
  const page = { url: () => menu, isClosed: () => false, mainFrame: () => frame, frames: () => [frame], bringToFront: () => { throw new Error('focus theft'); } } as unknown as Page;
  popupFree(page);
  const browser = { isConnected: () => true, contexts: () => [{ pages: () => [page] }], close: async () => { disconnected++; } } as unknown as Browser;
  const session = new CdpSessionConnection(async () => { attempts++; return new CdpSunatBrowser(browser, loader); });
  try {
    const driver = await session.get();
    const first = await driver.snapshot();
    const firstReference = walk(first.window.elements!).find((node) => node.type === 'Button')!.selector!;
    const firstFingerprint = buildNativeSnapshot(first.window, first.url).approvalFingerprint;
    const beforeEdit = evaluations;
    contents = source.replace('title: document.title,', 'title: document.title + " (recargado)",');
    assert.notEqual(contents, source);
    await assert.rejects(driver.click(firstReference), (error: any) => error.code === 'cdp_adapter_changed');
    assert.equal(clicks, 0);
    assert.equal(evaluations, beforeEdit, 'no stale DOM action was executed');
    const second = await driver.snapshot();
    assert.match(second.window.elements![0].name!, /recargado/);
    const secondReference = walk(second.window.elements!).find((node) => node.type === 'Button')!.selector!;
    assert.notEqual(secondReference, firstReference);
    assert.notEqual(buildNativeSnapshot(second.window, second.url).approvalFingerprint, firstFingerprint);
    await assert.rejects(driver.click(firstReference), (error: any) => error.code === 'stale_reference');
    await driver.click(secondReference);
    assert.equal(clicks, 1);
    contents = '(args) => {';
    const beforeFailure = evaluations;
    await assert.rejects(driver.snapshot(), (error: any) => error.code === 'cdp_adapter_invalid');
    assert.equal(evaluations, beforeFailure, 'invalid code cannot fall back to the previous adapter');
    assert.equal(session.state(), 'connected');
    contents = source;
    const third = await driver.snapshot();
    assert.notEqual(walk(third.window.elements!).find((node) => node.type === 'Button')!.selector, secondReference);
    assert.equal(await session.get(), driver);
    assert.equal(attempts, 1);
    assert.equal(disconnected, 0);
  } finally { await session.close(); dom.window.close(); }
  assert.equal(disconnected, 1);
});

test('account verification reads only the rendered authenticated SOL header, never a receiver RUC', () => {
  const { dom, run } = fixture('<div id="divCabecera"><span>RUC: 00000000001</span></div><main>RUC: 00000000002</main>');
  try {
    assert.equal(run({ operation: 'account' }), '00000000001');
    dom.window.document.getElementById('divCabecera')!.setAttribute('hidden', '');
    assert.equal(run({ operation: 'account' }), undefined);
    dom.window.document.getElementById('divCabecera')!.remove();
    assert.equal(run({ operation: 'account' }), undefined);
  } finally { dom.window.close(); }
});

test('the payment platform header verifies its emitter without granting transaction controls menu privileges', () => {
  const { dom, run } = fixture('<div id="divCabecera">RUC: 00000000001</div><main>RUC: 00000000002</main>', 'https://e-menu.sunat.gob.pe/cl-ti-itmenu2/MenuInternetPlataforma.htm');
  try {
    assert.equal(run({ operation: 'account' }), '00000000001');
    dom.window.document.getElementById('divCabecera')!.remove();
    assert.equal(run({ operation: 'account' }), undefined);
  } finally { dom.window.close(); }
});

test('SOL delegated menu rows and profile tabs have references without selecting submenu containers or layout copies', () => {
  const { dom, run } = fixture(`
    <div id="divOpcionServicio1" class="divOpcionServicio"><span>Personas</span></div>
    <div id="divOpcionServicio2" class="divOpcionServicio"><span>Empresas</span></div>
    <div id="divTodasOpciones"><ul class="ulMenu">
      <li id="nivel1_11" class="nivel1 liOpcion">Comprobantes de pago</li>
      <li id="nivel1Cuerpo_11" class="nivel1Cuerpo liCuerpo"><ul>
        <li id="nivel2_11_5" class="nivel2 liOpcion">SEE - SOL</li>
        <li class="liCuerpo"><ul>
          <li class="nivel3 liOpcion">Boleta de Venta Electrónica</li>
          <li class="liCuerpo"><ul><li id="boleta" class="nivel4 liOpcion">Emitir Boleta de Venta</li></ul></li>
        </ul></li>
      </ul></li>
    </ul><ul class="ulMenu"><li data-zero class="liOpcion">Emitir Boleta de Venta</li></ul></div>
    <form><button>Emitir Boleta de Venta</button></form>
    <ul><li class="liOpcion">Emitir Boleta de Venta</li></ul>`);
  try {
    const first = run({ operation: 'snapshot' });
    const nodes = walk(first.children);
    assert.equal(nodes.find((node) => node.name === 'Empresas')?.type, 'TabItem');
    assert.equal(nodes.find((node) => node.automationId === 'nivel1Cuerpo_11')?.selector, undefined);
    assert.ok(nodes.some((node) => node.automationId === 'nivel1_11' && node.selector));
    const snapshot = buildNativeSnapshot({ hwnd: 777, elements: [{ type: 'Document', value: menu, children: first.children }] }, new URL(menu));
    const refs = findSnapshotReferencesByLabel(snapshot.text, 'Emitir Boleta de Venta');
    assert.equal(refs.length, 2, 'one menu row and one final form button; zero-size copy and unrelated list are omitted');
    const references = refs.map((ref) => describeSnapshotReference(snapshot.text, ref.ref)!);
    assert.equal(references.filter((ref) => ref.navigation && !isTaxCommitControl(ref)).length, 1);
    assert.equal(references.filter((ref) => isTaxCommitControl(ref)).length, 1, 'the form button still requires approval');
    const next = run({ operation: 'snapshot' });
    assert.equal(walk(next.children).find((node) => node.automationId === 'boleta')?.selector, nodes.find((node) => node.automationId === 'boleta')?.selector);
  } finally { dom.window.close(); }
});

test('SOL menu class names on a transaction page do not grant navigation approval', () => {
  const { dom, run } = fixture('<div id="divTodasOpciones"><ul class="ulMenu"><li class="liOpcion">Emitir Boleta de Venta</li></ul></div>', 'https://ww1.sunat.gob.pe/form');
  try {
    assert.equal(walk(run({ operation: 'snapshot' }).children).some((node) => node.selector), false);
  } finally { dom.window.close(); }
});

test('SOL deduplicates only exact sibling service copies and preserves different actions and branches', () => {
  const { dom, run } = fixture(`<div id="divTodasOpciones"><ul class="ulMenu">
    <li id="nivel4_11_5_4_1_1" class="liOpcion" data-route="same">Emitir Boleta de Venta</li>
    <li id="nivel4_11_5_4_1_1" class="liOpcion" data-route="same">Emitir Boleta de Venta</li>
    <li id="nivel4_11_5_4_1_1" class="liOpcion" data-route="different">Emitir Boleta de Venta</li>
  </ul><ul class="ulMenu"><li id="nivel4_11_5_4_1_1" class="liOpcion" data-route="same">Emitir Boleta de Venta</li></ul></div>`);
  try {
    const rows = walk(run({ operation: 'snapshot' }).children).filter((node) => node.selector && node.name === 'Emitir Boleta de Venta');
    assert.equal(rows.length, 3, 'only the identical sibling is omitted; action and branch ambiguity remain');
  } finally { dom.window.close(); }
});

test('menu search delivers keyboard events within CDP while normal form fills keep their value semantics', async () => {
  const { dom, run } = fixture('<input id="txtBusca" placeholder="Busque una opción del menú"><input id="amount" aria-label="Importe">');
  const calls: unknown[] = [];
  let search = true;
  const handle = {
    evaluate: async (fn: Function) => fn.toString().includes('el.id') ? search : 'INPUT',
    fill: async (...args: unknown[]) => { calls.push(['fill', args[0]]); },
    type: async (...args: unknown[]) => { calls.push(['type', args[0]]); },
    press: async (...args: unknown[]) => { calls.push(['key', args[0]]); },
    dispose: async () => {},
    asElement: () => handle,
  };
  const frame = { url: () => menu, evaluate: async (_fn: unknown, args: Record<string, unknown>) => run(args), evaluateHandle: async (_fn: unknown, args: Record<string, unknown>) => { run(args); return handle; } } as unknown as Frame;
  const page = { url: () => menu, isClosed: () => false, mainFrame: () => frame, frames: () => [frame], bringToFront: () => { throw new Error('focus theft'); } } as unknown as Page;
  const driver = new CdpSunatBrowser({ isConnected: () => true, contexts: () => [{ pages: () => [page] }] } as unknown as Browser);
  try {
    const snapshot = await driver.snapshot();
    const nodes = walk(snapshot.window.elements!);
    const selector = nodes.find((node) => node.automationId === 'txtBusca')!.selector!;
    await driver.fill(selector, 'boleta');
    await driver.fill(selector, '');
    search = false;
    await driver.fill(nodes.find((node) => node.automationId === 'amount')!.selector!, '120');
    assert.deepEqual(calls, [['fill', ''], ['type', 'boleta'], ['fill', ''], ['key', 'End'], ['fill', '120']]);
  } finally { dom.window.close(); }
});

test('concurrent requests and later batches share one CDP connection', async () => {
  let attempts = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  const browser = { connected: () => true, disconnect: async () => {} };
  const session = new CdpSessionConnection(async () => { attempts++; await ready; return browser; });
  assert.equal(session.state(), 'idle');
  assert.equal(session.state(), 'idle');
  assert.equal(attempts, 0);
  const requests = Array.from({ length: 12 }, () => session.get());
  assert.equal(session.state(), 'connecting');
  assert.ok(requests.every((request) => request === requests[0]));
  release();
  assert.ok((await Promise.all(requests)).every((result) => result === browser));
  assert.equal(await session.get(), browser);
  assert.equal(attempts, 1);
  assert.equal(session.state(), 'connected');
  await session.close();
  assert.equal(session.state(), 'closed');
});

test('a rejected debugging connection is not requested again by following calls', async () => {
  let attempts = 0;
  const session = new CdpSessionConnection(async () => { attempts++; throw new Error('permission denied'); });
  await assert.rejects(session.get(), /permission denied/);
  for (let index = 0; index < 5; index++) await assert.rejects(session.get(), (error: any) => error.code === 'cdp_reconnect_required');
  assert.equal(attempts, 1);
});

test('a lost connection stops without opening another debugging session', async () => {
  let attempts = 0;
  let connected = true;
  const session = new CdpSessionConnection(async () => { attempts++; return { connected: () => connected, disconnect: async () => {} }; });
  await session.get();
  connected = false;
  assert.equal(session.state(), 'blocked');
  await assert.rejects(session.get(), (error: any) => error.code === 'cdp_reconnect_required');
  await assert.rejects(session.get(), (error: any) => error.code === 'cdp_reconnect_required');
  assert.equal(attempts, 1);
  await session.close();
});

test('shutdown during authorization closes a late connection and never reconnects', async () => {
  let release!: (browser: { connected(): boolean; disconnect(): Promise<void> }) => void;
  let disconnected = 0;
  const session = new CdpSessionConnection(() => new Promise<{ connected(): boolean; disconnect(): Promise<void> }>((resolve) => { release = resolve; }));
  const pending = session.get();
  await Promise.resolve();
  await session.close();
  release({ connected: () => true, disconnect: async () => { disconnected++; } });
  await assert.rejects(pending, (error: any) => error.code === 'cdp_session_closed');
  await assert.rejects(session.get(), (error: any) => error.code === 'cdp_session_closed');
  assert.equal(disconnected, 1);
});

test('CDP accepts only local endpoints and rejects redirected/nonlocal WebSocket targets', () => {
  const endpoint = localCdpEndpoint('http://127.0.0.1:9222');
  assert.equal(validateCdpWebsocket('ws://127.0.0.1:9222/devtools/browser/synthetic-id', endpoint), 'ws://127.0.0.1:9222/devtools/browser/synthetic-id');
  for (const url of ['http://example.com:9222', 'http://127.0.0.1.evil:9222', 'http://user:password@127.0.0.1:9222', 'http://127.0.0.1:9222/?token=value', 'file:///tmp/server', 'ws://127.0.0.1:9222/devtools/browser/id']) assert.throws(() => localCdpEndpoint(url));
  for (const url of ['ws://example.com:9222/devtools/browser/id', 'ws://127.0.0.1:9999/devtools/browser/id', 'ws://127.0.0.1:9222/devtools/page/id', 'ws://127.0.0.1:9222/devtools/browser/id?secret=value']) assert.throws(() => validateCdpWebsocket(url, endpoint));
  assert.equal(isOfficialSunatUrl('https://sunat.gob.pe.evil/'), false);
  assert.equal(isOfficialSunatUrl('http://e-menu.sunat.gob.pe/'), false);
});

test('a loopback URL cannot hide a debugging listener exposed on the network', () => {
  assert.deepEqual(localListenerOwners('TCP 127.0.0.1:9222 0.0.0.0:0 LISTENING 123\nTCP [::1]:9222 [::]:0 LISTENING 123\nTCP 127.0.0.1:9999 0.0.0.0:0 LISTENING 456', 9222), ['123']);
  assert.throws(() => localListenerOwners('TCP 0.0.0.0:9222 0.0.0.0:0 LISTENING 123', 9222), (error: any) => error.code === 'cdp_exposed_listener');
  assert.throws(() => localListenerOwners('TCP [::]:9222 [::]:0 LISTENING 123', 9222));
});

test('DOM operations preserve menu ancestry, stable references and exact approval values without credentials', () => {
  const { dom, run } = fixture('<div id="divSubMenuIzquierda"><a href="#">Emitir Factura</a></div><label for="amount">Importe</label><input id="amount" value="10"><input name="username" value="synthetic-secret"><button>Emitir Factura</button><div hidden><button>Hidden</button></div>');
  try {
    const first = run({ operation: 'snapshot' });
    const nodes = walk(first.children);
    assert.doesNotMatch(JSON.stringify(first), /synthetic-secret|Hidden/);
    const input = nodes.find((node) => node.name === 'Importe' && node.type === 'Edit')!;
    assert.equal(input.value, '10');
    const window = { hwnd: 777, elements: [{ type: 'Document', selector: first.documentId, name: 'SUNAT', value: menu, children: first.children }] };
    const snapshot = buildNativeSnapshot(window, new URL(menu));
    const refs = findSnapshotReferencesByLabel(snapshot.text, 'Emitir Factura');
    assert.equal(refs.length, 2);
    const references = refs.map((ref) => describeSnapshotReference(snapshot.text, ref.ref)!);
    assert.equal(references.filter((ref) => isTaxCommitControl(ref)).length, 1);
    (dom.window.document.getElementById('amount') as HTMLInputElement).value = '20';
    const second = run({ operation: 'snapshot' });
    assert.equal(walk(second.children).find((node) => node.name === 'Importe' && node.type === 'Edit')!.selector, input.selector);
    const changed = buildNativeSnapshot({ ...window, elements: [{ ...window.elements[0], children: second.children }] }, new URL(menu));
    assert.notEqual(snapshot.approvalFingerprint, changed.approvalFingerprint);
  } finally { dom.window.close(); }
});

test('DOM operations reject login/password pages, foreign origins and stale or replaced controls', () => {
  for (const [html, url] of [['<input type="password" value="secret">', menu], ['<p>Login</p>', 'https://api-seguridad.sunat.gob.pe/v1/loginMenuSol'], ['<p>Other site</p>', 'https://example.com/']]) {
    const { dom, run } = fixture(html, url);
    try { assert.throws(() => run({ operation: 'snapshot' }), /cdp_authentication_required/); } finally { dom.window.close(); }
  }
  const { dom, run } = fixture('<button>Consultar</button>');
  try {
    const read = run({ operation: 'snapshot' });
    const target = walk(read.children).find((node) => node.type === 'Button')!;
    assert.throws(() => run({ operation: 'element', id: target.selector, documentId: 'other-document' }), /stale_reference/);
    dom.window.document.querySelector('button')!.remove();
    assert.throws(() => run({ operation: 'element', id: target.selector, documentId: read.documentId }), /stale_reference/);
    const replacement = dom.window.document.createElement('button');
    replacement.textContent = 'Consultar';
    dom.window.document.body.appendChild(replacement);
    const next = run({ operation: 'snapshot' });
    assert.notEqual(walk(next.children).find((node) => node.type === 'Button')!.selector, target.selector);
  } finally { dom.window.close(); }
});

test('CDP binds one SUNAT tab and its frames without activating unrelated tabs or Windows input', async () => {
  const { dom, run } = fixture('<button>Consultar</button>');
  const calls: string[] = [];
  let actionFailure = false;
  const handle = {
    evaluate: async () => 'BUTTON',
    click: async () => { calls.push('click'); if (actionFailure) throw new Error('uncertain click'); },
    fill: async () => { calls.push('fill'); },
    scrollIntoViewIfNeeded: async () => { calls.push('scroll'); },
    dispose: async () => {},
    asElement: () => handle,
  };
  const frame = { url: () => menu, evaluate: async (_fn: unknown, args: Record<string, unknown>) => { if (args.operation === 'scroll-element') calls.push('scroll'); return run(args); }, evaluateHandle: async (_fn: unknown, args: Record<string, unknown>) => { run(args); return handle; } } as unknown as Frame;
  const foreign = { url: () => 'https://example.com/', evaluate: () => { throw new Error('read unrelated frame'); } } as unknown as Frame;
  const page = { url: () => menu, isClosed: () => false, mainFrame: () => frame, frames: () => [frame, foreign], bringToFront: () => { throw new Error('focus theft'); } } as unknown as Page;
  const other = { url: () => 'https://example.com/', isClosed: () => false, frames: () => { throw new Error('read unrelated tab'); } } as unknown as Page;
  popupFree(page);
  const browser = { isConnected: () => true, contexts: () => [{ pages: () => [page, other] }] } as unknown as Browser;
  const driver = new CdpSunatBrowser(browser);
  try {
    const read = await driver.snapshot();
    assert.equal(read.window.elements!.length, 1);
    const target = walk(read.window.elements!).find((node) => node.type === 'Button')!;
    await driver.click(target.selector!);
    await driver.scroll(undefined, target.selector!);
    actionFailure = true;
    await assert.rejects(driver.click(target.selector!), (error: any) => error.code === 'cdp_click_failed' && error.actionDispatched === true && !/uncertain click/.test(error.message));
    assert.deepEqual(calls, ['scroll', 'click', 'scroll', 'scroll', 'click']);
    await assert.rejects(driver.click('cdp:other-document:1'));
    assert.equal(calls.length, 5);
  } finally { dom.window.close(); }
});

test('multiple SUNAT tabs are rejected instead of choosing an account from the active foreground', async () => {
  const page = () => ({ url: () => menu, isClosed: () => false });
  const driver = new CdpSunatBrowser({ isConnected: () => true, contexts: () => [{ pages: () => [page(), page()] }] } as unknown as Browser);
  await assert.rejects(driver.bind(), (error: any) => error.code === 'cdp_ambiguous_tab');
});

test('the rendered SOL portal entries navigate the bound tab without executing window.open handlers', async () => {
  const links: Array<[SunatEntryPoint, string]> = [
    ['declaraciones-pagos', 'javascript:declaraSimplificadaNueva()'],
    ['tramites-consultas', 'javascript:tramiteConsulta()'],
    ['renta-anual-personas', entryPointUrls['renta-anual-personas']],
    ['renta-anual-empresas', 'javascript:rentaEmpresa()'],
  ];
  for (const [entry, href] of links) {
    const { dom, run } = fixture(`<a href="${href}">Ingresar</a>`, 'https://www.sunat.gob.pe/sol.html');
    const navigations: string[] = [];
    const handle = { asElement: () => handle, dispose: async () => {}, click: () => { throw new Error('portal popup handler must not execute'); } };
    const frame = { url: () => dom.window.location.href, evaluate: async (_fn: unknown, args: Record<string, unknown>) => run(args), evaluateHandle: async (_fn: unknown, args: Record<string, unknown>) => { run(args); return handle; } } as unknown as Frame;
    const page = { url: () => dom.window.location.href, isClosed: () => false, mainFrame: () => frame, frames: () => [frame], goto: async (url: string) => { navigations.push(url); } } as unknown as Page;
    const driver = new CdpSunatBrowser({ isConnected: () => true, contexts: () => [{ pages: () => [page] }] } as unknown as Browser);
    try {
      const snapshot = await driver.snapshot();
      const selector = walk(snapshot.window.elements!).find((node) => node.type === 'Hyperlink')!.selector!;
      assert.deepEqual(await driver.click(selector), { contextChanged: true });
      assert.deepEqual(navigations, [entryPointUrls[entry]]);
      await assert.rejects(driver.click(selector), (error: any) => error.code === 'stale_reference');
    } finally { dom.window.close(); }
  }
});

test('portal entry shortcuts cannot be activated by copied markup on a transaction page', () => {
  const { dom, run } = fixture('<a href="javascript:declaraSimplificadaNueva()">Ingresar</a>');
  try {
    const snapshot = run({ operation: 'snapshot' });
    const link = walk(snapshot.children).find((node) => node.type === 'Hyperlink')!;
    assert.equal(run({ operation: 'entry-point', id: link.selector, documentId: snapshot.documentId }), undefined);
  } finally { dom.window.close(); }
});

function backgroundTabFixture(failCreation = false) {
  const calls: Array<{ method: string; args?: unknown }> = [];
  let closed = false;
  const other = { url: () => 'https://example.com/', isClosed: () => false } as Page;
  const page = { url: () => menu, isClosed: () => closed, waitForURL: async (predicate: (url: URL) => boolean, options: unknown) => {
    assert.equal(predicate(new URL(menu)), true);
    calls.push({ method: 'waitForURL', args: options });
  } } as unknown as Page;
  let pages = [other];
  let emit: (page: Page) => Promise<void>;
  const context = {
    pages: () => pages,
    waitForEvent: (_event: string, options: { predicate: (page: Page) => Promise<boolean>; signal: AbortSignal }) => new Promise<Page>((resolve, reject) => {
      emit = async (candidate) => { try { if (await options.predicate(candidate)) resolve(candidate); } catch (error) { reject(error); } };
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
    newCDPSession: async (candidate: Page) => ({
      send: async (method: string) => { assert.equal(method, 'Target.getTargetInfo'); return { targetInfo: { targetId: candidate === page ? 'sunat-new' : 'human-tab' } }; },
      detach: async () => {},
    }),
  };
  const browser = {
    isConnected: () => true,
    contexts: () => [context],
    newBrowserCDPSession: async () => ({
      send: async (method: string, args: any) => {
        calls.push({ method, args });
        assert.equal(method, 'Target.createTarget');
        assert.equal(args.background, true);
        assert.equal(new URL(args.url).hostname, 'e-menu.sunat.gob.pe');
        assert.equal(args.newWindow, undefined);
        assert.equal(args.browserContextId, undefined);
        if (failCreation) throw new Error('uncertain target creation');
        pages = [other, page];
        // A human-created tab event must never win the binding race.
        queueMicrotask(() => { void emit(other); void emit(page); });
        return { targetId: 'sunat-new' };
      },
      detach: async () => { calls.push({ method: 'detach' }); },
    }),
  } as unknown as Browser;
  return { browser, page, other, calls, close: () => { closed = true; pages = [other]; } };
}

test('missing SUNAT tab is created once in background in the existing context, including concurrent binds', async () => {
  const fixture = backgroundTabFixture();
  const driver = new CdpSunatBrowser(fixture.browser);
  await Promise.all([driver.bind(), driver.bind(), driver.bind()]);
  await driver.bind();
  assert.equal(fixture.calls.filter((call) => call.method === 'Target.createTarget').length, 1);
  assert.equal(fixture.calls.filter((call) => call.method === 'waitForURL').length, 1);
  assert.equal(fixture.other.url(), 'https://example.com/');
  assert.equal(fixture.calls.filter((call) => call.method === 'detach').length, 1);
});

test('uncertain tab creation is latched without duplicate openings or CDP reconnection', async () => {
  const fixture = backgroundTabFixture(true);
  let connections = 0;
  const connection = new CdpSessionConnection(async () => { connections++; return new CdpSunatBrowser(fixture.browser); });
  const driver = await connection.get();
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(driver.bind(), (error: any) => error.code === 'cdp_tab_creation_failed');
  }
  assert.equal(await connection.get(), driver);
  assert.equal(connections, 1);
  assert.equal(fixture.calls.filter((call) => call.method === 'Target.createTarget').length, 1);
});

test('zero SUNAT tabs with ambiguous existing contexts does not create another profile or target', async () => {
  const driver = new CdpSunatBrowser({ isConnected: () => true, contexts: () => [{ pages: () => [] }, { pages: () => [] }] } as unknown as Browser);
  await assert.rejects(driver.bind(), (error: any) => error.code === 'cdp_ambiguous_context');
});

test('expanded menu clicks use their own label and refuse an overlay instead of its hidden service', () => {
  const { dom, run } = fixture('<div id="divSubMenuIzquierda"><li id="parent"><span>Factura Electrónica</span><div><li>Emitir Factura</li></div></li></div><button id="overlay">Overlay</button>');
  try {
    const parent = dom.window.document.getElementById('parent')!;
    const label = parent.querySelector('span')!;
    (dom.window.Range.prototype as any).getBoundingClientRect = function () { return this.startContainer.parentElement.getBoundingClientRect(); };
    const read = run({ operation: 'snapshot' });
    const target = walk(read.children).find((node) => node.automationId === 'parent')!;
    assert.equal(target.name, 'Factura Electrónica');
    let scrolled: Element | undefined;
    dom.window.HTMLElement.prototype.scrollIntoView = function (options) { assert.equal((options as ScrollIntoViewOptions).block, 'center'); scrolled = this; };
    run({ operation: 'scroll-element', id: target.selector, documentId: read.documentId });
    assert.equal(scrolled, label);
    dom.window.document.elementFromPoint = () => label;
    const point = run({ operation: 'point', id: target.selector, documentId: read.documentId });
    assert.ok(point.x >= 0 && point.y >= 0);
    dom.window.document.elementFromPoint = () => dom.window.document.getElementById('overlay')!;
    assert.throws(() => run({ operation: 'point', id: target.selector, documentId: read.documentId }), /target_obscured/);
  } finally { dom.window.close(); }
});

test('SOL waits for its existing submenu animation before measuring a clipped label, without replaying input', async () => {
  const { dom, run } = fixture('<div id="divTodasOpciones"><ul class="ulMenu"><li id="nivel2_1" class="liOpcion"><span>Registros Electronicos</span></li></ul></div><button id="overlay">Overlay</button>');
  try {
    const label = dom.window.document.querySelector('span')!;
    dom.window.Range.prototype.getBoundingClientRect = function () { return this.startContainer.parentElement!.getBoundingClientRect(); };
    dom.window.document.elementFromPoint = () => dom.window.document.getElementById('overlay')!;
    let subscriptions = 0;
    const queue = { length: 1, parents() { return this; }, addBack() { return this; }, filter() { return this; }, promise() { return this; }, done(callback: () => void) {
      subscriptions++;
      setTimeout(() => { dom.window.document.elementFromPoint = () => label; callback(); }, 10);
    } };
    (dom.window as any).jQuery = Object.assign(() => queue, { fn: { jquery: 'synthetic' } });
    const read = run({ operation: 'snapshot' });
    const target = walk(read.children).find((node) => node.automationId === 'nivel2_1')!;
    const point = await run({ operation: 'point', id: target.selector, documentId: read.documentId });
    assert.equal(subscriptions, 1);
    assert.equal(point.x, 50);
  } finally { dom.window.close(); }
});

test('SOL exposes expanded sibling submenu state without applying it to transaction markup', () => {
  const html = '<div id="divTodasOpciones"><ul class="ulMenu"><li id="nivel1_1" class="liOpcion">Sistema</li><li class="liCuerpo"><ul><li id="nivel2_1" class="liOpcion">Registros</li></ul></li></ul></div>';
  const { dom, run } = fixture(html);
  try {
    const read = run({ operation: 'snapshot' });
    const node = walk(read.children).find((item) => item.automationId === 'nivel1_1')!;
    assert.equal(node.expandState, 'expanded');
    dom.window.document.querySelector('.liCuerpo')!.setAttribute('style', 'display:none');
    const collapsed = run({ operation: 'snapshot' });
    assert.equal(walk(collapsed.children).find((item) => item.automationId === 'nivel1_1')!.expandState, 'collapsed');
  } finally { dom.window.close(); }
});

test('label waits discover official frames attached after the wait starts and never inspect foreign frames', async () => {
  let reads = 0;
  const missing = { getByText: () => ({ first: () => ({ isVisible: async () => false }) }) };
  const root = { ...missing, url: () => menu } as unknown as Frame;
  const child = { url: () => 'https://e-menu.sunat.gob.pe/search', parentFrame: () => root,
    frameElement: async () => ({ isVisible: async () => true, evaluate: async () => true, dispose: async () => {} }),
    getByText: (label: string) => ({ first: () => ({ isVisible: async () => label === 'Consulta de Número de Pago SUNAT' }) }),
  } as unknown as Frame;
  const foreign = { url: () => 'https://example.com/', getByText: () => { throw new Error('foreign page read'); } } as unknown as Frame;
  const page = { url: () => menu, isClosed: () => false, mainFrame: () => root, frames: () => ++reads > 1 ? [root, foreign, child] : [root, foreign] } as unknown as Page;
  const browser = { isConnected: () => true, contexts: () => [{ pages: () => [page] }] } as unknown as Browser;
  assert.equal(await new CdpSunatBrowser(browser).waitForLabel('Consulta de Número de Pago SUNAT', 1000), true);
  assert.ok(reads > 1);
});

test('destination waits stop on an asynchronous obligation notice without claiming the requested label', async () => {
  let reads = 0;
  const root = { url: () => menu, getByText: (label: unknown) => ({ first: () => ({ isVisible: async () => label instanceof RegExp && ++reads > 1 }) }) } as unknown as Frame;
  const page = { url: () => menu, isClosed: () => false, mainFrame: () => root, frames: () => [root] } as unknown as Page;
  const browser = { isConnected: () => true, contexts: () => [{ pages: () => [page] }] } as unknown as Browser;
  assert.equal(await new CdpSunatBrowser(browser).waitForLabel('Propuesta', 1000, true), false);
  assert.equal(reads, 2);
});

test('hidden and foreign frames never enter a SUNAT snapshot', async () => {
  const root = { url: () => menu, evaluate: async () => ({ documentId: 'root', url: menu, title: 'SUNAT', children: [], focused: false }) } as unknown as Frame;
  const hidden = { url: () => 'https://ww1.sunat.gob.pe/form', parentFrame: () => root, frameElement: async () => ({ isVisible: async () => false, dispose: async () => {} }), evaluate: () => { throw new Error('read hidden frame'); } } as unknown as Frame;
  const page = { url: () => menu, isClosed: () => false, mainFrame: () => root, frames: () => [root, hidden] } as unknown as Page;
  const driver = new CdpSunatBrowser({ isConnected: () => true, contexts: () => [{ pages: () => [page] }] } as unknown as Browser);
  const read = await driver.snapshot();
  assert.equal(read.window.elements!.length, 1);
  assert.equal(read.background, true);
});
