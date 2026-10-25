/** Accept only the official credential endpoints; never expose their query values. */
export function isSunatLoginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'api-seguridad.sunat.gob.pe' && !url.username && !url.password &&
      /^\/v1\/clientessol\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/oauth2\/login(?:MenuSol)?\/?$/i.test(url.pathname);
  } catch { return false; }
}
export function isSunatSessionPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'e-menu.sunat.gob.pe' || url.hostname === 'e-renta.sunat.gob.pe') && !/login|proceso-seguridad/i.test(url.pathname);
  } catch { return false; }
}

/** Browser chrome is authoritative for the active tab; iframe URLs are not. */
export async function verifyActiveSunatTab(
  driver: { readAddress(): Promise<string | undefined>; selectSunatTab(): Promise<boolean> },
  previousAddress?: string,
  allowNavigation = false,
): Promise<{ address?: string; changed: boolean }> {
  const official = (value?: string) => {
    try {
      const url = new URL(value!);
      return url.protocol === 'https:' && (url.hostname === 'sunat.gob.pe' || url.hostname.endsWith('.sunat.gob.pe'));
    } catch { return false; }
  };
  let address = await driver.readAddress();
  let restored = false;
  if (!official(address)) {
    const selected = await driver.selectSunatTab();
    if (!selected) {
      if (allowNavigation) return { address, changed: true };
      throw new Error('No se encontró una pestaña SOL existente en Brave.');
    }
    restored = true;
    address = await driver.readAddress();
    if (!official(address)) throw new Error('La pestaña seleccionada no muestra una URL HTTPS de SUNAT.');
  }
  return { address, changed: restored || address !== previousAddress };
}
