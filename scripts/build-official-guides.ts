import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOfficialGuideReview, cleanOfficialGuides, describeOfficialGuide, readOfficialGuides } from '../src/official-guides.js';
import { readPreparedProcedures } from '../src/guide-procedures.js';

const args = process.argv.slice(2);
if (!args.length) throw new Error('Indica un JSON público o --revision REVISION.json --contenido CONTENIDO_PUBLICO.');
let catalog;
if (args[0] === '--revision') {
  if (args.length !== 4 || args[2] !== '--contenido') throw new Error('Usa --revision REVISION.json --contenido CONTENIDO_PUBLICO. La fuente ya debe existir en el catálogo.');
  const [current, revision, content] = await Promise.all([readOfficialGuides(), readFile(path.resolve(args[1]), 'utf8'), readFile(path.resolve(args[3]))]);
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  catalog = cleanOfficialGuides(applyOfficialGuideReview(current, JSON.parse(revision), content, date));
} else {
  if (args.length !== 1) throw new Error('Indica un único JSON de catálogo.');
  catalog = cleanOfficialGuides(JSON.parse(await readFile(path.resolve(args[0]), 'utf8')));
}
const procedures = (await readPreparedProcedures()).cards;
const root = fileURLToPath(new URL('../', import.meta.url));
const escape = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/[\[\]<>|]/g, '\\$&');
const link = (label: string, url: string) => `[${escape(label)}](${url.replaceAll('(', '%28').replaceAll(')', '%29')})`;
const lines = [
  '# Biblioteca de guías oficiales SUNAT', '',
  `Actualización: ${catalog.updatedAt}. ${catalog.records.length} fuentes únicas.`, '',
  catalog.coverage.scope, '',
  'El catálogo conserva enlaces y resúmenes, no copias de manuales completos. `index-only` significa enlace inventariado; `content-reviewed`, `transcript-reviewed` y `visual-reviewed` identifican lectura documental, subtítulos y revisión visual respectivamente. Ninguna de estas etiquetas certifica un trámite en una cuenta.', '',
  `Páginas extraídas en la investigación: ${catalog.coverage.pagesFetched}. Páginas pendientes del recorrido: ${catalog.coverage.pendingPages}. Fuentes fallidas retiradas: ${catalog.coverage.removed?.unavailable ?? 0}. Copias idénticas retiradas: ${catalog.coverage.removed?.duplicates ?? 0}.`, '',
  `Consulta normal: ${procedures.length} fichas locales estructuradas, seguidas de fuentes operativas revisadas. Los pasos se devuelven en la búsqueda. Los enlaces de referencia se consultan expresamente con alcance referencias o todo; no se abren automáticamente.`, '',
  'El canal y la operación son filtros documentales, no pruebas de acceso de una cuenta. Una clasificación basada en título se identifica como tal. La antigüedad por sí sola no convierte una fuente en obsoleta.', '',
  'Usa `sunat_guias` para buscar, leer una fuente y paginar todos los resultados sin cargar esta lista completa en el contexto.', '',
  '## Procedimientos preparados', '', ...procedures.map((p) => `- ${p.title} — ${p.id}; ${p.channels.join(', ')}; recurso ${p.resourceUri}.`), '',
  '## Índices de origen', '', ...catalog.coverage.roots.map((url) => `- ${link(new URL(url).hostname + new URL(url).pathname, url)}`), '',
  '## Estado de lectura', '', '| Estado | Fuentes |', '|---|---:|',
  ...['index-only', 'content-reviewed', 'transcript-reviewed', 'visual-reviewed', 'unavailable'].map((status) => `| ${status} | ${catalog.records.filter((r) => r.reading === status).length} |`), '',
];
for (const kind of ['pagina', 'pdf', 'documento', 'archivo', 'video']) {
  lines.push(`## ${kind}`, '');
  for (const record of catalog.records.filter((r) => r.kind === kind).sort((a, b) => a.title.localeCompare(b.title, 'es'))) {
    lines.push(`- ${link(record.title, record.url)} — ${record.id}; ${record.reading}; ${record.purpose}; ${record.channels?.join(', ')}${record.historical ? '; histórico' : ''}.`);
  }
  lines.push('');
}
lines.push('## Depuración', '', 'El catálogo activo no conserva registros ni listas de URL fallidas. Las cantidades retiradas se mantienen como información agregada. Un enlace inventariado sigue pendiente de revisión de contenido aunque su formato y dominio sean válidos.', '');
const videoLines = ['# Videos oficiales SUNAT: resúmenes', '', `Revisión: ${catalog.updatedAt}. Fuentes enlazadas desde los portales oficiales; los límites de lectura se indican en cada video.`, '', 'Estos resúmenes orientan el procedimiento; no verifican una cuenta ni autorizan presentaciones, pagos o emisiones. Las referencias a aprobación previa corresponden a las reglas de este MCP.', ''];
for (const video of catalog.records.filter((r) => r.kind === 'video').sort((a, b) => a.title.localeCompare(b.title, 'es'))) {
  videoLines.push(`## ${escape(video.title)}`, '', link('Video original', video.url), '', `ID: ${video.id}. Lectura: ${video.reading}. Disponibilidad: ${video.availability}.`, '');
  if (video.publishedAt) videoLines.push(`Publicación indicada por la fuente: ${escape(video.publishedAt)}.`, '');
  if (video.publisher) videoLines.push(`Canal: ${escape(video.publisher)}.`, '');
  if (video.summary) videoLines.push(video.summary, '');
  for (const step of video.steps ?? []) videoLines.push(`- ${step.at ? `[${step.at}] ` : ''}${step.text}`);
  if (video.steps?.length) videoLines.push('');
  for (const limitation of video.limitations ?? []) videoLines.push(`- Límite: ${limitation}`);
  videoLines.push('', 'Procedencia:', '', ...video.discoveredFrom.map((url) => `- ${link(new URL(url).hostname + new URL(url).pathname, url)}`), '');
}
for (const [relative, content] of [['data/official-guides.json', JSON.stringify(catalog, null, 2) + '\n'], ['docs/guias-oficiales.md', lines.join('\n').trimEnd() + '\n'], ['docs/videos-oficiales.md', videoLines.join('\n').trimEnd() + '\n']]) {
  const output = path.join(root, relative); await mkdir(path.dirname(output), { recursive: true });
  const temporary = output + '.' + process.pid + '.tmp'; await writeFile(temporary, content, 'utf8'); await rename(temporary, output);
}
process.stdout.write(JSON.stringify({ records: catalog.records.length, localProcedures: procedures.length, preparedSources: catalog.records.filter((r) => describeOfficialGuide(r).ready).length, videosReviewed: catalog.records.filter((r) => ['transcript-reviewed', 'visual-reviewed'].includes(r.reading)).length, removed: catalog.coverage.removed }) + '\n');
