/** sunat_validar_comprobante: validity of an electronic payment document through the official API. */

import { type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { readSunatConfig, validateCpe } from '../sunat-api.js';

export function registerValidarComprobante(server: McpServer): void {
  server.registerTool(
    'sunat_validar_comprobante',
    {
      description: 'Consulta en el servicio oficial de SUNAT la validez de un comprobante de pago electrónico.',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: z.object({
        rucEmisor: z.string().regex(/^\d{11}$/).describe('RUC de 11 dígitos del emisor del comprobante.'),
        tipoComprobante: z.enum(['01', '03', '04', '07', '08', 'R1', 'R7']).describe('Código SUNAT: factura 01, boleta 03, liquidación de compra 04, nota de crédito 07, nota de débito 08, recibo por honorarios R1.'),
        serie: z.string().length(4).describe('Serie del comprobante, de 4 caracteres.'),
        numero: z.number().int().min(1).max(99_999_999).describe('Número correlativo del comprobante.'),
        fechaEmision: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).refine((value) => {
          const [day, month, year] = value.split('/').map(Number);
          const date = new Date(Date.UTC(year, month - 1, day));
          return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
        }, 'La fecha debe ser un día válido en formato DD/MM/AAAA.').describe('Fecha de emisión en formato DD/MM/AAAA.'),
        monto: z.number().nonnegative().optional().describe('Importe total, requerido para comprobantes electrónicos.'),
      }),
    },
    async ({ rucEmisor, tipoComprobante, serie, numero, fechaEmision, monto }) => {
      const config = readSunatConfig();
      if (!config) {
        return {
          content: [{ type: 'text', text: 'No se puede consultar: configura SUNAT_RUC, SUNAT_CLIENT_ID y SUNAT_CLIENT_SECRET.' }],
          isError: true,
        };
      }

      try {
        const result = await validateCpe(config, {
          issuerRuc: rucEmisor,
          documentType: tipoComprobante,
          series: serie.toUpperCase(),
          number: numero,
          issueDate: fechaEmision,
          amount: monto,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error inesperado al consultar SUNAT.';
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );
}
