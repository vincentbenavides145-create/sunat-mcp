/** sunat_trabajos: local per-account jobs, duplicate protection and human reconciliation of uncertain submissions. */

import { acceptedContent, inputRequired, type McpServer } from '@modelcontextprotocol/server';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { bindAccount } from '../account-session.js';
import { serializeBrowser } from '../browser-queue.js';
import { browserError } from '../browser-results.js';
import { getOperationalVault, normalizeAccountKey } from '../credentials.js';
import { getLatestBrowserSnapshot } from '../native-browser.js';
import { acquireBrowserLease } from '../process-lease.js';
import { approvalSchema, clearAccountContext, ensureAccount, expireApprovals, type PendingApprovalState, pendingReconciliations, requestStateCodec, session, verifyBinding } from '../session-state.js';
import { WorkStore } from '../work-store.js';
import { operations, workflowCatalog } from '../workflows.js';

export function registerTrabajos(server: McpServer): void {
  server.registerTool(
    'sunat_trabajos',
    {
      description: 'Gestiona trabajos locales por cuenta y procedimiento: crear uno o un lote con claveOperacion estable, listar con paginación, consultar progreso, pausar, cancelar, cerrar consultas y conciliar envíos inciertos. Solo guarda IDs opacos, estados y HMACs; sin credenciales, identidades ni datos fiscales. La ejecución usa sunat_brave_ejecutar_lote con trabajoId. Un envío iniciado nunca se reintenta automáticamente. Conciliar requiere cuenta verificada, página actual y aprobación humana de un uso. No equivale a una API nativa ni certifica trámites no probados.',
      inputSchema: z.object({
        accion: z.enum(['crear', 'crear_lote', 'listar', 'consultar', 'pausar', 'cancelar', 'finalizar_consulta', 'conciliar']),
        cuenta: z.string().min(1).max(160).optional(),
        procedureId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
        operation: z.enum(operations).optional(),
        claveOperacion: z.string().min(1).max(2000).optional().describe('Identificador estable del trabajo por trámite/periodo/documento. Reutilízalo al repetir una petición. Nunca incluir Clave SOL ni contraseñas; solo se persiste su HMAC.'),
        solicitudes: z.array(z.object({ cuenta: z.string().min(1).max(160), procedureId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), operation: z.enum(operations), claveOperacion: z.string().min(1).max(2000) })).min(1).optional(),
        trabajoId: z.string().uuid().optional(),
        despuesDe: z.string().uuid().optional(),
        cantidad: z.number().int().positive().safe().optional(),
        resultado: z.enum(['realizada', 'no_realizada']).optional().describe('Solo para conciliar un envío incierto, siempre con confirmación humana. No marca un trabajo completado por una decisión del modelo.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args, context) => serializeBrowser(async () => {
      try {
        expireApprovals();
        const vault = await getOperationalVault();
        const store = session.workStore ??= new WorkStore(vault.key);
        store.assertKey(vault.key);
        const response = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: { result: value } });
        if (args.accion === 'crear' || args.accion === 'crear_lote') {
          const entries = args.accion === 'crear_lote' ? args.solicitudes : args.cuenta && args.procedureId && args.operation && args.claveOperacion ? [{ cuenta: args.cuenta, procedureId: args.procedureId, operation: args.operation, claveOperacion: args.claveOperacion }] : undefined;
          if (!entries?.length) throw new Error('Indica cuenta, procedureId, operation y claveOperacion; para un lote indica solicitudes.');
          const resolved = entries.map((entry) => {
            const account = vault.accounts.find((item) => normalizeAccountKey(item.accountKey) === normalizeAccountKey(entry.cuenta));
            if (!account) throw new Error('Una cuenta del lote no existe en la bóveda de este operador.');
            return { entry, binding: bindAccount(account), taxpayerId: account.taxpayerId! };
          });
          const catalog = await workflowCatalog();
          for (const { entry } of resolved) if (!catalog.find((flow) => flow.id === entry.procedureId)?.operations.includes(entry.operation)) throw new Error('Un procedimiento o finalidad del lote no está admitido. Consulta sunat://flujos.');
          const results = await store.createMany(resolved.map(({ entry, binding, taxpayerId }) => ({ accountId: binding.id, procedureId: entry.procedureId, operation: entry.operation, idempotencyKey: entry.claveOperacion, taxpayerId })));
          return response({ jobs: results });
        }
        if (args.accion === 'listar') {
          let accountId: string | undefined;
          if (args.cuenta) {
            const account = vault.accounts.find((item) => normalizeAccountKey(item.accountKey) === normalizeAccountKey(args.cuenta!));
            if (!account) throw new Error('No existe esa cuenta en la bóveda de este operador.');
            accountId = account.id;
          }
          return response(store.list(args.despuesDe, args.cantidad, accountId));
        }
        if (!args.trabajoId) throw new Error('Indica trabajoId.');
        const job = store.get(args.trabajoId);
        if (args.accion === 'consultar') return response({ job, events: store.events(job.id) });
        acquireBrowserLease(); store.recover();
        if (args.accion === 'pausar' || args.accion === 'cancelar') {
          const updated = args.accion === 'pausar' ? store.pause(job.id) : store.cancel(job.id);
          if (session.activeJobId === job.id) clearAccountContext();
          return response({ job: updated, requiresFreshSnapshot: true });
        }
        if (session.activeJobId && session.activeJobId !== job.id && ['preparing', 'awaiting_approval', 'submitting'].includes(store.get(session.activeJobId).status)) throw new Error('Pausa el trabajo activo antes de cambiar de trabajo.');
        await ensureAccount(args.cuenta, job);
        if (args.accion === 'finalizar_consulta') {
          const updated = store.closeConsultation(job.id);
          if (session.activeJobId === job.id) clearAccountContext();
          return response({ job: updated });
        }
        if (args.accion === 'conciliar') {
          if (!args.resultado || !['uncertain', 'submitting'].includes(store.get(job.id).status)) throw new Error('Indica el resultado de la conciliación para un envío incierto.');
          const state = context.mcpReq.requestState<PendingApprovalState>();
          const inputHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
          await verifyBinding();
          const snapshot = getLatestBrowserSnapshot();
          if (!snapshot) throw new Error('No se pudo leer la página para conciliar.');
          if (state) {
            if (state.kind !== 'reconciliation') throw new Error('Esta confirmación no corresponde a conciliación.');
            const pending = pendingReconciliations.get(state.pendingId); pendingReconciliations.delete(state.pendingId);
            if (!pending || pending.jobId !== job.id || pending.accountId !== session.accountBinding?.id || pending.inputHash !== inputHash || pending.expiresAt < Date.now() || pending.pageHash !== snapshot.approvalFingerprint) throw new Error('La conciliación cambió o expiró. Revisa de nuevo la página de SUNAT.');
            if (acceptedContent(context.mcpReq.inputResponses, 'work-reconciliation', approvalSchema)?.approve !== true) return response({ job: store.get(job.id), reconciled: false });
            const updated = store.reconcile(job.id, args.resultado === 'realizada' ? 'completed' : 'not_performed');
            if (session.activeJobId === job.id) clearAccountContext();
            return response({ job: updated });
          }
          const pendingId = randomUUID();
          pendingReconciliations.set(pendingId, { jobId: job.id, accountId: session.accountBinding!.id, inputHash, pageHash: snapshot.approvalFingerprint!, expiresAt: Date.now() + 600_000 });
          return inputRequired({ requestState: await requestStateCodec.mint({ pendingId, kind: 'reconciliation' }, context), inputRequests: {
            'work-reconciliation': inputRequired.elicit({ requestedSchema: approvalSchema, message: `Conciliación del trabajo ${job.id}, ficha ${job.procedureId}, cuenta ${session.accountBinding!.key}, RUC verificado ${session.accountBinding!.ruc}.\nConfirma en SUNAT si la operación de este trabajo ya se realizó. Decisión solicitada: ${args.resultado === 'realizada' ? 'registrar el trabajo como realizado; no volver a enviarlo' : 'confirmar que NO se realizó y permitir volver a prepararlo, con una nueva aprobación antes de enviarlo'}.\nPágina actual:\n${snapshot.text}\n¿Apruebas esta decisión?` }),
          } });
        }
        throw new Error('Acción de trabajo no admitida.');
      } catch (error) { return browserError(error instanceof Error ? error.message : 'No se pudo gestionar el trabajo local.'); }
    }),
  );
}
