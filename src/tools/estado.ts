/** sunat_estado: local status, SIRE API access check and optional Brave/CDP status. */

import { type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { serializeBrowser } from '../browser-queue.js';
import { findSunatAccountCredential, getSunatCredentialVaultStatus } from '../credentials.js';
import { getNativeBrowserStatus } from '../native-browser.js';
import { checkSireApiAccess } from '../sire-api.js';
import { readSunatConfig } from '../sunat-api.js';

export function registerEstado(server: McpServer): void {
  server.registerTool(
    'sunat_estado',
    {
      description: 'Sin cuenta, consulta localmente la configuración API CPE y cuántas credenciales hay. Solo con comprobarNavegador comprueba la ventana Brave e informa el estado local CDP sin abrir conexiones ni solicitar depuración, y devuelve contadores/tiempos en memoria, sin leer la página ni incluir URL o identidades. Con cuenta, valida el acceso API SIRE mediante OAuth a SUNAT, sin descargar ni cambiar registros. Nunca muestra credenciales, tokens ni cookies.',
      inputSchema: z.object({
        cuenta: z.string().min(1).max(160).optional().describe('Nombre exacto de cuenta local a revisar. Si se indica, valida el token API SIRE de esa cuenta; no hace preflight del navegador.'),
        comprobarNavegador: z.boolean().optional().describe('Solo si se solicita revisar el Brave existente y su conexión CDP local, sin leer la página ni cambiar el foco.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ cuenta, comprobarNavegador }) => {
      if (cuenta) {
        try {
          const account = await findSunatAccountCredential(cuenta);
          const sireApi = await checkSireApiAccess(account);
          const output = {
            sireApi,
            browserChecked: false,
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'No se pudo revisar la cuenta seleccionada.';
          return { content: [{ type: 'text', text: message }], isError: true };
        }
      }

      try {
        const [vault, apiConfigured] = await Promise.all([
          getSunatCredentialVaultStatus(),
          Promise.resolve(readSunatConfig() !== null),
        ]);
        const output: Record<string, unknown> = { ...vault, apiConfigured, browserChecked: false };
        if (comprobarNavegador) {
          const browser = await serializeBrowser(() => getNativeBrowserStatus());
          output.browserChecked = true;
          output.braveConnected = browser.connected;
          output.browser = browser;
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo revisar el estado local.';
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );
}
