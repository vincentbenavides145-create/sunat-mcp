/** sunat_brave_ejecutar_lote: routes, SOL entry points and manual batches, with the account, job and approval checks. */

import { type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { serializeBrowser } from '../browser-queue.js';
import { browserError } from '../browser-results.js';
import { executeBrowserSteps } from '../browser-steps.js';
import { beginBrowserInteraction, type BrowserStep, getLatestBrowserSnapshot, resetBrowserContext } from '../native-browser.js';
import { executeObservedRoute } from '../observed-route.js';
import { selectProcedureLearning } from '../procedure-learning.js';
import { acquireBrowserLease } from '../process-lease.js';
import { ensureAccount, jobs, pendingApprovals, pendingReconciliations, session } from '../session-state.js';
import { entryPoints, entryPointUrls } from '../sunat-navigation.js';

const sunatBrowserBatchStep = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), url: z.string().url() }),
  z.object({ action: z.literal('snapshot') }),
  z.object({ action: z.literal('click'), ref: z.string().regex(/^e\d+$/) }),
  z.object({ action: z.literal('scroll'), direction: z.enum(['up', 'down', 'left', 'right']).optional(), ref: z.string().regex(/^e\d+$/).optional() }).superRefine(({ direction, ref }, context) => {
    if (Boolean(direction) === Boolean(ref)) context.addIssue({ code: 'custom', message: 'scroll requiere exactamente ref para revelar un control o direction para mover el panel.' });
  }),
  z.object({ action: z.literal('fill'), ref: z.string().regex(/^e\d+$/), text: z.string().max(2000) }),
]);

export function registerEjecutarLote(server: McpServer): void {
  server.registerTool(
    'sunat_brave_ejecutar_lote',
    {
      description: 'Opera en el Brave existente: en modo híbrido usa CDP local sobre una pestaña SUNAT vinculada sin activarla; UI Automation queda para login y controles nativos, o el modo uia explícito. Un fallo CDP no fuerza foco ni reintenta acciones con UIA. Reutiliza routeId de sunat://operaciones o sunat://perfil. Usa entryPoint para abrir declaraciones-pagos, tramites-consultas, renta-anual-personas o renta-anual-empresas en la misma pestaña, evitando ventanas del portal. Un popup excepcional se sigue solo si pertenece al clic y al contexto actual y termina en HTTPS SUNAT; invalida referencias y aprobaciones y revalida la cuenta. Para explorar agrupa hasta ocho acciones navigate, snapshot, click, fill o scroll; scroll acepta ref para revelar un control o direction para mover el panel. Con CDP, fill en un select HTML elige por etiqueta. Devuelve transport y diagnóstico; detiene el lote al primer fallo sin repetir clics. Para procedimientos, indica procedureId y procedureOperation; continúa aprendizaje local entre lotes sin guardar datos de cuenta. Solo HTTPS SUNAT; no permite JavaScript ni campos de credenciales con datos del modelo. Indica trabajoId de sunat_trabajos para vincular cuenta, finalidad y progreso; es obligatorio para enviar. Indica cuenta para cambiar de cliente importado mediante login nativo. Verifica el RUC autenticado antes de operar y de enviar. Solicita aprobación explícita antes de un envío tributario y la invalida si cambia el formulario.',
      // Mixed tool: safe navigation and guarded tax commits. Advertise the maximum
      // capability; one-use server approval still applies only to actual tax commits.
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      inputSchema: z.object({
        cuenta: z.string().min(1).max(160).optional().describe('Nombre exacto de la cuenta local con la que quieres iniciar sesión en este navegador.'),
        trabajoId: z.string().uuid().optional().describe('Trabajo persistente de sunat_trabajos. Obligatorio para un envío tributario; vincula cuenta, finalidad, progreso y protección contra duplicados.'),
        routeId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional().describe('ID de una ruta de sunat://operaciones o sunat://perfil. El MCP sigue todos sus pasos con referencias recién obtenidas y sin capturas.'),
        entryPoint: z.enum(entryPoints).optional().describe('Abre uno de los cuatro accesos oficiales en la pestaña SUNAT vinculada, conservando la conexión y evitando las ventanas del portal. Renta Empresas conserva su página oficial de entrada; no selecciona campaña ni presenta declaraciones.'),
        procedureId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional().describe('ID de la ficha o de una ruta confirmada del catálogo/perfil. Activa automáticamente observación local de pasos genéricos, sin guardar valores ni datos de cuenta. Continúa entre lotes.'),
        procedureOperation: z.enum(['consulta', 'preparacion', 'modificacion', 'presentacion', 'pago', 'emision', 'anulacion']).optional().describe('Finalidad del procedimiento; distingue consultar de presentar, emitir, modificar o pagar. Indicar junto a procedureId al cambiar de finalidad.'),
        steps: z.array(sunatBrowserBatchStep).min(1).max(8).optional().superRefine((steps, context) => {
          if (!steps) return;
          if (steps.filter((step) => step.action === 'snapshot').length > 2) {
            context.addIssue({ code: 'custom', message: 'Un lote puede incluir como máximo 2 snapshots.' });
          }
        }),
      }).superRefine(({ routeId, steps, entryPoint }, context) => {
        if ([routeId, steps, entryPoint].filter(Boolean).length !== 1) {
          context.addIssue({ code: 'custom', message: 'Indica exactamente una modalidad: entryPoint para un acceso SOL, routeId para una ruta conocida o steps para un lote manual.' });
        }
      }),
    },
    async ({ cuenta, trabajoId, routeId, steps, entryPoint, procedureId, procedureOperation }, context) => serializeBrowser(async () => {
      try {
        acquireBrowserLease();
        const store = trabajoId ? await jobs() : undefined;
        store?.recover();
        const job = trabajoId ? store!.get(trabajoId) : undefined;
        if (job && ['submitting', 'uncertain', 'completed', 'cancelled'].includes(job.status)) throw new Error('Este trabajo ya terminó o requiere conciliación. No se repetirá su envío.');
        if (job && (procedureId && procedureId !== job.procedureId || procedureOperation && procedureOperation !== job.operation)) throw new Error('El procedimiento o finalidad no coincide con el trabajo.');
        if (session.activeJobId && session.activeJobId !== trabajoId && session.workStore && ['preparing', 'awaiting_approval', 'submitting'].includes(session.workStore.get(session.activeJobId).status)) {
          if (!trabajoId && steps?.every((step) => step.action === 'snapshot')) { /* inspection only */ }
          else throw new Error('Pausa el trabajo activo antes de ejecutar otra cuenta o flujo.');
        }
        await ensureAccount(cuenta, job);
        if (job) {
          if (!(job.status === 'awaiting_approval' && (context.mcpReq.requestState() || steps?.every((step) => step.action === 'snapshot')))) {
            for (const [id, approval] of pendingApprovals) if (approval.jobId === job.id) pendingApprovals.delete(id);
            for (const [id, approval] of pendingReconciliations) if (approval.jobId === job.id) pendingReconciliations.delete(id);
            store!.activate(job.id);
          }
          session.activeJobId = job.id;
        }
        await selectProcedureLearning(job?.procedureId ?? procedureId ?? routeId, job?.operation ?? procedureOperation, getLatestBrowserSnapshot());
        if (entryPoint) {
          pendingApprovals.clear(); pendingReconciliations.clear();
          session.navigationLearningTrail = [];
          resetBrowserContext();
          steps = [{ action: 'navigate', url: entryPointUrls[entryPoint] }, { action: 'snapshot' }];
        }
        await beginBrowserInteraction(steps?.[0]?.action === 'navigate' || Boolean(cuenta));
        if (routeId) {
          const result = await executeObservedRoute(routeId, job ? (count) => { if (count) store!.checkpoint(job.id, count); } : undefined);
          if (job && store!.get(job.id).status === 'preparing') {
            if ('isError' in result && result.isError) store!.pause(job.id);
          }
          return job ? { ...result, structuredContent: { ...('structuredContent' in result ? result.structuredContent : {}), job: store!.get(job.id) } } : result;
        }
      if (steps) {
        const typedSteps: BrowserStep[] = steps.map((step) => step.action === 'scroll'
          ? step.ref ? { action: 'scroll', ref: step.ref } : { action: 'scroll', direction: step.direction! }
          : step);
        const result = await executeBrowserSteps(typedSteps, context, trabajoId, job ? (count) => { if (count) store!.checkpoint(job.id, count); } : undefined);
        if (job && store!.get(job.id).status === 'preparing') {
          if ('isError' in result && result.isError) store!.pause(job.id);
        }
        return result;
      }
        return browserError('Indica routeId o steps.');
      } catch (error) {
        if (trabajoId && session.workStore) {
          try {
            const status = session.workStore.get(trabajoId).status;
            if (status === 'submitting') session.workStore.finishSubmission(trabajoId, '', undefined);
            else if (['preparing', 'awaiting_approval'].includes(status)) session.workStore.pause(trabajoId);
          } catch { /* Preserve the original failure, including an unknown job ID. */ }
        }
        const message = error instanceof Error ? error.message : 'No se pudo ejecutar la ruta en SUNAT.';
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    }),
  );
}
