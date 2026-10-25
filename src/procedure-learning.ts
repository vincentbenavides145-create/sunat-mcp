import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserSnapshot } from './native-browser.js';

export type ProcedureOperation = 'consulta' | 'preparacion' | 'modificacion' | 'presentacion' | 'pago' | 'emision' | 'anulacion';
type StepKind = 'click' | 'fill';
interface ProcedureStep { action: StepKind; control: string }
interface Experience {
  steps: ProcedureStep[];
  observations: number;
  completions: number;
  lastObserved: string;
  result?: string;
  omittedControls: number;
}
interface ProcedureStore { schemaVersion: 1; procedures: Record<string, Record<string, Experience>> }
interface ActiveProcedure {
  flowId: string;
  id: string;
  operation: ProcedureOperation;
  steps: ProcedureStep[];
  omittedControls: number;
  observations: number;
  baselineResults: Set<string>;
  lastSnapshotAt: number;
  lastSavedSignature?: string;
  finished: boolean;
}

const directory = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'SUNAT MCP', 'learning');
const storeFile = path.join(directory, 'procedures.json');
const markdownFile = path.join(directory, 'procedures.md');
const operations: ProcedureOperation[] = ['consulta', 'preparacion', 'modificacion', 'presentacion', 'pago', 'emision', 'anulacion'];
let active: ActiveProcedure | undefined;
let writes: Promise<void> = Promise.resolve();

// Only canonical, application-owned vocabulary reaches disk. Unknown labels,
// field values, page bodies, URLs, selectors and account identities never do.
const controls: Record<string, string[]> = {
  'menu-personas': ['Personas'],
  'menu-empresas': ['Empresas'],
  'menu-aduanas': ['Operador de Comercio Exterior'],
  'menu-ruc': ['Mi RUC y Otros Registros', 'Mis Datos del RUC', 'RUC', 'Ficha RUC', 'Actualizo información de mi RUC'],
  'menu-sire': ['Sistema Integrado de Registros Electrónicos', 'Registros Electrónicos', 'Registro de Compras Electrónico', 'Registro de Ventas e Ingresos Electrónico', 'Gestión de Compras', 'Gestión de Ventas e Ingresos Electrónicos'],
  'menu-declaraciones': ['Mis declaraciones informativas', 'Consulto mis declaraciones y pagos', 'Declaraciones y pagos', 'Consulta general', 'Consultas de Presentación y Pago', 'Consulta de Declaraciones y Pagos'],
  'menu-laboral': ['T-Registro', 'Registro del Trabajador', 'Registro del Empleador', 'PLAME Web'],
  'menu-buzon': ['Buzón Electrónico'],
  'formulario-ruc': ['Formulario N° 3128 – Modificación de Datos del RUC', 'Form. 3128 Modificación de Datos del RUC', 'Suspensión / Reinicio de Actividades'],
  'formulario-devolucion': ['Mis devoluciones', 'Registro de Solicitud de Devolución 1649', 'Consulta de estado - Solicitud de devolución'],
  'formulario-fraccionamiento': ['Mi fraccionamiento', 'Solicito fraccionamiento art.36', 'Fracc Art.36', 'Form. Virtual 687 Sol. Fracc. Art.36 CT'],
  'formulario-621': ['Presentación y Pago', 'Declara Fácil', 'IGV Renta Mensual - 621'],
  buscar: ['Buscar', 'Realizar búsqueda'],
  consultar: ['Consultar', 'Consulta', 'Consultar estado'],
  validar: ['Validar', 'Validar datos', 'Validar RUC o DNI'],
  siguiente: ['Siguiente', 'Continuar'],
  anterior: ['Anterior', 'Regresar', 'Retornar', 'Volver'],
  aceptar: ['Aceptar', 'Aceptar propuesta', 'Aceptar Propuesta del RCE', 'Aceptar Propuesta del RVIE', 'Sí', 'Si'],
  guardar: ['Guardar', 'Grabar', 'Guardar cambios'],
  registrar: ['Registrar', 'Registrar pago', 'Registrar pagos', 'Registrar pedido'],
  presentar: ['Presentar', 'Presentar/Pagar', 'Presente/Pague', 'Enviar', 'Enviar solicitud', 'Enviar información'],
  generar: ['Generar', 'Generar registro', 'Generar registros', 'Generar solicitud', 'Generar reporte'],
  pagar: ['Pagar', 'Confirmar pago', 'Realizar pago'],
  emitir: ['Emitir', 'Emitir recibo', 'Emitir factura', 'Emitir boleta'],
  confirmar: ['Confirmar', 'Confirmar información'],
  cancelar: ['Cancelar', 'Anular'],
  nuevo: ['Nuevo', 'Agregar'],
  editar: ['Editar', 'Modificar'],
  excluir: ['Excluir', 'Excluidos'],
  eliminar: ['Eliminar'],
  actualizar: ['Actualizar', 'Actualizar propuesta'],
  propuesta: ['Propuesta', 'Propuesta del RCE', 'Propuesta del RVIE', 'Generación de Registro', 'Generación de Registros'],
  consultas: ['Consultas y Descargas', 'Información de Gestión', 'Estado de envío de ticket', 'Constancia de Recepción'],
  detalle: ['Detalle', 'Ver detalle', 'Ver preliminar', 'Datos generales', 'Registro individual'],
  bandeja: ['Agregar a Bandeja', 'Agregar a la Bandeja'],
  precalificacion: ['Precalificación', 'Generación de pedido de deuda', 'Elaborar solicitud', 'Confirmación y constancia'],
  periodo: ['Periodo', 'Período', 'Periodo tributario', 'Año', 'Mes', 'Ejercicio'],
  fechas: ['Fecha', 'Fecha de emisión', 'Fecha de pago', 'Desde', 'Hasta', 'Fecha Desde', 'Fecha Hasta'],
  formulario: ['Formulario', 'Número de formulario', 'Nro. Formulario'],
  documento: ['Número de documento', 'Tipo de documento', 'Número de orden', 'Número de solicitud', 'Número de ticket'],
  entidad: ['Entidad', 'Tipo de deuda', 'Tipo de solicitud', 'Tipo de depósito'],
  importe: ['Importe', 'Monto', 'Monto total', 'Importe a pagar', 'Monto Acogido', 'Tributo Insoluto'],
  moneda: ['Moneda', 'Tipo de moneda'],
  descripcion: ['Descripción', 'Descripción del servicio', 'Observación', 'Observaciones'],
  tributo: ['Tributo', 'Código de tributo', 'Código de Tributo Asociado', 'Régimen de renta'],
  modalidad: ['Forma de pago', 'Medio de pago', 'Modalidad de pago', 'Número de cuotas', 'Número de meses'],
  correccion: ['Casilla', 'Dice', 'Debe decir'],
  trabajador: ['Datos Laborales', 'Datos de Seguridad Social', 'Datos Tributarios', 'Situación Educativa', 'Mostrar Histórico de Prestadores'],
};
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
const canonicalLabels = new Map(Object.values(controls).flat().map((label) => [normalize(label), label]));
const displayControl = (key: string) => canonicalLabels.get(key) ?? '';
const resultPatterns: Array<{ code: string; operations: ProcedureOperation[]; pattern: RegExp }> = [
  { code: 'presentacion-confirmada', operations: ['presentacion'], pattern: /(?:su |la )?declaracion (?:jurada )?(?:(?:ha sido|fue) )?presentada (?:correctamente|exitosamente|satisfactoriamente)/ },
  { code: 'solicitud-registrada', operations: ['presentacion'], pattern: /(?:su |la )?solicitud (?:(?:ha sido|fue) )?registrada (?:correctamente|exitosamente|satisfactoriamente)/ },
  { code: 'pago-confirmado', operations: ['pago'], pattern: /(?:su |el )pago (?:(?:ha sido|fue) )?(?:realizado|efectuado|registrado) (?:correctamente|exitosamente|satisfactoriamente)/ },
  { code: 'emision-confirmada', operations: ['emision'], pattern: /(?:recibo(?: por honorarios)?|factura|boleta)(?: electronico| electronica)? (?:(?:ha sido|fue) )?emitid[oa] (?:correctamente|exitosamente|satisfactoriamente)/ },
  { code: 'modificacion-confirmada', operations: ['modificacion'], pattern: /(?:datos|cambios) (?:(?:han sido|fueron) )?(?:modificados|actualizados|registrados) (?:correctamente|exitosamente|satisfactoriamente)/ },
  { code: 'anulacion-confirmada', operations: ['anulacion'], pattern: /(?:comprobante|recibo|solicitud) (?:(?:ha sido|fue) )?anulad[oa] (?:correctamente|exitosamente|satisfactoriamente)/ },
  { code: 'registros-generados', operations: ['presentacion'], pattern: /(?:los )?registros (?:(?:han sido|fueron) )?generados (?:correctamente|exitosamente|satisfactoriamente)/ },
  { code: 'consulta-sin-resultados', operations: ['consulta'], pattern: /no se encontraron (?:registros|resultados) (?:para|con|que)/ },
];
const resultLabels: Record<string, string> = {
  'presentacion-confirmada': 'Mensaje explícito de presentación satisfactoria',
  'solicitud-registrada': 'Mensaje explícito de solicitud registrada',
  'pago-confirmado': 'Mensaje explícito de pago efectuado',
  'emision-confirmada': 'Mensaje explícito de comprobante emitido',
  'modificacion-confirmada': 'Mensaje explícito de datos actualizados',
  'anulacion-confirmada': 'Mensaje explícito de anulación realizada',
  'registros-generados': 'Mensaje explícito de generación de registros',
  'consulta-sin-resultados': 'Consulta ejecutada sin registros coincidentes',
  'constancia-presentacion': 'Constancia de presentación con identificador de la operación visible',
  'cir-visible': 'Comprobante de Información Registrada con número de transacción visible',
  'constancia-pago': 'Constancia de pago y datos de la operación visibles',
};

function isLearningPage(snapshot: BrowserSnapshot): boolean {
  try {
    const url = new URL(snapshot.url);
    return url.protocol === 'https:' && (url.hostname === 'sunat.gob.pe' || url.hostname.endsWith('.sunat.gob.pe'))
      && url.hostname !== 'api-seguridad.sunat.gob.pe' && !/login|autentica|logout/i.test(url.pathname)
      && !/iniciar sesi[oó]n|campo de contrase[nñ]a/i.test(snapshot.text);
  } catch { return false; }
}

function resultSignals(snapshot: BrowserSnapshot, operation: ProcedureOperation): Set<string> {
  // Exclude interactive labels: a button or link named "Constancia" is not
  // evidence that a transaction actually completed.
  const renderedText = normalize(snapshot.text.split(/\r?\n/).filter((line) => !/^\s*@e\d+\b|^URL:/i.test(line)).join(' '));
  const signals = new Set(resultPatterns.filter((item) => item.operations.includes(operation) && item.pattern.test(renderedText)).map((item) => item.code));
  if (!/vista previa|preliminar|borrador/.test(renderedText)) {
    if (operation === 'presentacion' && /constancia de presentacion/.test(renderedText) && /numero de orden|nro de orden|numero de transaccion/.test(renderedText)) signals.add('constancia-presentacion');
    if (operation === 'modificacion' && /comprobante de informacion registrada/.test(renderedText) && /numero de transaccion/.test(renderedText)) signals.add('cir-visible');
    if (operation === 'pago' && /constancia de pago/.test(renderedText) && /numero de operacion|numero de transaccion|importe pagado/.test(renderedText)) signals.add('constancia-pago');
  }
  return signals;
}

async function catalogIds(): Promise<Set<string>> {
  const catalog = JSON.parse(await readFile(new URL('../data/operation-index.json', import.meta.url), 'utf8')) as {
    publicProcedureGuide?: { records?: Array<{ id: string }> };
    observedRoutes?: Array<{ id: string }>;
  };
  const ids = new Set([
    ...(catalog.publicProcedureGuide?.records?.map((item) => item.id) ?? []),
    ...(catalog.observedRoutes?.map((item) => item.id) ?? []),
  ]);
  // New operations can attach to a confirmed local route without creating a
  // shared catalog entry or accepting arbitrary account-bearing identifiers.
  try {
    const local: unknown = JSON.parse(await readFile(path.join(directory, 'profile.json'), 'utf8'));
    if (isRecord(local) && isRecord(local.routes)) {
      for (const [id, route] of Object.entries(local.routes)) {
        if (/^aprendida-[a-f0-9]{32}$/.test(id) && isRecord(route) && Array.isArray(route.path) && route.path.length) ids.add(id);
      }
    }
  } catch { /* Local route discovery may not have run yet. */ }
  return ids;
}

export function resetProcedureLearning(): void { active = undefined; }
export function getProcedureLearningFlowId(): string | undefined { return active?.flowId; }

export async function selectProcedureLearning(id?: string, operation?: ProcedureOperation, snapshot?: BrowserSnapshot): Promise<void> {
  if (id === undefined) {
    if (operation && (!active || active.operation !== operation)) throw new Error('Indica procedureId al cambiar la operación del procedimiento.');
    return;
  }
  if (!(await catalogIds()).has(id)) throw new Error('procedureId debe identificar una ficha o ruta confirmada del catálogo/perfil local.');
  const mode = operation ?? (active?.id === id ? active.operation : 'consulta');
  if (active?.id === id && !active.finished) {
    if (active.operation !== mode) {
      active.operation = mode;
      active.flowId = randomUUID();
      active.baselineResults = snapshot && isLearningPage(snapshot) ? resultSignals(snapshot, mode) : new Set();
      active.lastSnapshotAt = snapshot?.capturedAt ?? 0;
      active.observations = snapshot && isLearningPage(snapshot) ? 1 : 0;
      active.lastSavedSignature = undefined;
    }
    return;
  }
  active = {
    flowId: randomUUID(), id, operation: mode, steps: [], omittedControls: 0, observations: snapshot && isLearningPage(snapshot) ? 1 : 0,
    baselineResults: snapshot && isLearningPage(snapshot) ? resultSignals(snapshot, mode) : new Set(),
    lastSnapshotAt: snapshot?.capturedAt ?? 0, finished: false,
  };
}

export function observeProcedureStep(action: StepKind, label: string): void {
  if (!active || active.finished) return;
  const control = normalize(label);
  if (!canonicalLabels.has(control)) { active.omittedControls++; return; }
  active.steps.push({ action, control });
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }

async function readStore(): Promise<ProcedureStore> {
  try {
    const raw: unknown = JSON.parse(await readFile(storeFile, 'utf8'));
    const ids = await catalogIds();
    const procedures: ProcedureStore['procedures'] = {};
    if (!isRecord(raw) || raw.schemaVersion !== 1 || !isRecord(raw.procedures)) return { schemaVersion: 1, procedures };
    for (const [key, variants] of Object.entries(raw.procedures)) {
      const parts = key.split(':');
      const [id, operation] = parts;
      if (parts.length !== 2 || !ids.has(id) || !operations.includes(operation as ProcedureOperation) || !isRecord(variants)) continue;
      const clean: Record<string, Experience> = {};
      for (const [signature, candidate] of Object.entries(variants)) {
        if (!/^[a-f0-9]{32}$/.test(signature) || !isRecord(candidate) || !Array.isArray(candidate.steps)) continue;
        if (!candidate.steps.every((step) => isRecord(step) && (step.action === 'click' || step.action === 'fill') && typeof step.control === 'string' && canonicalLabels.has(step.control))) continue;
        if (!Number.isSafeInteger(candidate.observations) || Number(candidate.observations) < 1
          || !Number.isSafeInteger(candidate.completions) || Number(candidate.completions) < 0
          || !Number.isSafeInteger(candidate.omittedControls) || Number(candidate.omittedControls) < 0
          || typeof candidate.lastObserved !== 'string' || !Number.isFinite(Date.parse(candidate.lastObserved))) continue;
        const result = typeof candidate.result === 'string' && Object.hasOwn(resultLabels, candidate.result) ? candidate.result : undefined;
        clean[signature] = {
          // Reconstruct objects instead of preserving arbitrary properties from disk.
          steps: candidate.steps.map((step) => ({ action: step.action, control: step.control })) as ProcedureStep[],
          observations: Number(candidate.observations), completions: result ? Number(candidate.completions) : 0,
          omittedControls: Number(candidate.omittedControls), lastObserved: new Date(candidate.lastObserved).toISOString(), ...(result ? { result } : {}),
        };
      }
      if (Object.keys(clean).length) procedures[key] = clean;
    }
    return { schemaVersion: 1, procedures };
  } catch { return { schemaVersion: 1, procedures: {} }; }
}

function renderExperience(key: string, variants: Record<string, Experience>, includeAll = false): string {
  const [id, operation] = key.split(':');
  const sorted = Object.values(variants).sort((a, b) => b.completions - a.completions || b.lastObserved.localeCompare(a.lastObserved));
  const latest = Object.values(variants).sort((a, b) => b.lastObserved.localeCompare(a.lastObserved))[0];
  const selected = includeAll ? sorted : [...new Set([sorted[0], latest])];
  const lines = ['### ' + id + ' / ' + operation, '', 'Observaciones locales de esta instalación; revalidar contra la pantalla y fuente actual. No autorizan acciones tributarias ni se ejecutan automáticamente. Conserva los requisitos, decisiones y datos necesarios de la ficha oficial.'];
  lines.push('Variantes conservadas: ' + sorted.length + '. La ficha muestra la variante más comprobada y la última observación distinta; el historial completo permanece en el archivo local.');
  for (const item of selected) {
    lines.push('', item.completions
      ? 'Resultado renderizado comprobado ' + item.completions + ' vez/veces: ' + resultLabels[item.result!]
      : 'Pasos observados; finalización no comprobada.');
    lines.push('Última observación: ' + item.lastObserved + '.');
    item.steps.forEach((step, index) => lines.push((index + 1) + '. ' + (step.action === 'fill' ? 'Completar el campo: ' : 'Accionar: ') + displayControl(step.control)));
    if (item.omittedControls) lines.push('Hay controles omitidos por privacidad o etiqueta desconocida; esta secuencia no es una receta completa de ejecución.');
  }
  return lines.join('\n');
}

async function persist(snapshot: ActiveProcedure, result?: string): Promise<void> {
  const store = await readStore();
  const key = snapshot.id + ':' + snapshot.operation;
  const signature = createHash('sha256').update(JSON.stringify([snapshot.steps, snapshot.omittedControls])).digest('hex').slice(0, 32);
  const variants = store.procedures[key] ?? {};
  const previous = variants[signature];
  // Replace the unfinished prefix from this same attempt; successful variants survive.
  if (snapshot.lastSavedSignature && snapshot.lastSavedSignature !== signature && variants[snapshot.lastSavedSignature]?.completions === 0) delete variants[snapshot.lastSavedSignature];
  variants[signature] = {
    steps: snapshot.steps.map((step) => ({ ...step })),
    observations: (previous?.observations ?? 0) + 1, completions: (previous?.completions ?? 0) + (result ? 1 : 0),
    lastObserved: new Date().toISOString(), omittedControls: snapshot.omittedControls,
    ...(result || previous?.result ? { result: result ?? previous?.result } : {}),
  };
  store.procedures[key] = variants;
  await mkdir(directory, { recursive: true });
  const temporary = storeFile + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, storeFile);
  const markdown = [
    '# Procedimientos observados en esta instalación SUNAT', '',
    'Complemento local de las fichas oficiales. Guarda únicamente controles canónicos, operación, conteos y fechas; nunca valores de formularios, cuentas, URL, páginas ni resultados fiscales.', '',
    ...Object.entries(store.procedures).map(([procedureKey, experiences]) => renderExperience(procedureKey, experiences, true)), '',
  ].join('\n');
  try {
    const temporaryMarkdown = markdownFile + '.' + randomUUID() + '.tmp';
    await writeFile(temporaryMarkdown, markdown, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryMarkdown, markdownFile);
  } catch {
    // The JSON observation is already committed; a derived Markdown failure
    // must not count the same completed phase again on the next snapshot.
  }
}

export async function observeProcedureSnapshot(snapshot?: BrowserSnapshot): Promise<void> {
  const current = active;
  if (!current || current.finished || !snapshot || !isLearningPage(snapshot) || snapshot.capturedAt <= current.lastSnapshotAt) return;
  current.lastSnapshotAt = snapshot.capturedAt;
  const signals = resultSignals(snapshot, current.operation);
  const result = [...signals].find((code) => !current.baselineResults.has(code));
  // Only a new rendered result after the preceding observation can certify a phase.
  current.baselineResults = signals;
  current.observations++;
  if (!current.steps.length) return;
  const completed = current.observations > 1 ? result : undefined;
  const copy = { ...current, steps: current.steps.map((step) => ({ ...step })) };
  const signature = createHash('sha256').update(JSON.stringify([copy.steps, copy.omittedControls])).digest('hex').slice(0, 32);
  if (!completed && current.lastSavedSignature === signature) return;
  const write = writes.then(() => persist(copy, completed));
  writes = write.catch(() => undefined);
  try {
    await write;
    current.lastSavedSignature = signature;
    if (completed) current.finished = true;
  } catch {
    // Observation storage must not fail or retry a SUNAT operation.
  }
}

export async function renderProcedureLearning(id?: string): Promise<string> {
  const store = await readStore();
  return renderStoredProcedureLearning(store, id);
}

export async function renderProcedureLearningBatch(ids: string[]): Promise<Record<string, string>> {
  const store = await readStore();
  return Object.fromEntries([...new Set(ids)].map((id) => [id, renderStoredProcedureLearning(store, id)]));
}

function renderStoredProcedureLearning(store: Awaited<ReturnType<typeof readStore>>, id?: string): string {
  const entries = Object.entries(store.procedures).filter(([key]) => id === undefined || key.startsWith(id + ':'));
  if (!entries.length) return '';
  if (id) return '\n\n## Aprendizaje local del procedimiento\n\n' + entries.map(([key, variants]) => renderExperience(key, variants)).join('\n\n');
  return '\n\n## Procedimientos con observaciones locales\n\n' + entries.map(([key, variants]) => {
    const [procedureId, operation] = key.split(':');
    const completions = Object.values(variants).reduce((sum, item) => sum + item.completions, 0);
    return '- sunat://procedimientos/' + procedureId + ' (' + operation + '; ' + completions + ' resultados comprobados).';
  }).join('\n');
}
