import { createHash } from 'node:crypto';
import type { UiaElement, UiaWindow } from './windows-ui.js';

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Ignore only auxiliary, read-only status regions. Unknown notices stay bound. */
function isAuxiliaryStatus(element: UiaElement): boolean {
  if (!/^(StatusBar|ToolTip|ProgressBar)$/.test(element.type ?? '')) return false;
  const labels: string[] = [];
  let editable = false;
  const collect = (node: UiaElement) => {
    if (node.name) labels.push(node.name);
    if (node.value) labels.push(node.value);
    if (node.isEditable || node.isInvokable || /^(Edit|ComboBox|CheckBox|RadioButton|Button|Hyperlink|Link|TabItem|MenuItem|TreeItem|ListItem)$/.test(node.type ?? '')) editable = true;
    for (const child of node.children ?? []) collect(child);
  };
  collect(element);
  const text = normalize(labels.join(' '));
  if (editable || /\b(ruc|dni|cuenta|contribuyente|importe|monto|total|saldo|tributo|periodo|pago|pagar|deuda|comprobante|declaracion|propuesta|solicitud|registro|confirmar|aceptar|igv|renta|retencion|presentar|emitir|enviar|generar|anular|cancelar|reemplazar|modificar|actualizar|excluir|eliminar|advertencia|obligacion|error|rechazado)\b/.test(text)) return false;
  const withoutClock = text.replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/g, '');
  if (/\d|s\/|\busd\b|\bpen\b|[$€]/.test(withoutClock)) return false;
  return /^(?:hora\b|reloj\b|ultima actualizacion\b|actualizado\b|cargando\b|aviso informativo\b|conexion\b)/.test(text.trim())
    || (element.type === 'ProgressBar' && !text.trim());
}

/** In-memory digest: account context, summaries, controls and exact values remain bound. */
export function buildApprovalFingerprint(window: UiaWindow, url: URL, roots: UiaElement[]): string {
  const state: unknown[] = [];
  const visit = (element: UiaElement) => {
    if (isAuxiliaryStatus(element)) return;
    if (element.type === 'Document') state.push(['Document', element.selector, element.value]);
    const input = element.isEditable || /^(Edit|ComboBox|CheckBox|RadioButton|ListItem)$/.test(element.type ?? '');
    if (input || element.isInvokable || element.selector && /^(Button|Hyperlink|Link|TabItem|MenuItem|TreeItem)$/.test(element.type ?? '')) {
      state.push([element.selector, element.type, element.name, element.value, element.isEnabled, element.isOffscreen, element.toggleState, element.isSelected]);
    } else if (element.name && element.isOffscreen !== true) {
      state.push([element.type, element.name, element.value]);
    }
    for (const child of element.children ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return createHash('sha256').update(JSON.stringify([window.hwnd, url.toString(), roots.map((root) => root.selector), state])).digest('hex');
}
