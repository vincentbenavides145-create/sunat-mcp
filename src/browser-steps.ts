/** Executes manual browser batches, including the one-use approval fence that guards every tax commit. */

import { acceptedContent, inputRequired, type ServerContext } from '@modelcontextprotocol/server';
import { createHash, randomUUID } from 'node:crypto';
import { browserBatchResponse, browserError, hasBrowserActionError } from './browser-results.js';
import { isLearnableMenuControl, rememberDiscoveredNavigation } from './learning.js';
import { type BrowserStep, describeSnapshotReference, executeBrowserBatch, getCurrentFormValues, getLatestBrowserSnapshot, isAuthenticatedSunatPage, isSensitiveInput, isTaxCommitControl, sanitizePageUrlForMcp } from './native-browser.js';
import { normalizeMenuLabel } from './observed-route.js';
import { getProcedureLearningFlowId, observeProcedureSnapshot, observeProcedureStep, resetProcedureLearning } from './procedure-learning.js';
import { hasSunatNavigationGate } from './route-navigation.js';
import { approvalSchema, checkChangedBrowserContext, expireApprovals, jobs, pendingApprovals, type PendingApprovalState, requestStateCodec, session, verifyBinding } from './session-state.js';
import { evidenceContent, renderedEvidence } from './workflows.js';

function fingerprint(steps: BrowserStep[]): string {
  return createHash('sha256').update(JSON.stringify(steps)).digest('hex');
}

export async function executeBrowserSteps(steps: BrowserStep[], context: ServerContext, jobId?: string, checkpoint?: (count: number) => void) {
  const state = context.mcpReq.requestState<PendingApprovalState>();
  if (state) {
    if (state.kind === 'reconciliation') return browserError('Esta confirmación corresponde a conciliación, no a un envío tributario.');
    const pending = pendingApprovals.get(state.pendingId);
    pendingApprovals.delete(state.pendingId);
    if (!pending || pending.expiresAt < Date.now()) {
      if (jobId && session.workStore?.get(jobId).status === 'awaiting_approval') session.workStore.pause(jobId);
      return browserError('La aprobación expiró o el MCP se reinició. Revisa el estado actual de SUNAT y prepara la acción de nuevo.');
    }
    if (pending.jobId !== jobId || pending.accountId !== session.accountBinding?.id) return browserError('La confirmación pertenece a otro trabajo o cuenta. No se ejecutó el envío.');
    if (fingerprint(steps) !== pending.inputHash) {
      (await jobs()).pause(pending.jobId);
      return browserError('Los pasos cambiaron desde que se pidió aprobación. No se ejecutó el envío; revisa el formulario y prepara una nueva confirmación.');
    }
    const confirmation = acceptedContent(context.mcpReq.inputResponses, 'tax-approval', approvalSchema);
    if (confirmation?.approve !== true) {
      (await jobs()).pause(pending.jobId);
      return browserError('Acción cancelada. No se ejecutó el clic tributario.');
    }

    await verifyBinding();

    const freshResult = await executeBrowserBatch([{ action: 'snapshot' }]);
    const fresh = getLatestBrowserSnapshot();
    const reference = fresh ? describeSnapshotReference(fresh.text, pending.click.ref) : undefined;
    const snapshotHash = fresh?.approvalFingerprint ?? fresh?.fingerprint ?? '';
    if (!fresh || fresh.url !== pending.expectedUrl || snapshotHash !== pending.expectedApprovalHash || reference?.label !== pending.expectedLabel || !isTaxCommitControl(reference)) {
      (await jobs()).pause(pending.jobId);
      return browserError('La página o el botón cambió después de la aprobación. No se ejecutó la acción; toma un snapshot y revisa el formulario.');
    }
    if (pending.learningFlowId !== getProcedureLearningFlowId()) resetProcedureLearning();
    const store = await jobs();
    // Durable fence BEFORE sending input. Even a process crash here cannot cause a blind retry.
    const operation = store.get(pending.jobId).operation;
    const { clicked, trailing } = await store.submit(pending.jobId, store.digest(evidenceContent(fresh, operation)), async () => {
      const clicked = await executeBrowserBatch([pending.click]);
      await checkChangedBrowserContext(clicked);
      if (!hasBrowserActionError(clicked)) observeProcedureStep('click', pending.expectedLabel);
      const trailing = !hasBrowserActionError(clicked) ? await executeBrowserBatch([{ action: 'snapshot' }]) : [];
      const after = getLatestBrowserSnapshot();
      return { value: { clicked, trailing }, signature: after ? store.digest(evidenceContent(after, operation)) : '', evidence: after && !hasBrowserActionError(clicked) && !hasBrowserActionError(trailing) ? renderedEvidence(after, operation) : undefined };
    });
    const result = [
      ...(Array.isArray(freshResult) ? freshResult : [freshResult]),
      ...(Array.isArray(clicked) ? clicked : [clicked]),
      ...(Array.isArray(trailing) ? trailing : [trailing]),
    ];
    if (!hasBrowserActionError(result)) await observeProcedureSnapshot(getLatestBrowserSnapshot());
    return browserBatchResponse(result);
  }

  const outputs: unknown[] = [];
  const labelsDiscoveredThisCall: string[] = [];
  expireApprovals();
  let index = 0;
  while (index < steps.length) {
    const step = steps[index];
    if (step.action === 'navigate' || step.action === 'snapshot') {
      const start = index;
      while (index < steps.length && (steps[index].action === 'navigate' || steps[index].action === 'snapshot')) index++;
      const navigation = steps.slice(start, index) as BrowserStep[];
      if (navigation.some((item) => item.action === 'navigate')) {
        session.navigationLearningTrail = [];
        labelsDiscoveredThisCall.length = 0;
      }
      const result = await executeBrowserBatch(navigation) as unknown[];
      outputs.push(...result);
      checkpoint?.(result.filter((item) => Boolean(item && typeof item === 'object' && 'action' in item && item.action === 'navigate' && !('error' in item))).length);
      if (hasBrowserActionError(result)) break;
      await observeProcedureSnapshot(getLatestBrowserSnapshot());
      continue;
    }

    if (step.action === 'scroll') {
      const result = await executeBrowserBatch([step]) as unknown[];
      outputs.push(...result);
      if (hasBrowserActionError(result)) break;
      checkpoint?.(1);
      index++;
      continue;
    }

    let snapshot = getLatestBrowserSnapshot();
    if (!snapshot) {
      const captured = await executeBrowserBatch([{ action: 'snapshot' }]);
      outputs.push(...(Array.isArray(captured) ? captured : [captured]));
      snapshot = getLatestBrowserSnapshot();
      await observeProcedureSnapshot(snapshot);
    }
    if (!snapshot) return browserError('Toma un snapshot de la página oficial antes de interactuar con sus controles.');
    const reference = describeSnapshotReference(snapshot.text, step.ref);
    if (!reference) return browserError(`La referencia ${step.ref} no aparece en el snapshot vigente. Toma un snapshot y vuelve a intentarlo.`);
    if (step.action === 'click' && /\[(?:disabled|offscreen)\]/.test(reference.raw)) return browserError('El control no está visible o habilitado en la lectura actual. Revisa la página antes de continuar.');

    if (step.action === 'fill') {
      session.navigationLearningTrail = [];
      labelsDiscoveredThisCall.length = 0;
      if (isSensitiveInput(reference)) return browserError('No se permite completar campos de contraseñas, Clave SOL, tokens, cookies o credenciales desde un lote. Usa sunat_iniciar_sesion con una cuenta importada.');
      const fills: Array<Extract<BrowserStep, { action: 'fill' }>> = [];
      while (index < steps.length && steps[index].action === 'fill') {
        const fill = steps[index] as Extract<BrowserStep, { action: 'fill' }>;
        const field = describeSnapshotReference(snapshot.text, fill.ref);
        if (!field) return browserError(`La referencia ${fill.ref} no aparece en el snapshot vigente. Toma un snapshot y vuelve a intentarlo.`);
        if (isSensitiveInput(field)) return browserError('No se permite completar campos de contraseñas, Clave SOL, tokens, cookies o credenciales desde un lote. Usa sunat_iniciar_sesion con una cuenta importada.');
        fills.push(fill);
        index++;
      }
      const result = await executeBrowserBatch(fills) as unknown[];
      outputs.push(...result);
      checkpoint?.(result.filter((item) => Boolean(item && typeof item === 'object' && 'success' in item && item.success === true)).length);
      if (hasBrowserActionError(result)) break;
      for (const fill of fills) {
        const field = describeSnapshotReference(snapshot.text, fill.ref);
        if (field) observeProcedureStep('fill', field.label);
      }
      continue;
    }

    if (isTaxCommitControl(reference)) {
      if (!jobId || !session.accountBinding) return browserError('Esta acción requiere un trabajo de sunat_trabajos asociado a una cuenta importada y verificada. La navegación y las consultas pueden continuar sin trabajo.');
      const store = await jobs();
      const job = store.get(jobId);
      if (job.accountId !== session.accountBinding.id || ['consulta', 'preparacion'].includes(job.operation)) return browserError('La cuenta o finalidad del trabajo no autoriza preparar este envío tributario. Crea un trabajo con la finalidad correcta.');
      await verifyBinding();
      session.navigationLearningTrail = [];
      labelsDiscoveredThisCall.length = 0;
      const trailing = steps.slice(index + 1);
      if (trailing.some((item) => item.action !== 'snapshot')) return browserError('El clic tributario debe cerrar el lote; se permiten únicamente snapshots después de la confirmación.');
      const freshResult = await executeBrowserBatch([{ action: 'snapshot' }]);
      outputs.push(...(Array.isArray(freshResult) ? freshResult : [freshResult]));
      snapshot = getLatestBrowserSnapshot();
      const freshReference = snapshot ? describeSnapshotReference(snapshot.text, step.ref) : undefined;
      if (!snapshot || !freshReference || freshReference.label !== reference.label) return browserError('El control cambió al actualizar la página. Revisa el snapshot y vuelve a preparar la acción.');
      await observeProcedureSnapshot(snapshot);
      const pendingId = randomUUID();
      pendingApprovals.set(pendingId, {
        click: step,
        expectedUrl: snapshot.url,
        expectedLabel: freshReference.label,
        expectedApprovalHash: snapshot.approvalFingerprint ?? snapshot.fingerprint,
        inputHash: fingerprint(steps),
        expiresAt: Date.now() + 10 * 60_000,
        learningFlowId: getProcedureLearningFlowId(),
        jobId,
        accountId: session.accountBinding!.id,
      });
      store.awaitApproval(jobId);
      const currentInputs = getCurrentFormValues();
      const summary = snapshot.text.split('\n').filter((line) => !/^\s*@e\d+\b|^URL:/i.test(line)).join('\n');
      const data = `\nValores actuales del formulario:\n${currentInputs.map(({ field, value }) => `- ${field}: ${value}`).join('\n')}\nTexto visible para revisar el resumen y los importes:\n${summary}`;
      const requestState = await requestStateCodec.mint({ pendingId }, context);
      return inputRequired({
        requestState,
        inputRequests: {
          'tax-approval': inputRequired.elicit({
            message: `Trabajo: ${jobId}. Cuenta: ${session.accountBinding!.key}. RUC verificado: ${session.accountBinding!.ruc}.\nSUNAT solicita una acción que puede afectar una obligación tributaria. Página: ${sanitizePageUrlForMcp(snapshot.url)}\nAcción: ${freshReference.label}.${data}\n¿Apruebas ejecutar este único clic?`,
            requestedSchema: approvalSchema,
          }),
        },
      });
    }

    const clickResult = await executeBrowserBatch([step]);
    await checkChangedBrowserContext(clickResult);
    outputs.push(...(Array.isArray(clickResult) ? clickResult : [clickResult]));
    if (hasBrowserActionError(clickResult)) {
      session.navigationLearningTrail = [];
      labelsDiscoveredThisCall.length = 0;
      break;
    } else {
      checkpoint?.(1);
      if (isLearnableMenuControl(reference)) labelsDiscoveredThisCall.push(reference.label);
      else {
        session.navigationLearningTrail = [];
        labelsDiscoveredThisCall.length = 0;
      }
      observeProcedureStep('click', reference.label);
    }
    index++;
  }

  if (labelsDiscoveredThisCall.length) {
    if (!getLatestBrowserSnapshot() && !hasBrowserActionError(outputs)) {
      const snapshotResult = await executeBrowserBatch([{ action: 'snapshot' }]);
      outputs.push(...(Array.isArray(snapshotResult) ? snapshotResult : [snapshotResult]));
    }
    const finalSnapshot = getLatestBrowserSnapshot();
    if (finalSnapshot && isAuthenticatedSunatPage(finalSnapshot) && !hasSunatNavigationGate(finalSnapshot.text)) {
      const startsAtRoot = labelsDiscoveredThisCall.some((label) => /^(personas|empresas|aduanas|operador de comercio exterior)$/i.test(label.trim()));
      if (startsAtRoot) session.navigationLearningTrail = [];
      session.navigationLearningTrail.push(...labelsDiscoveredThisCall);
      const lastLabel = labelsDiscoveredThisCall.at(-1);
      if (lastLabel && normalizeMenuLabel(lastLabel) && normalizeMenuLabel(finalSnapshot.text).includes(normalizeMenuLabel(lastLabel))) {
        const saved = await rememberDiscoveredNavigation(session.navigationLearningTrail, session.activeAccountKey ? [session.activeAccountKey] : []);
        if (!saved) session.navigationLearningTrail = [];
      }
    } else {
      session.navigationLearningTrail = [];
    }
  }

  if (!hasBrowserActionError(outputs)) await observeProcedureSnapshot(getLatestBrowserSnapshot());
  return browserBatchResponse(outputs);
}
