import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { procedureOperations } from './workflows.js';
import { freezeGuideData, type GuideChannel } from './official-guides.js';

export interface PreparedProcedure {
  id: string;
  title: string;
  kind: 'procedimiento';
  procedureId: string;
  resourceUri: string;
  channels: GuideChannel[];
  operations: string[];
  entryPoints: string[];
  profiles: string[];
  aliases: string[];
  requirements: string[];
  steps: Array<{ text: string; section?: string }>;
  checks: string[];
  gaps: string[];
  sources: Array<{ title: string; url: string }>;
  sourceRevision: string;
  reviewedAt: string;
  evidence: string;
  approvalPolicy: 'antes-de-accion-tributaria';
  routes: Array<{ routeId: string; entryPoint?: string; profile?: string; destination?: string; evidence: string; observedAt?: string }>;
  markdown: string;
}

const clean = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*|`/g, '').trim();
function labelled(markdown: string, pattern: RegExp): string[] {
  return [...markdown.matchAll(/\*\*([^*]+?):\*\*\s*([\s\S]*?)(?=\*\*[^*]+?:\*\*|\n\n|$)/g)]
    .filter((m) => pattern.test(m[1])).map((m) => clean(m[2])).filter(Boolean);
}
export function prepareProcedureCards(markdown: string, records: Array<{ id: string; title: string; entryPoint?: string; entryPoints?: string[]; profiles: string[]; aliases?: string[]; evidence: string }>, routes: Array<{ id: string; procedureId?: string; entryPoint?: string; profile?: string; destination?: string; evidence: string; observedAt?: string }> = []): PreparedProcedure[] {
  markdown = markdown.replace(/\r\n/g, '\n');
  const sections = markdown.split(/(?=^## [a-z0-9-]+ — )/m);
  return freezeGuideData(records.map((record) => {
    const section = sections.find((s) => s.startsWith(`## ${record.id} — `))?.split(/^## Mantenimiento y procedencia/m)[0].trim();
    if (!section) throw new Error(`Falta la ficha documental ${record.id}.`);
    const numbered = [...section.matchAll(/^\d+\.\s+([^\n]+(?:\n[ \t]+[^\n]+)*)/gm)].map((m) => ({ text: clean(m[1]) }));
    const steps: PreparedProcedure['steps'] = numbered.length ? numbered : [...section.matchAll(/\*\*([^*]*(?:Ruta|ruta|Boleta|Factura)[^*]*):\*\*\s*([^\n]+)/g)].map((m) => ({ section: clean(m[1]), text: clean(m[2]) }));
    if (!steps.length) {
      const prose = section.split('\n\n').find((p) => /^El flujo publicado /u.test(p));
      if (prose) steps.push({ text: clean(prose) });
    }
    if (!steps.length) for (const m of section.matchAll(/\*\*(Canal [AB][^*]*):\*\*\s*([^\n]+)/g)) steps.push({ section: clean(m[1]), text: clean(m[2]) });
    const requirements = labelled(section, /^(?:Acceso|Canal|Requisitos|Datos)$/i);
    const eligibility = section.split('\n').filter((s) => /^La fuente exige /u.test(s)).map(clean);
    const gaps = labelled(section, /Pendiente|L[ií]mite|Frontera|Ejecuci[oó]n|Factura|Variante/i);
    if (!steps.length) gaps.push('La ficha no contiene una secuencia desglosada; revisar su orientación antes de navegar.');
    const channels: GuideChannel[] = record.id === 'sire-desktop' ? ['escritorio'] : record.id === 'sire-api-acceso' ? ['api'] : record.id === 'nps-pago' ? ['banco'] : record.id === 'exporta-facil' ? ['web-sunat', 'presencial'] : record.id === 'drawback-consulta' ? ['web-sunat'] : ['sol-web'];
    const sources = [...section.matchAll(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g)].map((m) => ({ title: m[1], url: m[2] }));
    const mutations = procedureOperations(record.id).filter((op) => op !== 'consulta' && op !== 'preparacion');
    const operations: string[] = record.id === 'nps-generacion' ? ['preparacion', 'generacion'] : record.id === 'nps-pago' ? ['pago'] : mutations.length ? ['preparacion', ...mutations] : ['consulta', 'preparacion'];
    if (['sire-rvie-rce-sol', 't-registro'].includes(record.id)) operations.push('consulta');
    if (record.id === 'sire-rvie-rce-sol' || record.id === 'sire-desktop') operations.push('generacion');
    const date = /revisi[oó]n\s+(\d{2})\/(\d{2})\/(\d{4})/i.exec(section) ?? /Revisi[oó]n documental general:\*\*\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(markdown);
    return {
      id: record.id, title: section.split('\n')[0].replace(/^## [^ ]+ — /, ''), kind: 'procedimiento', procedureId: record.id,
      resourceUri: `sunat://procedimientos/${record.id}`, channels, operations, entryPoints: record.entryPoints ?? (record.entryPoint ? [record.entryPoint] : []),
      profiles: record.profiles, aliases: record.aliases ?? [], requirements: [...requirements, ...eligibility], steps,
      checks: [...labelled(section, /Resultado|Comprobaci[oó]n|Punto decisivo/i), ...steps.filter((s) => /comprobar|verificar|revisar|constancia/i.test(s.text)).map((s) => s.text)],
      gaps, sources, sourceRevision: createHash('sha256').update(section).digest('hex'), reviewedAt: date ? `${date[3]}-${date[2]}-${date[1]}` : 'sin-fecha', evidence: record.evidence,
      approvalPolicy: 'antes-de-accion-tributaria', markdown: section,
      routes: routes.filter((r) => r.procedureId === record.id && ['ruta_observada', 'recorrido_verificado'].includes(r.evidence)).map((r) => ({ routeId: r.id, entryPoint: r.entryPoint, profile: r.profile, destination: r.destination, evidence: r.evidence, observedAt: r.observedAt })),
    };
  }));
}

export function createProcedureReader(read: (file: 'guide' | 'index') => Promise<string>) {
  let cached: { hash: string; cards: PreparedProcedure[]; introduction: string } | undefined;
  return async () => {
    try {
      const [guide, index] = await Promise.all([read('guide'), read('index')]);
      const hash = createHash('sha256').update(guide).update(index).digest('hex');
      if (cached?.hash === hash) return cached;
      const parsed = JSON.parse(index);
      const cards = prepareProcedureCards(guide, parsed.publicProcedureGuide.records, parsed.observedRoutes ?? []);
      cached = { hash, cards, introduction: guide.split(/(?=^## [a-z0-9-]+ — )/m)[0].trim() };
      return cached;
    } catch { cached = undefined; throw new Error('No se pudo validar la biblioteca de procedimientos locales. No se reutilizó una ficha anterior.'); }
  };
}
export const readPreparedProcedures = createProcedureReader((file) => readFile(new URL(file === 'guide' ? '../docs/procedimientos-publicos.md' : '../data/operation-index.json', import.meta.url), 'utf8'));
