/** sunat_guias: search and read the local official guides and prepared procedures. Never opens the browser. */

import { type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { browserError } from '../browser-results.js';
import { readPreparedProcedures } from '../guide-procedures.js';
import { describeOfficialGuide, guideChannels, guideOperations, readOfficialGuides, searchOfficialGuides } from '../official-guides.js';
import { renderProcedureLearning, renderProcedureLearningBatch } from '../procedure-learning.js';

export function registerGuias(server: McpServer): void {
  server.registerTool('sunat_guias', {
    description: 'Resuelve procedimientos SUNAT con contenido local, sin abrir Brave ni consultar URL. buscar prioriza las fichas preparadas y devuelve sus pasos, requisitos, comprobaciones y vacíos en la misma respuesta. Por defecto solo contenido operativo; alcance referencias o todo permite investigar fuentes aún sin pasos. Filtra canal y operación para distinguir SOL, móvil, escritorio, API y banco. Las fuentes históricas requieren incluirHistoricos en búsquedas operativas. leer acepta ID de ficha o guia-*; needsSourceReview indica contenido pendiente, needsLiveCheck exige comprobar la pantalla. cobertura informa fuentes activas y cantidades retiradas, sin conservar enlaces fallidos. Un ID documental nunca es routeId ni autorización tributaria.',
    inputSchema: z.object({
      accion: z.enum(['buscar', 'leer', 'cobertura']),
      consulta: z.string().max(1000).optional(),
      id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
      tipo: z.enum(['procedimiento', 'pagina', 'pdf', 'documento', 'archivo', 'video']).optional(),
      tema: z.string().min(1).max(100).optional(),
      cursor: z.string().max(2000).optional(),
      cantidad: z.number().int().min(1).max(50).optional().describe('Tamaño de página; continuar con nextCursor para todos los resultados.'),
      canal: z.enum(guideChannels).optional(),
      operacion: z.enum(guideOperations).optional(),
      alcance: z.enum(['operativo', 'referencias', 'todo']).optional().describe('Operativo devuelve contenido preparado. Referencias y todo permiten investigar fuentes adicionales.'),
      incluirHistoricos: z.boolean().optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args) => {
    try {
      const [catalog, procedures] = await Promise.all([readOfficialGuides(), readPreparedProcedures()]);
      let result: unknown;
      if (args.accion === 'buscar') {
        const page = searchOfficialGuides(catalog, args.consulta, args.tipo, args.tema, args.cursor, args.cantidad, { channel: args.canal, operation: args.operacion, scope: args.alcance, includeHistorical: args.incluirHistoricos, procedures: procedures.cards });
        const ids = page.results.filter((r) => r.kind === 'procedimiento').map((r) => String(r.id));
        const observations = ids.length ? await renderProcedureLearningBatch(ids) : {};
        result = { ...page, results: page.results.map((r) => r.kind === 'procedimiento' ? { ...r, localObservations: observations[String(r.id)] ?? '' } : r) };
      }
      else if (args.accion === 'leer') {
        const guide = catalog.records.find((item) => item.id === args.id);
        const card = procedures.cards.find((item) => item.id === args.id);
        if (!guide && !card) throw new Error('No existe esa fuente activa. Busca primero su ID en sunat_guias.');
        result = guide ? describeOfficialGuide(guide) : { ...card, ready: !!card?.steps.length, needsSourceReview: !card?.steps.length, needsLiveCheck: true, localObservations: await renderProcedureLearning(card!.id) };
      } else {
        const counts = (key: 'kind' | 'reading' | 'availability') => Object.fromEntries([...new Set(catalog.records.map((r) => r[key]))].sort().map((value) => [value, catalog.records.filter((r) => r[key] === value).length]));
        result = { updatedAt: catalog.updatedAt, total: catalog.records.length, localProcedures: procedures.cards.length, preparedSources: catalog.records.filter((r) => describeOfficialGuide(r).ready).length, types: counts('kind'), reading: counts('reading'), availability: counts('availability'), topics: [...new Set(catalog.records.flatMap((r) => r.topics))].sort(), channels: guideChannels, ...catalog.coverage };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: { result } };
    } catch (error) { return browserError(error instanceof Error ? error.message : 'No se pudo consultar el catálogo documental.'); }
  });
}
