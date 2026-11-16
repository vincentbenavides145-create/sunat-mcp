/** MCP resources: workflow contracts, public procedure cards, operation index and the local learned profile. */

import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { readFile } from 'node:fs/promises';
import { readPreparedProcedures } from '../guide-procedures.js';
import { renderPersonalProfile } from '../learning.js';
import { renderProcedureLearning } from '../procedure-learning.js';
import { workflowCatalog } from '../workflows.js';

async function readPublicProcedureGuide(id?: string): Promise<string> {
  const library = await readPreparedProcedures();
  if (id === undefined) return library.introduction + await renderProcedureLearning();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Identificador de procedimiento no válido.');
  const section = library.cards.find((item) => item.id === id)?.markdown;
  if (!section) {
    const learned = await renderProcedureLearning(id);
    if (learned) return '# Procedimiento observado localmente\n\nNo hay una ficha oficial empaquetada para esta ruta. Estas observaciones locales no son un manual oficial ni una autorización de operaciones.' + learned;
    throw new Error('No existe una ficha con ese identificador. Consulta sunat://procedimientos o sunat://perfil.');
  }
  // The last card is followed by maintenance notes, which are not part of its procedure.
  return section.split(/^## Mantenimiento y procedencia/m)[0].trim() + await renderProcedureLearning(id);
}

export function registerResources(server: McpServer): void {
  server.registerResource('sunat-flujos', 'sunat://flujos', {
    title: 'Contratos de trabajo por procedimiento SUNAT', mimeType: 'application/json',
    description: 'Finalidades admitidas y verificación de cada ficha; ejecución asistida, sin atribuir certificación a guías o rutas. Los trabajos inciertos requieren conciliación humana.',
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await workflowCatalog()) }] }));

  server.registerResource(
    'sunat-procedimientos',
    'sunat://procedimientos',
    {
      title: 'Índice de procedimientos públicos SUNAT',
      description: 'Índice y reglas de uso de las fichas oficiales. Lee solo sunat://procedimientos/{id} para la operación necesaria; una guía publicada no prueba permisos ni un trámite completado.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await readPublicProcedureGuide() }],
    }),
  );

  server.registerResource(
    'sunat-procedimiento',
    new ResourceTemplate('sunat://procedimientos/{id}', { list: undefined }),
    {
      title: 'Ficha de procedimiento SUNAT',
      description: 'Una ficha oficial o local con el complemento de pasos canónicos observados en esta instalación, señales genéricas de finalización y vacíos. Leerla no ejecuta operaciones ni autoriza envíos.',
      mimeType: 'text/markdown',
    },
    async (uri, { id }) => {
      if (typeof id !== 'string') throw new Error('Se requiere un identificador de procedimiento.');
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await readPublicProcedureGuide(id) }] };
    },
  );

  server.registerResource(
    'sunat-operaciones',
    'sunat://operaciones',
    {
      title: 'Índice de operaciones SUNAT',
      description: 'Índice para clasificar solicitudes por acceso SOL y perfil. Incluye rutas observadas que pueden ejecutarse automáticamente con routeId; no equivale a una guía de operación completada.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const catalog = JSON.parse(await readFile(new URL('../../data/operation-index.json', import.meta.url), 'utf8')) as unknown;
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(catalog, null, 2) }] };
    },
  );

  server.registerResource(
    'sunat-perfil-local',
    'sunat://perfil',
    {
      title: 'Perfil local de navegación SUNAT',
      description: 'Guía local con rutas confirmadas, frecuencias e índice de procedimientos observados. Sin límites de cantidad/profundidad; no guarda cuentas, formularios ni resultados fiscales concretos.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await renderPersonalProfile() }],
    }),
  );
}
