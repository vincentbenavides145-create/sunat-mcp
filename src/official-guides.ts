import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import type { PreparedProcedure } from './guide-procedures.js';

export const guideChannels = ['sol-web', 'web-sunat', 'app-movil', 'escritorio', 'api', 'banco', 'presencial', 'sin-determinar'] as const;
export type GuideChannel = typeof guideChannels[number];
export const guideOperations = ['consulta', 'preparacion', 'modificacion', 'presentacion', 'pago', 'emision', 'anulacion', 'generacion'] as const;

const official = (value: string): boolean => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !hasPrivateQuery(u) && (u.hostname === 'sunat.gob.pe' || u.hostname.endsWith('.sunat.gob.pe') || u.hostname === 'www.aduanet.gob.pe' || u.hostname === 'www.gob.pe' && u.pathname.startsWith('/institucion/sunat/')); }
  catch { return false; }
};
const hasPrivateQuery = (u: URL) => [...u.searchParams.keys()].some((key) => /token|auth|clave|pass|cookie|session|ticket|state|ruc|dni|usuario|username|secret|signature|expires|x-amz/i.test(key));
function sourceUrl(value: string): boolean {
  if (official(value)) return true;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !hasPrivateQuery(u) && (u.hostname === 'www.aduanet.gob.pe' || u.hostname === 'cdn.www.gob.pe' && u.pathname.startsWith('/uploads/document/file/') || u.hostname === 'www.youtube.com' && u.pathname === '/watch' && /^[\w-]{11}$/.test(u.searchParams.get('v') ?? '') && [...u.searchParams.keys()].every((key) => key === 'v'));
  } catch { return false; }
}
const text = z.string().min(1).max(400);
const guideSchema = z.object({
  id: z.string().regex(/^guia-[a-f0-9]{20}$/),
  title: text,
  url: z.string().url().refine(sourceUrl, 'Fuente pública oficial o video vinculado desde SUNAT requerido.'),
  kind: z.enum(['pagina', 'pdf', 'documento', 'archivo', 'video']),
  topics: z.array(text),
  discoveredFrom: z.array(z.string().url().refine(official)).min(1),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  publishedAt: z.string().max(100).nullable().optional(),
  reading: z.enum(['index-only', 'content-reviewed', 'transcript-reviewed', 'visual-reviewed', 'unavailable']),
  availability: z.enum(['indexed', 'retrieved', 'blocked', 'failed', 'no-transcript']),
  summary: z.string().min(1).max(2000).optional(),
  steps: z.array(z.object({ text, at: z.string().regex(/^\d{1,3}:\d{2}(?::\d{2})?$/).optional() })).optional(),
  limitations: z.array(text).optional(),
  publisher: text.optional(),
  purpose: z.enum(['procedimiento', 'referencia', 'tecnico', 'normativa', 'formulario', 'informativo']).optional(),
  channels: z.array(z.enum(guideChannels)).min(1).optional(),
  operations: z.array(z.enum(guideOperations)).optional(),
  channelBasis: z.enum(['texto-revisado', 'titulo', 'sin-evidencia']).optional(),
  historical: z.boolean().optional(),
  localProcedure: z.object({ requirements: z.array(text), checks: z.array(text), gaps: z.array(text), entryPoints: z.array(text), profiles: z.array(text) }).strict().optional(),
  contentFingerprint: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), basis: z.enum(['archivo', 'texto', 'subtitulos', 'video']) }).strict().optional(),
  sourceSections: z.array(text).optional(),
}).strict();
const catalogSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coverage: z.object({
    roots: z.array(z.string().url().refine(official)),
    pagesFetched: z.number().int().nonnegative(),
    pendingPages: z.number().int().nonnegative(),
    blockedPages: z.array(z.object({ url: z.string().url().refine(official), reason: text })),
    scope: z.string().min(1),
    removed: z.object({ unavailable: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative(), withoutProvenance: z.number().int().nonnegative() }).strict().optional(),
  }),
  records: z.array(guideSchema),
}).strict();
export type OfficialGuide = z.infer<typeof guideSchema>;
export type OfficialGuideCatalog = z.infer<typeof catalogSchema>;
const reviewed = (r: OfficialGuide) => r.reading.endsWith('-reviewed') && r.availability === 'retrieved';
const unavailable = (r: OfficialGuide) => r.reading === 'unavailable' || ['blocked', 'failed', 'no-transcript'].includes(r.availability);
export function classifyOfficialGuide(r: OfficialGuide): OfficialGuide {
  const title = normalize(r.title + ' ' + decodePath(r.url));
  const body = normalize([r.summary ?? '', ...(r.steps ?? []).map((s) => s.text)].join(' '));
  const words = title + ' ' + body;
  const technical = /\bapi\b|\bxml\b|\bubl\b|homologacion|web.?service|servicios? web|estructura de archivos|especificacion/.test(words);
  const promotional = /promocional|anuncio de|promueve pedir|no (?:explica|describe) (?:un )?procedimiento/.test(body);
  const purpose = r.purpose ?? (technical ? 'tecnico' : /resolucion|decreto|\brs[-_ ]|normativa/.test(title) ? 'normativa' : promotional ? 'informativo' : /borrador|formato para/.test(body) ? 'formulario' : reviewed(r) && r.steps?.length ? 'procedimiento' : 'referencia');
  const evidence = body || title;
  const channels: GuideChannel[] = [];
  if (/\bapi\b|web.?service|servicios? web/.test(evidence)) channels.push('api');
  if (/aplicacion movil|aplicativo movil|app (?:sunat|personas|emprender)|celular|desde (?:tu |mi )?movil/.test(evidence)) channels.push('app-movil');
  if (/desktop|escritorio|aplicativo cliente|utilitario excel|pvs|instala(?:r|cion)/.test(evidence)) channels.push('escritorio');
  if ((!technical || !channels.includes('api')) && /\bsol\b|operaciones en linea|mis declaraciones y pagos|declara facil/.test(evidence)) channels.push('sol-web');
  if (/ventanilla|agente bancario|entidad bancaria|banco|bancari/.test(evidence)) channels.push('banco');
  if (/presencial|centro de servicios/.test(evidence)) channels.push('presencial');
  if (!channels.length && /portal (?:sunat|oficial)|sunat virtual|sitio web/.test(evidence)) channels.push('web-sunat');
  const actionPatterns = { consulta: /consult|busca|verific/, preparacion: /prepara|completa/, modificacion: /modific|actualiz|exclu|rectifica|registrar|elimino|eliminar/, presentacion: /presenta|declaracion|enviar/, pago: /paga|pago/, emision: /emiti|emision|emite|emito/, anulacion: /anula|revierte|revertir|baja/, generacion: /gener(?:a|o)/ };
  const titleOperations = guideOperations.filter((op) => actionPatterns[op].test(title));
  const operations = r.operations ?? (titleOperations.length ? titleOperations : guideOperations.filter((op) => actionPatterns[op].test(body.split(/[.!?]/)[0])));
  const historical = r.historical ?? /historico|historica|obsoleto|interfaz antigua|flash/.test(normalize([r.url, ...(r.limitations ?? [])].join(' ')));
  const localProcedure = r.localProcedure ?? (purpose === 'procedimiento' ? {
    requirements: [], checks: (r.steps ?? []).filter((s) => /verific|comprob|revis|constancia|resultado/i.test(s.text)).map((s) => s.text),
    gaps: ['El resumen no separa todos los requisitos previos; comprobar los que correspondan al trámite.', ...(r.limitations ?? [])],
    entryPoints: /mis declaraciones y pagos/.test(body) ? ['declaraciones-pagos'] : /tramites y consultas/.test(body) ? ['tramites-consultas'] : [], profiles: [],
  } : undefined);
  const primaryMobile = /celular|movil|\bapp\b/.test(title) && !/\bsol\b/.test(title);
  return { ...r, purpose, channels: r.channels ?? (primaryMobile ? ['app-movil'] : channels.length ? [...new Set(channels)] : ['sin-determinar']), channelBasis: r.channelBasis ?? (primaryMobile && !/celular|movil|\bapp\b/.test(body) ? 'titulo' : channels.length ? body ? 'texto-revisado' : 'titulo' : 'sin-evidencia'), operations, historical, ...(localProcedure ? { localProcedure } : {}) };
}

export function freezeGuideData<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freezeGuideData(child); Object.freeze(value); }
  return value;
}
export function parseOfficialGuides(input: unknown): OfficialGuideCatalog {
  const catalog = catalogSchema.parse(input);
  const ids = new Set<string>(); const urls = new Set<string>();
  for (const guide of catalog.records) {
    if (ids.has(guide.id) || urls.has(guide.url)) throw new Error('Hay fuentes duplicadas en el catálogo oficial.');
    if (['transcript-reviewed', 'visual-reviewed'].includes(guide.reading) && (guide.kind !== 'video' || !guide.summary)) throw new Error('Un video revisado requiere un resumen sustentado; no se inventan pasos para videos conceptuales.');
    if (guide.reading.endsWith('-reviewed') && (!guide.summary || guide.availability !== 'retrieved')) throw new Error('La revisión requiere contenido recuperado y un resumen sustentado.');
    if (guide.reading === 'index-only' && guide.steps?.length) throw new Error('Un enlace inventariado no acredita pasos revisados.');
    if (catalog.schemaVersion === 2 && unavailable(guide)) throw new Error('El catálogo activo no admite fuentes fallidas ni videos inaccesibles.');
    ids.add(guide.id); urls.add(guide.url);
  }
  return freezeGuideData({ ...catalog, records: catalog.records.map(classifyOfficialGuide) });
}
export function cleanOfficialGuides(input: unknown): OfficialGuideCatalog {
  const data = catalogSchema.parse(input);
  const bad = new Set([...data.records.filter(unavailable).map((r) => r.url), ...data.coverage.blockedPages.map((r) => r.url)]);
  const removed = { unavailable: 0, duplicates: 0, withoutProvenance: 0, ...data.coverage.removed };
  const kept: OfficialGuide[] = []; const fingerprints = new Map<string, OfficialGuide>();
  for (const original of data.records) {
    if (unavailable(original) || bad.has(original.url)) { removed.unavailable++; continue; }
    const r = { ...original, discoveredFrom: original.discoveredFrom.filter((u) => !bad.has(u)) };
    if (!r.discoveredFrom.length) { removed.withoutProvenance++; continue; }
    const fingerprint = r.kind === 'pdf' && r.contentFingerprint?.basis === 'archivo' ? r.contentFingerprint.sha256 : undefined;
    const duplicate = fingerprint ? fingerprints.get(fingerprint) : undefined;
    if (duplicate) { duplicate.discoveredFrom = [...new Set([...duplicate.discoveredFrom, ...r.discoveredFrom])].sort(); removed.duplicates++; continue; }
    kept.push(r); if (fingerprint) fingerprints.set(fingerprint, r);
  }
  return parseOfficialGuides({ ...data, schemaVersion: 2, coverage: { ...data.coverage, roots: data.coverage.roots.filter((u) => !bad.has(u)), blockedPages: [], removed }, records: kept });
}
export function createOfficialGuideReader(read: () => Promise<string>) {
  let cached: { hash: string; catalog: OfficialGuideCatalog } | undefined;
  return async () => {
    try {
      const content = await read(); const hash = createHash('sha256').update(content).digest('hex');
      if (cached?.hash === hash) return cached.catalog;
      const catalog = parseOfficialGuides(JSON.parse(content)); cached = { hash, catalog }; return catalog;
    } catch { cached = undefined; throw new Error('No se pudo validar el catálogo de guías oficiales. No se reutilizó una versión anterior.'); }
  };
}
export const readOfficialGuides = createOfficialGuideReader(() => readFile(new URL('../data/official-guides.json', import.meta.url), 'utf8'));
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const stopWords = new Set(['de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'y', 'o', 'a', 'en', 'para', 'por', 'como']);
const decodePath = (url: string) => { const path = new URL(url).pathname; try { return decodeURIComponent(path); } catch { return path; } };
const word = (t: string) => ({ emitir: 'emision', emite: 'emision', emitido: 'emision', emitidos: 'emision', consultar: 'consulta', consultas: 'consulta', pagar: 'pago', pagos: 'pago', generar: 'generacion', genera: 'generacion', generacion: 'generacion', modificar: 'modificacion', actualizar: 'modificacion', boletas: 'boleta', facturas: 'factura', recibos: 'recibo', declaraciones: 'declaracion' } as Record<string, string>)[t] ?? t;
const termsFor = (s: string) => normalize(s).split(/[^\p{L}\p{N}]+/u).filter((t) => t && !stopWords.has(t)).map(word);
export interface GuideSearchOptions { scope?: 'operativo' | 'referencias' | 'todo'; channel?: GuideChannel; operation?: typeof guideOperations[number]; includeHistorical?: boolean; procedures?: PreparedProcedure[] }
const compiled = new WeakMap<OfficialGuideCatalog, { hash: string; entries: Array<{ record: OfficialGuide; title: string[]; body: string[] }> }>();
const compiledProcedures = new WeakMap<PreparedProcedure[], { hash: string; entries: Array<{ record: PreparedProcedure; title: string[]; body: string[] }> }>();
function compileProcedures(procedures: PreparedProcedure[]) {
  const cached = Object.isFrozen(procedures) ? compiledProcedures.get(procedures) : undefined;
  if (cached) return cached;
  const result = { hash: createHash('sha256').update(JSON.stringify(procedures)).digest('hex'), entries: procedures.map((p) => ({ record: p, title: termsFor([p.title, p.id, ...p.aliases].join(' ')), body: termsFor([p.title, p.id, ...p.aliases, ...p.operations, p.markdown].join(' ')) })) };
  if (Object.isFrozen(procedures)) compiledProcedures.set(procedures, result);
  return result;
}
function compile(catalog: OfficialGuideCatalog) {
  const cached = Object.isFrozen(catalog) ? compiled.get(catalog) : undefined;
  if (cached) return cached;
  const result = { hash: createHash('sha256').update(JSON.stringify(catalog)).digest('hex'), entries: catalog.records.map((record) => ({ record, title: termsFor(record.title), body: termsFor([record.title, decodePath(record.url), record.summary ?? '', ...record.topics, ...(record.operations ?? []), ...(record.steps?.map((s) => s.text) ?? [])].join(' ')) })) };
  if (Object.isFrozen(catalog)) compiled.set(catalog, result);
  return result;
}
export function describeOfficialGuide(r: OfficialGuide) {
  if (unavailable(r)) throw new Error('La fuente fue retirada del catálogo activo por no estar disponible.');
  const ready = reviewed(r) && r.purpose === 'procedimiento' && !!r.steps?.length;
  return { ...r, revision: createHash('sha256').update(JSON.stringify(r)).digest('hex'), ready, needsSourceReview: !ready, needsLiveCheck: true, approvalPolicy: 'antes-de-accion-tributaria' };
}
const guideReviewSchema = z.object({
  id: z.string().regex(/^guia-[a-f0-9]{20}$/), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  reading: z.enum(['content-reviewed', 'transcript-reviewed', 'visual-reviewed']), summary: z.string().min(1).max(2000),
  steps: z.array(z.object({ text, at: z.string().regex(/^\d{1,3}:\d{2}(?::\d{2})?$/).optional() }).strict()),
  purpose: z.enum(['procedimiento', 'referencia', 'tecnico', 'normativa', 'formulario', 'informativo']),
  channels: z.array(z.enum(guideChannels)).min(1), operations: z.array(z.enum(guideOperations)), historical: z.boolean(),
  requirements: z.array(text), checks: z.array(text), gaps: z.array(text), limitations: z.array(text),
  entryPoints: z.array(z.enum(['declaraciones-pagos', 'tramites-consultas', 'renta-anual-personas', 'renta-anual-empresas'])),
  profiles: z.array(z.enum(['personas', 'empresas', 'aduanas'])), sourceSections: z.array(text).min(1),
  fingerprintBasis: z.enum(['archivo', 'texto', 'subtitulos', 'video']),
}).strict();
export function applyOfficialGuideReview(catalog: OfficialGuideCatalog, input: unknown, source: Uint8Array, date: string): OfficialGuideCatalog {
  const review = guideReviewSchema.parse(input);
  const original = catalog.records.find((r) => r.id === review.id);
  if (!original || unavailable(original)) throw new Error('La revisión debe corresponder a una fuente activa existente.');
  if (describeOfficialGuide(original).revision !== review.expectedRevision) throw new Error('La fuente cambió después de leerla; consulta su revisión actual antes de guardar.');
  if (!source.length) throw new Error('La revisión requiere el contenido público realmente consultado, no un archivo vacío.');
  const bytes = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  const prefix = bytes.subarray(0, 16384).toString('utf8');
  if (/Request Rejected|The requested URL was rejected|403 Forbidden|Access Denied/i.test(prefix)) throw new Error('El contenido es una página de rechazo, no una guía consultada.');
  if (review.fingerprintBasis === 'archivo' && original.kind === 'pdf' && !prefix.startsWith('%PDF-')) throw new Error('La huella binaria de un PDF requiere el archivo PDF original.');
  if (review.reading === 'transcript-reviewed' && (review.fingerprintBasis !== 'subtitulos' || review.steps.some((s) => s.at && !bytes.toString('utf8').includes(s.at)))) throw new Error('Las marcas de tiempo deben existir en los subtítulos realmente consultados.');
  const derived = [review.summary, ...review.steps.map((s) => s.text), ...review.requirements, ...review.checks, ...review.gaps, ...review.limitations, ...review.sourceSections].join(' ');
  if (/\b\d{8,13}\b|(?:S\/|\bUSD|\bPEN)\s*\d|\b(?:19|20)\d{2}[-/]\d{2}\b|(?:contrase[ñn]a|password|clave\s*(?:sol)?|token|api[_ -]?key)\s*[:=]\s*\S+/i.test(derived)) throw new Error('La revisión contiene posibles identidades, importes, periodos o credenciales; conserva únicamente orientación genérica.');
  if ([review.summary, ...review.steps.map((s) => s.text), ...review.limitations].join(' ').split(/\s+/).length > 200) throw new Error('Resume cada fuente en un máximo de 200 palabras; no copies el manual o guion completo.');
  if (review.purpose === 'procedimiento' && !review.steps.length) throw new Error('Un procedimiento preparado necesita pasos sustentados en la fuente.');
  const updated = { ...original, reading: review.reading, availability: 'retrieved' as const, summary: review.summary, steps: review.steps, purpose: review.purpose, channels: review.channels, channelBasis: 'texto-revisado' as const, operations: review.operations, historical: review.historical, limitations: review.limitations, sourceSections: review.sourceSections,
    reviewedAt: date, contentFingerprint: { sha256: createHash('sha256').update(source).digest('hex'), basis: review.fingerprintBasis },
    localProcedure: { requirements: review.requirements, checks: review.checks, gaps: review.gaps, entryPoints: review.entryPoints, profiles: review.profiles },
  };
  return parseOfficialGuides({ ...catalog, updatedAt: date, records: catalog.records.map((r) => r.id === updated.id ? updated : r) });
}
export function searchOfficialGuides(catalog: OfficialGuideCatalog, query = '', kind?: OfficialGuide['kind'] | 'procedimiento', topic?: string, cursor?: string, limit = 10, options: GuideSearchOptions = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Usa de 1 a 50 resultados por página; continúa con el cursor para consultar el resto.');
  const terms = termsFor(query); const library = compile(catalog); const scope = options.scope ?? 'operativo';
  const procedures = options.procedures ?? [];
  const prepared = compileProcedures(procedures);
  const intent = options.operation ?? guideOperations.find((op) => terms.includes(op));
  const signature = createHash('sha256').update(JSON.stringify([library.hash, prepared.hash, terms, kind, topic, scope, options.channel, intent, options.includeHistorical])).digest('hex').slice(0, 20);
  let after = 0;
  if (cursor) {
    try { const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); if (decoded.signature !== signature || !Number.isSafeInteger(decoded.after) || decoded.after < 0) throw new Error(); after = decoded.after; }
    catch { throw new Error('El cursor cambió o no corresponde a esta consulta. Inicia una página nueva.'); }
  }
  const matches = (body: string[]) => terms.every((term) => body.some((value) => value.startsWith(term)));
  const services = new Set(['nps', 'npd', 'sire', 'ruc', 'boleta', 'factura', 'honorarios', 'plame', 'drawback', 'detracciones', 'buzon', '621', '709', '710']);
  const serviceTerms = terms.filter((t) => services.has(t));
  const score = (title: string[], body: string[]) => terms.reduce((sum, t) => sum + (title.some((v) => v.startsWith(t)) ? 5 : body.some((v) => v.startsWith(t)) ? 1 : 0), 0);
  const sources = library.entries.filter(({ record: r, body }) => !unavailable(r) && (!kind || r.kind === kind) && (!topic || r.topics.some((v) => normalize(v) === normalize(topic))) && (!options.channel || r.channels?.includes(options.channel)) && (!intent || r.operations?.includes(intent)) && matches(body));
  const candidates: Array<{ id: string; priority: number; score: number; result: Record<string, unknown> }> = [];
  for (const { record: r, title, body } of sources) {
    const ready = reviewed(r) && r.purpose === 'procedimiento' && !!r.steps?.length;
    if (scope === 'operativo' && !ready || scope === 'referencias' && ready) continue;
    if (r.historical && !(options.includeHistorical ?? scope !== 'operativo')) continue;
    candidates.push({ id: r.id, priority: ready ? 1 : reviewed(r) ? 2 : 3, score: score(title, body), result: { id: r.id, title: r.title, kind: r.kind, topics: r.topics, reading: r.reading, availability: r.availability, url: r.url, channels: r.channels, channelBasis: r.channelBasis, operations: r.operations, historical: r.historical, ready, needsSourceReview: !ready, summary: r.summary, steps: r.steps, localProcedure: r.localProcedure, limitations: r.limitations } });
  }
  if (scope !== 'referencias' && (!kind || kind === 'procedimiento')) for (const { record: p, title, body } of prepared.entries) {
    if (!serviceTerms.every((t) => title.some((v) => v.startsWith(t)))) continue;
    if (!matches(body) || options.channel && !p.channels.includes(options.channel) || intent && !p.operations.includes(intent) || topic && !normalize(p.title + p.aliases.join(' ')).includes(normalize(topic))) continue;
    const { markdown, ...detail } = p;
    candidates.push({ id: p.id, priority: 0, score: score(title, body), result: { ...detail, ready: !!p.steps.length, needsSourceReview: !p.steps.length, needsLiveCheck: true, reading: 'ficha-local' } });
  }
  candidates.sort((a, b) => a.priority - b.priority || b.score - a.score || a.id.localeCompare(b.id));
  const results = candidates.slice(after, after + limit).map((r) => r.result);
  return { total: candidates.length, scope, referenceMatches: sources.filter(({ record: r }) => !(reviewed(r) && r.purpose === 'procedimiento' && r.steps?.length)).length, results, ...(after + results.length < candidates.length ? { nextCursor: Buffer.from(JSON.stringify({ signature, after: after + results.length })).toString('base64url') } : {}) };
}
