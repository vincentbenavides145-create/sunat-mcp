import { readFile } from 'node:fs/promises';
import type { BrowserSnapshot } from './native-browser.js';

export const operations = ['consulta', 'preparacion', 'modificacion', 'presentacion', 'pago', 'emision', 'anulacion'] as const;
export type WorkOperation = typeof operations[number];
const mutations: Record<string, WorkOperation[]> = {
  'ruc-modificacion-3128': ['modificacion'], 'ruc-suspension-reinicio': ['modificacion'],
  'sire-rvie-rce-sol': ['modificacion', 'presentacion'], 'sire-rce-complementar': ['modificacion'],
  'declara-facil-621': ['presentacion', 'pago'], 'detracciones-pago': ['pago'],
  'rhe-emision': ['emision'], 'rhe-registro-pagos': ['modificacion'], 'see-sol-factura': ['emision', 'anulacion'],
  't-registro': ['modificacion'], 'plame-web-601': ['presentacion', 'pago'], 'devolucion-1649': ['presentacion'],
  'fraccionamiento-art36': ['presentacion', 'pago'], 'modificacion-1693': ['modificacion'],
  'reconocimiento-pago-error': ['presentacion'], 'renta-anual-personas-709': ['presentacion', 'pago'],
  'renta-anual-empresas-710': ['presentacion', 'pago'], 'exporta-facil': ['presentacion'],
};

let catalogPromise: ReturnType<typeof loadWorkflowCatalog> | undefined;
export function procedureOperations(id: string): WorkOperation[] { return ['consulta', 'preparacion', ...(mutations[id] ?? [])]; }
export function workflowCatalog() { return catalogPromise ??= loadWorkflowCatalog(); }
async function loadWorkflowCatalog() {
  const catalog = JSON.parse(await readFile(new URL('../data/operation-index.json', import.meta.url), 'utf8'));
  return (catalog.publicProcedureGuide.records as Array<{ id: string; title: string; entryPoint?: string; entryPoints?: string[]; profiles: string[]; evidence: string }>).map((item) => ({
    id: item.id, title: item.title, entryPoints: item.entryPoints ?? [item.entryPoint], profiles: item.profiles,
    guide: `sunat://procedimientos/${item.id}`, evidence: item.evidence,
    operations: procedureOperations(item.id),
    execution: 'assisted' as const,
    verification: mutations[item.id]?.length ? 'rendered-evidence-or-human-reconciliation' : 'consultation',
  }));
}

export async function requireWorkflow(id: string, operation: WorkOperation): Promise<void> {
  const workflow = (await workflowCatalog()).find((item) => item.id === id);
  if (!workflow || !workflow.operations.includes(operation)) throw new Error('La ficha no admite esta finalidad en el gestor de trabajos. Consulta sunat://flujos; una guía no es un flujo fiscal certificado.');
}

export function renderedEvidence(snapshot: Pick<BrowserSnapshot, 'text' | 'url'>, operation: WorkOperation): string | undefined {
  const url = new URL(snapshot.url);
  if (url.protocol !== 'https:' || !(url.hostname === 'sunat.gob.pe' || url.hostname.endsWith('.sunat.gob.pe')) || /login|autentica/i.test(url.pathname)) return;
  const text = snapshot.text.split('\n').filter((line) => !/^\s*@e\d+\b|^URL:/i.test(line)).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').toLowerCase();
  if (/vista previa|preliminar|borrador|pendiente|procesando|acceso no autorizado|error/.test(text)) return;
  if (!receiptIdentifiers(snapshot.text, operation).length) return;
  if (operation === 'presentacion' && /constancia de presentacion|declaracion .*presentada (?:correctamente|exitosamente|satisfactoriamente)/.test(text) && /numero de orden|nro de orden|numero de transaccion/.test(text)) return 'presentation-receipt';
  if (operation === 'presentacion' && /solicitud .*registrada (?:correctamente|exitosamente|satisfactoriamente)/.test(text) && /numero de solicitud|numero de orden|numero de transaccion/.test(text)) return 'request-receipt';
  if (operation === 'presentacion' && /registros .*generados (?:correctamente|exitosamente|satisfactoriamente)/.test(text) && /periodo|constancia/.test(text)) return 'registers-receipt';
  if (operation === 'pago' && /constancia de pago|pago .*efectuado (?:correctamente|exitosamente|satisfactoriamente)/.test(text) && /numero de operacion|numero de transaccion|importe pagado/.test(text)) return 'payment-receipt';
  if (operation === 'emision' && /(?:recibo|factura|boleta).*emitid[oa] (?:correctamente|exitosamente|satisfactoriamente)/.test(text) && /serie|numero|nro/.test(text)) return 'issue-receipt';
  if (operation === 'modificacion' && /comprobante de informacion registrada|(?:datos|cambios) .*actualizados (?:correctamente|exitosamente|satisfactoriamente)/.test(text) && /numero de transaccion|numero de orden/.test(text)) return 'update-receipt';
  if (operation === 'anulacion' && /(?:comprobante|recibo|solicitud).*anulad[oa] (?:correctamente|exitosamente|satisfactoriamente)/.test(text) && /numero|nro|serie/.test(text)) return 'void-receipt';
}

function receiptIdentifiers(text: string, operation: WorkOperation): string[] {
  const rendered = text.split('\n').filter((line) => !/^\s*@e\d+\b|^URL:/i.test(line)).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').toLowerCase();
  const pattern = operation === 'emision' || operation === 'anulacion'
    ? /\b(?:serie|numero|nro) ([a-z]\d{3}(?: \d+)?|\d+)\b/g
    : /\b(?:numero|nro) (?:de )?(?:orden|transaccion|operacion|solicitud) ([a-z]*\d[a-z0-9]*)\b/g;
  const identifiers = [...rendered.matchAll(pattern)].map((match) => match[0]);
  if (operation === 'presentacion' && /registros .*generados/.test(rendered)) identifiers.push(...[...rendered.matchAll(/\bperiodo (?:\d{4} \d{2}|\d{6}|\d{2} \d{4})\b/g)].map((match) => match[0]));
  return [...new Set(identifiers)].sort();
}

/** Stable evidence comparison: changing references or the SOL clock is not a new tax result. */
export function evidenceContent(snapshot: Pick<BrowserSnapshot, 'text'>, operation?: WorkOperation): string {
  // Compare receipt identifiers, not unrelated changes around a previously visible receipt.
  if (operation) return JSON.stringify(receiptIdentifiers(snapshot.text, operation));
  return snapshot.text.split('\n').filter((line) => !/^\s*@e\d+\b|^URL:/i.test(line) && !/^\s*-\s*generic\s*"\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?"\s*$/.test(line)).join('\n');
}
