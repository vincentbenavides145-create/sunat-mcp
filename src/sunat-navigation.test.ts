import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import type { Page } from 'playwright-core';
import { entryPoints, entryPointUrls, isOfficialSunatUrl, isSunatEntryPoint, followSunatPopup } from './sunat-navigation.js';

test('the four public entries stay distinct and contain no authenticated redirect state', () => {
  assert.equal(new Set(Object.values(entryPointUrls)).size, 4);
  for (const entry of entryPoints) {
    const url = new URL(entryPointUrls[entry]);
    assert.equal(isOfficialSunatUrl(url.toString()), true);
    assert.ok([...url.searchParams.keys()].every((key) => ['exe', 'idFormulario'].includes(key)));
    assert.equal(isSunatEntryPoint(entry), true);
  }
  assert.equal(isSunatEntryPoint('constructor'), false);
  assert.equal(isSunatEntryPoint('https://example.com/'), false);
  assert.notEqual(entryPointUrls['renta-anual-personas'], entryPointUrls['renta-anual-empresas']);
});

function popupFixture() {
  const events = new EventEmitter();
  let detached = 0;
  const protocol = Object.assign(new EventEmitter(), {
    send: async (method: string) => { assert.equal(method, 'Page.enable'); },
    detach: async () => { detached++; },
  });
  const context = { newCDPSession: async () => protocol };
  const parent = {
    context: () => context,
    waitForEvent: (name: string, options: { timeout: number; signal: AbortSignal }) => new Promise<Page>((resolve, reject) => {
      const finish = (page?: Page) => {
        clearTimeout(timer); events.off(name, receive);
        options.signal.removeEventListener('abort', cancel);
        page ? resolve(page) : reject(new Error('cancelled'));
      };
      const receive = (page: Page) => finish(page);
      const cancel = () => finish();
      const timer = setTimeout(cancel, options.timeout);
      events.once(name, receive);
      options.signal.addEventListener('abort', cancel, { once: true });
    }),
  } as unknown as Page;
  const child = (url = 'https://e-menu.sunat.gob.pe/result', opener = parent, childContext: unknown = context) => ({
    context: () => childContext,
    opener: async () => opener,
    url: () => url,
    isClosed: () => false,
    waitForURL: async (predicate: (url: URL) => boolean) => { if (!predicate(new URL(url))) throw new Error('foreign'); },
    bringToFront: () => { throw new Error('must stay in background'); },
  }) as unknown as Page;
  return { parent, child, events, protocol, detached: () => detached };
}

test('normal clicks run once and remove the unused popup listener without waiting for a timeout', async () => {
  const f = popupFixture();
  let clicks = 0;
  assert.equal(await followSunatPopup(f.parent, async () => { clicks++; }), undefined);
  assert.equal(clicks, 1);
  assert.equal(f.events.listenerCount('popup'), 0);
  assert.equal(f.protocol.listenerCount('Page.windowOpen'), 0);
  assert.equal(f.detached(), 1);
});

test('a delayed official child is followed only through this page opener and existing context', async () => {
  const f = popupFixture();
  const child = f.child();
  const actual = await followSunatPopup(f.parent, async () => {
    f.protocol.emit('Page.windowOpen', { url: 'about:blank' });
    setImmediate(() => f.events.emit('popup', child));
  });
  assert.equal(actual, child);
  assert.equal(f.detached(), 1);
});

test('foreign origins, unrelated openers, different contexts and multiple windows never become the controlled page', async () => {
  for (const kind of ['foreign-request', 'foreign-result', 'other-opener', 'other-context', 'multiple']) {
    const f = popupFixture();
    const child = f.child(kind === 'foreign-result' ? 'https://example.com/' : undefined,
      kind === 'other-opener' ? {} as Page : f.parent,
      kind === 'other-context' ? {} : f.parent.context());
    await assert.rejects(followSunatPopup(f.parent, async () => {
      f.protocol.emit('Page.windowOpen', { url: kind === 'foreign-request' ? 'https://example.com/' : 'https://e-menu.sunat.gob.pe/result' });
      if (kind === 'multiple') f.protocol.emit('Page.windowOpen', { url: 'https://e-menu.sunat.gob.pe/other' });
      f.events.emit('popup', child);
    }), (error: any) => error.code === 'cdp_popup_unverified');
    assert.equal(f.events.listenerCount('popup'), 0);
    assert.equal(f.protocol.listenerCount('Page.windowOpen'), 0);
  }
});

test('missing popups and input failures stop without replaying the click', async () => {
  for (const uncertain of [false, true]) {
    const f = popupFixture();
    let clicks = 0;
    await assert.rejects(followSunatPopup(f.parent, async () => {
      clicks++;
      f.protocol.emit('Page.windowOpen', { url: 'https://e-menu.sunat.gob.pe/result' });
      if (uncertain) throw new Error('uncertain click');
    }, 10), (error: any) => error.code === 'cdp_popup_unverified');
    assert.equal(clicks, 1);
    assert.equal(f.detached(), 1);
  }
});
