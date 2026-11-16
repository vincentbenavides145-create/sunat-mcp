/** Executes a route from the operation index or the learned profile, step by step, without repeating clicks. */

import { readFile } from 'node:fs/promises';
import { z } from 'zod/v4';
import { browserError, hasBrowserActionError } from './browser-results.js';
import { sanitizeCdpDiagnostic } from './cdp-diagnostics.js';
import { getLearnedRoute, rememberSuccessfulNavigation } from './learning.js';
import { executeBrowserBatch, executeFocusedRouteStep, getLatestBrowserSnapshot, waitForBrowserLabel } from './native-browser.js';
import { observeProcedureSnapshot, observeProcedureStep } from './procedure-learning.js';
import { navigateObservedRoute } from './route-navigation.js';
import { session } from './session-state.js';
import { NativeUiError } from './windows-ui.js';

const observedRouteSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  path: z.array(z.string().min(1).max(120)).min(1),
  destination: z.string().min(1).max(120),
  destinationChecks: z.array(z.string().min(1).max(160)).min(1).optional(),
  evidence: z.enum(['ruta_observada', 'recorrido_verificado']),
  gate: z.string().max(500).optional(),
}).passthrough();

export function normalizeMenuLabel(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
}

export async function executeObservedRoute(routeId: string, checkpoint?: (count: number) => void) {
  session.navigationLearningTrail = [];
  let catalog: { observedRoutes?: unknown[] };
  try {
    catalog = JSON.parse(await readFile(new URL('../data/operation-index.json', import.meta.url), 'utf8')) as { observedRoutes?: unknown[] };
  } catch {
    return browserError('No se pudo leer el índice local de rutas SUNAT.');
  }
  let rawRoute = catalog.observedRoutes?.find((item) => Boolean(item && typeof item === 'object' && 'id' in item && item.id === routeId));
  let isLearnedRoute = false;
  if (!rawRoute) {
    const learnedRoute = await getLearnedRoute(routeId);
    if (learnedRoute) {
      rawRoute = { ...learnedRoute, evidence: 'ruta_observada' };
      isLearnedRoute = true;
    }
  }
  const parsedRoute = observedRouteSchema.safeParse(rawRoute);
  if (!parsedRoute.success) return browserError('No existe una ruta SUNAT utilizable con ese identificador.');
  const route = parsedRoute.data;

  const navigation = await navigateObservedRoute(route, isLearnedRoute, {
    snapshot: async () => {
      const result = await executeBrowserBatch([{ action: 'snapshot' }]);
      const snapshot = getLatestBrowserSnapshot();
      if (hasBrowserActionError(result) || !snapshot) throw new Error('No se pudo comprobar la página SUNAT actual.');
      return snapshot;
    },
    click: async (ref) => {
      const result = await executeBrowserBatch([{ action: 'click', ref }]);
      if (hasBrowserActionError(result)) {
        const detail = Array.isArray(result) ? result.find((step: any) => typeof step?.code === 'string') : undefined;
        const failure = new NativeUiError(detail?.code ?? 'navigation_failed', 'La ruta se detuvo; no se repetirá el clic.');
        if (typeof detail?.actionDispatched === 'boolean') failure.actionDispatched = detail.actionDispatched;
        failure.diagnostic = sanitizeCdpDiagnostic(detail?.diagnostic);
        throw failure;
      }
    },
    focusedClick: executeFocusedRouteStep,
    reveal: async (ref) => {
      const result = await executeBrowserBatch([{ action: 'scroll', ref }]);
      if (hasBrowserActionError(result)) throw new NativeUiError('navigation_reveal_failed', 'No se pudo revelar el control de la ruta. No se repitió ningún clic.');
    },
    wait: waitForBrowserLabel,
    observed: observeProcedureSnapshot,
    clicked: (label) => { checkpoint?.(1); observeProcedureStep('click', label); },
  });
  if (navigation.status === 'reached' || navigation.status === 'already_at_destination') await rememberSuccessfulNavigation(routeId);
  const messages: Record<typeof navigation.status, string> = {
    reached: 'Ruta completada: ' + route.destination + '.',
    already_at_destination: 'Ya estás en ' + route.destination + '.',
    destination_unconfirmed: 'La ruta se siguió, pero SUNAT no confirmó el destino ' + route.destination + '.',
    precondition_not_met: 'SUNAT muestra una restricción de acceso u obligación para este servicio. No se continuó dentro de esa operación.',
    session_changed: 'La sesión o página SUNAT cambió. No se hicieron más clics; revisa la ventana actual.',
    control_missing: 'No encontré la opción ' + (navigation.label ?? '') + '. Se detuvo la ruta sin capturas ni repetir clics.',
    control_ambiguous: 'La opción ' + (navigation.label ?? '') + ' es ambigua. No se eligió ninguna.',
    approval_required: 'El control ' + (navigation.label ?? '') + ' requiere revisión y aprobación antes de ejecutar la acción tributaria.',
    action_failed: 'No se pudo completar el paso ' + (navigation.label ?? '') + '. Su resultado puede ser incierto: no repitas el clic sin comprobar la página.',
  };
  return {
    content: [{ type: 'text' as const, text: messages[navigation.status] }],
    structuredContent: { routeId, destination: route.destination, ...navigation },
    ...(['session_changed', 'control_missing', 'control_ambiguous', 'approval_required', 'action_failed'].includes(navigation.status) ? { isError: true as const } : {}),
  };
}
