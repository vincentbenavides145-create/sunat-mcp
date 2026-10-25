import type { Page } from 'playwright-core';
import { NativeUiError } from './windows-ui.js';

export const entryPoints = ['declaraciones-pagos', 'tramites-consultas', 'renta-anual-personas', 'renta-anual-empresas'] as const;
export type SunatEntryPoint = typeof entryPoints[number];

// Public bootstrap addresses, not authenticated redirects or campaign/form values.
export const entryPointUrls: Readonly<Record<SunatEntryPoint, string>> = Object.freeze({
  'declaraciones-pagos': 'https://e-menu.sunat.gob.pe/cl-ti-itmenu2/MenuInternetPlataforma.htm?exe=55.1.1.1.1',
  'tramites-consultas': 'https://e-menu.sunat.gob.pe/cl-ti-itmenucabina/MenuInternet.htm',
  'renta-anual-personas': 'https://e-renta.sunat.gob.pe/loader/recaudaciontributaria/declaracionpago/formularios?idFormulario=menu',
  // Retain the official company landing page; do not substitute the personal form.
  'renta-anual-empresas': 'https://www.sunat.gob.pe/renta/renta.html',
});
export function isSunatEntryPoint(value: unknown): value is SunatEntryPoint {
  return typeof value === 'string' && entryPoints.includes(value as SunatEntryPoint);
}
export function isOfficialSunatUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'sunat.gob.pe' || url.hostname.endsWith('.sunat.gob.pe')); } catch { return false; }
}

/** Observe just this click's popup, over the existing connection. No browser-wide last-tab selection. */
export async function followSunatPopup(page: Page, action: () => Promise<void>, timeout = 6000): Promise<Page | undefined> {
  const context = page.context();
  const session = await context.newCDPSession(page);
  const abort = new AbortController();
  let requests = 0;
  let invalidRequest = false;
  const opened = page.waitForEvent('popup', { timeout, signal: abort.signal });
  // Normal clicks do not wait for the timeout; abort removes the unused listener.
  void opened.catch(() => {});
  const windowOpen = ({ url }: { url: string }) => {
    requests++;
    if (url && url !== 'about:blank' && !isOfficialSunatUrl(url)) invalidRequest = true;
  };
  session.on('Page.windowOpen', windowOpen);
  try {
    await session.send('Page.enable');
    await action();
    if (!requests) return undefined;
    if (requests !== 1 || invalidRequest) throw new Error();
    const popup = await opened;
    if (popup.context() !== context || await popup.opener() !== page) throw new Error();
    await popup.waitForURL((url) => isOfficialSunatUrl(url.toString()), { waitUntil: 'domcontentloaded', timeout });
    if (requests !== 1 || invalidRequest || popup.isClosed() || !isOfficialSunatUrl(popup.url())) throw new Error();
    return popup;
  } catch (error) {
    if (!requests) throw error; // Keep an uncertain input error; never dispatch it again.
    throw new NativeUiError('cdp_popup_unverified', 'El clic abrió una ventana que no pudo vincularse de forma única y oficial a SUNAT. No se eligió otra pestaña ni se repitió el clic.');
  } finally {
    abort.abort();
    session.off('Page.windowOpen', windowOpen);
    await session.detach().catch(() => {});
  }
}
