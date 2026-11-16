/** sunat_brave_captura: visual capture of the current page, only when accessible text is not enough. */

import { type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { serializeBrowser } from '../browser-queue.js';
import { beginBrowserInteraction, captureBrowserScreenshot } from '../native-browser.js';
import { session, verifyBinding } from '../session-state.js';

export function registerCaptura(server: McpServer): void {
  server.registerTool(
    'sunat_brave_captura',
    {
      description: 'Captura visualmente la página actual solo cuando el texto accesible sea insuficiente o el usuario pida una imagen. No usar como verificación rutinaria entre pasos.',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: z.object({}),
    },
    async () => serializeBrowser(async () => {
      if (session.accountBinding) await verifyBinding();
      try {
        await beginBrowserInteraction();
        const image = await captureBrowserScreenshot();
        return { content: [{ type: 'image', data: image.toString('base64'), mimeType: 'image/png' }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo capturar la página.';
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    }),
  );
}
