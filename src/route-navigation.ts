import { describeSnapshotReference, findSnapshotReferencesByLabel, isAuthenticatedSunatPage, isTaxCommitControl, type BrowserSnapshot, type FocusedRouteResult } from './native-browser.js';

export interface NavigationRoute { path: string[]; destination: string; destinationChecks?: string[] }
export interface RouteNavigationIo {
  snapshot(): Promise<BrowserSnapshot>;
  click(ref: string): Promise<void>;
  focusedClick(label: string, expectedUrl: string): Promise<FocusedRouteResult>;
  wait(label: string, timeoutMs: number, stopOnGate?: boolean): Promise<boolean>;
  observed(snapshot: BrowserSnapshot): Promise<void>;
  clicked(label: string): void;
}
export interface RouteNavigationResult {
  status: 'reached' | 'already_at_destination' | 'destination_unconfirmed' | 'precondition_not_met' | 'session_changed' | 'control_missing' | 'control_ambiguous' | 'approval_required' | 'action_failed';
  stepsCompleted: number;
  label?: string;
  code?: string;
  actionDispatched?: boolean;
}
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
export const hasSunatNavigationGate = (text: string) => /no se encuentra registrado como obligado|no esta registrado como obligado|acceso no autorizado|no (?:se encuentra|esta) autorizado|no tiene acceso/.test(normalize(text));

/** One MCP call, focused native reads between decisions, no screenshot or click retry. */
export async function navigateObservedRoute(route: NavigationRoute, learned: boolean, io: RouteNavigationIo): Promise<RouteNavigationResult> {
  let completed = 0;
  const result = (status: RouteNavigationResult['status'], label?: string): RouteNavigationResult => ({ status, stepsCompleted: completed, ...(label ? { label } : {}) });
  const failure = (error: unknown, label?: string): RouteNavigationResult => {
    const detail = error as { code?: string; actionDispatched?: boolean };
    return { ...result('action_failed', label), ...(typeof detail?.code === 'string' && /^[a-z_]+$/.test(detail.code) ? { code: detail.code } : {}), ...(typeof detail?.actionDispatched === 'boolean' ? { actionDispatched: detail.actionDispatched } : {}) };
  };
  const read = async () => { const snapshot = await io.snapshot(); await io.observed(snapshot); return snapshot; };
  let currentLabel: string | undefined;
  try {
    let snapshot: BrowserSnapshot | undefined = await read();
    if (!isAuthenticatedSunatPage(snapshot)) return result('session_changed');
    const expectedUrl = snapshot.url;
    const atDestination = (page: BrowserSnapshot) => normalize(page.text).includes(normalize(route.destination)) &&
      (route.destinationChecks?.length ? route.destinationChecks.every((check) => normalize(page.text).includes(normalize(check))) : learned || /\bperiodo\b/.test(normalize(page.text)));
    if (!hasSunatNavigationGate(snapshot.text) && !learned && atDestination(snapshot)) return result('already_at_destination');

    // Services can hide profile selectors; return through the one visible home control.
    if (!findSnapshotReferencesByLabel(snapshot.text, route.path[0]).length) {
      const home = findSnapshotReferencesByLabel(snapshot.text, 'Ir al inicio');
      if (home.length === 1) {
        const control = describeSnapshotReference(snapshot.text, home[0].ref);
        if (control && !isTaxCommitControl(control) && !/\[(?:disabled|offscreen)\]/.test(control.raw)) {
          try { await io.click(home[0].ref); }
          catch (error) { return failure(error, 'Ir al inicio'); }
          snapshot = await read();
          if (!isAuthenticatedSunatPage(snapshot) || snapshot.url !== expectedUrl) return result('session_changed');
        }
      }
    }

    if (hasSunatNavigationGate(snapshot.text)) return result('precondition_not_met');

    for (const label of route.path) {
      currentLabel = label;
      if (!snapshot) {
        let focused: FocusedRouteResult;
        try { focused = await io.focusedClick(label, expectedUrl); }
        catch (error) { return failure(error, label); }
        if (focused === 'clicked') { completed++; io.clicked(label); continue; }
        if (focused === 'expanded') { completed++; continue; }
        if (focused === 'ambiguous') return result('control_ambiguous', label);
        if (focused === 'session_changed') return result('session_changed', label);
        snapshot = await read();
      }
      if (!isAuthenticatedSunatPage(snapshot) || snapshot.url !== expectedUrl) return result('session_changed', label);
      if (hasSunatNavigationGate(snapshot.text)) return result('precondition_not_met', label);
      let matches = findSnapshotReferencesByLabel(snapshot.text, label);
      if (!matches.length && await io.wait(label, 3000)) {
        snapshot = await read();
        if (!isAuthenticatedSunatPage(snapshot) || snapshot.url !== expectedUrl) return result('session_changed', label);
        if (hasSunatNavigationGate(snapshot.text)) return result('precondition_not_met', label);
        matches = findSnapshotReferencesByLabel(snapshot.text, label);
      }
      if (!matches.length) return result('control_missing', label);
      if (matches.length !== 1) return result('control_ambiguous', label);
      const reference = describeSnapshotReference(snapshot.text, matches[0].ref);
      if (!reference || isTaxCommitControl(reference)) return result('approval_required', label);
      if (/\[expanded\]/.test(reference.raw)) { completed++; continue; }
      try { await io.click(matches[0].ref); }
      catch (error) { return failure(error, label); }
      completed++;
      io.clicked(label);
      snapshot = undefined;
    }

    snapshot = await read();
    if (!isAuthenticatedSunatPage(snapshot)) return result('session_changed');
    if (hasSunatNavigationGate(snapshot.text)) return result('precondition_not_met');
    if (!atDestination(snapshot)) {
      // Wait for a native condition rather than a fixed sleep or repeated captures.
      const missingCheck = route.destinationChecks?.find((check) => !normalize(snapshot!.text).includes(normalize(check)));
      await io.wait(missingCheck ?? route.destination, 8000, true);
      // A gate can replace a loading panel even when the requested label never appears.
      snapshot = await read();
      if (!isAuthenticatedSunatPage(snapshot)) return result('session_changed');
      if (hasSunatNavigationGate(snapshot.text)) return result('precondition_not_met');
    }
    return result(atDestination(snapshot) ? 'reached' : 'destination_unconfirmed');
  } catch (error) {
    return failure(error, currentLabel);
  }
}
