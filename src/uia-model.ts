/** Types and pure helpers over the Windows UI Automation tree of Brave. No state and no native calls. */

import { isSunatLoginUrl, isSunatSessionPageUrl } from './browser-context.js';

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
  expandState?: string;
  children?: UiaElement[];
}

export interface UiaWindow {
  hwnd?: number;
  title?: string;
  className?: string;
  elements?: UiaElement[];
}

/** Owned credential/tooltip windows do not make one Brave main window ambiguous. */
export function selectBraveMainWindow(windows: Array<{ hwnd?: number; ownerHwnd?: number; processName?: string; className?: string }>): number | undefined {
  const main = windows.filter((window) => window.hwnd && window.ownerHwnd === 0 && /^brave$/i.test(window.processName ?? '') && window.className === 'Chrome_WidgetWin_1');
  return main.length === 1 ? main[0].hwnd : undefined;
}

export interface UiaInspectResult {
  windows?: UiaWindow[];
}

export interface UiaSearchResult { matchCount: number; hasMore?: boolean; matches: Array<UiaElement & { invokableAncestor?: UiaElement }> }

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

export function walk(elements: UiaElement[], visit: (element: UiaElement) => void): void {
  for (const element of elements) {
    visit(element);
    if (element.children) walk(element.children, visit);
  }
}

export function normalized(value: string | undefined): string {
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

export function browserUrl(window: UiaWindow): URL | undefined {
  const url = getBraveUrl(window);
  return url?.protocol === 'https:' && (url.hostname === 'sunat.gob.pe' || url.hostname.endsWith('.sunat.gob.pe')) ? url : undefined;
}

export function findLoginButton(window: UiaWindow): UiaElement | undefined {
  const buttons: UiaElement[] = [];
  walk(window.elements ?? [], (element) => {
    if (element.type === 'Button' && element.selector && element.isEnabled !== false && element.isOffscreen !== true &&
      /^(?:iniciar sesion|ingresar|entrar|login)$/i.test(normalized(element.name))) buttons.push(element);
  });
  return buttons.length === 1 ? buttons[0] : undefined;
}

export function loginPageIsOpen(state: UiaInspectResult): boolean {
  const sunatWindows = (state.windows ?? []).filter((window) => browserUrl(window));
  if (sunatWindows.length !== 1) return false;
  const url = browserUrl(sunatWindows[0]);
  return Boolean(url && isSunatLoginUrl(url.toString()));
}

export function loggedInToSunat(state: UiaInspectResult): boolean {
  const sunatWindows = (state.windows ?? []).filter((window) => browserUrl(window));
  if (sunatWindows.length !== 1) return false;
  const url = browserUrl(sunatWindows[0]);
  let logoutVisible = false;
  walk(sunatWindows[0].elements ?? [], (element) => {
    if (['Button', 'Hyperlink', 'Link'].includes(element.type ?? '') && element.isOffscreen !== true && element.isEnabled !== false && /^(?:salir|cerrar sesion|desconectar)$/.test(normalized(element.name))) logoutVisible = true;
  });
  return Boolean(url && isSunatSessionPageUrl(url.toString()) && logoutVisible);
}
