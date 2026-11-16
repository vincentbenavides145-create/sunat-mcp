/** Log in on the existing Brave window with its single saved SUNAT credential, selected through native UI Automation. */

import { findLoginButton, getBraveAddressBar, getPasswordSuggestions, isSunatTabLabel, browserUrl, loggedInToSunat, loginPageIsOpen, normalized, walk, type UiaElement, type UiaInspectResult } from './uia-model.js';
import { focusBraveElement, inspectBrave, runWinApp, selectBraveTab, sendBraveKeys, typeBraveText } from './windows-ui.js';

type SavedCredentialSelection =
  | { selected: true; state: UiaInspectResult }
  | { selected: false; reason: 'browser_unavailable' | 'sunat_window_not_found' | 'password_field_not_found' | 'suggestion_not_found' | 'multiple_suggestions' | 'selection_unverified' };

async function selectCredentialFromInspect(initial: UiaInspectResult, deadlineAt?: number): Promise<SavedCredentialSelection> {
  const sunatWindows = (initial.windows ?? []).filter((window) => browserUrl(window));
  if (sunatWindows.length !== 1) return { selected: false, reason: 'sunat_window_not_found' };

  let uniqueSuggestions = getPasswordSuggestions(initial);
  if (uniqueSuggestions.length === 0) {
    const passwordFields: UiaElement[] = [];
    walk(sunatWindows[0].elements ?? [], (element) => {
      if (element.type === 'Edit' && element.selector && (
        element.automationId === 'txtContrasena' || /^(?:contrasena|clave|password)$/i.test(element.name ?? '')
      )) passwordFields.push(element);
    });
    const uniquePasswordFields = [...new Map(passwordFields.map((field) => [field.selector, field])).values()];
    if (uniquePasswordFields.length !== 1) return { selected: false, reason: 'password_field_not_found' };
    try {
      await runWinApp(['ui', 'click', uniquePasswordFields[0].selector!, '-a', 'brave', '--json'], deadlineAt);
    } catch {
      return { selected: false, reason: 'browser_unavailable' };
    }
    try {
      // The password-manager popup belongs to native browser chrome and can
      // appear after the click returns. Wait for its label outside the page root.
      const popup = JSON.parse(await runWinApp(['ui', 'wait-for-native', 'Autocompletar', '--timeout', '1500'], deadlineAt));
      if (!popup.found) return { selected: false, reason: 'suggestion_not_found' };
      uniqueSuggestions = getPasswordSuggestions(await inspectBrave(deadlineAt));
    } catch {
      return { selected: false, reason: 'suggestion_not_found' };
    }
  }
  if (uniqueSuggestions.length === 0) return { selected: false, reason: 'suggestion_not_found' };
  if (uniqueSuggestions.length !== 1) return { selected: false, reason: 'multiple_suggestions' };

  try {
    await runWinApp(['ui', 'invoke', uniqueSuggestions[0].selector!, '--action', 'select'], deadlineAt);
  } catch {
    return { selected: false, reason: 'browser_unavailable' };
  }

  let finalState: UiaInspectResult;
  try {
    finalState = await inspectBrave(deadlineAt);
    const stillOpen = (finalState.windows ?? []).some((window) => {
      let found = false;
      walk(window.elements ?? [], (element) => {
        if (element.type === 'List' && normalized(element.name) === 'autocompletar') found = true;
      });
      return found;
    });
    if (stillOpen) return { selected: false, reason: 'selection_unverified' };
  } catch {
    return { selected: false, reason: 'selection_unverified' };
  }

  return { selected: true, state: finalState };
}

/** Log in on the existing Brave window using its one unique SUNAT password-manager suggestion. */
export async function loginWithSavedSunatCredentialNatively(deadlineAt?: number): Promise<{
  authenticated: boolean;
  reusedSession: boolean;
  usedSavedBrowserCredential?: boolean;
  requiresUserAction?: string;
  code?: string;
}> {
  let state: UiaInspectResult;
  try {
    state = await inspectBrave(deadlineAt);
  } catch {
    return { authenticated: false, reusedSession: false, requiresUserAction: 'No se pudo inspeccionar Brave con Windows UI Automation.' };
  }

  if (loggedInToSunat(state)) return { authenticated: true, reusedSession: true };

  let sunatWindows = (state.windows ?? []).filter((window) => browserUrl(window));
  if (sunatWindows.length !== 1) {
    const mainWindows = (state.windows ?? []).filter((window) => Boolean(window.hwnd) && /Brave/i.test(window.title ?? ''));
    if (mainWindows.length !== 1) {
      return { authenticated: false, reusedSession: false, requiresUserAction: 'Deja una sola ventana de Brave disponible para iniciar sesión en SUNAT.' };
    }
    const sunatTabs: UiaElement[] = [];
    walk(mainWindows[0].elements ?? [], (element) => {
      if (element.type === 'TabItem' && element.selector && isSunatTabLabel(element.name)) sunatTabs.push(element);
    });
    if (sunatTabs.length > 1) return { authenticated: false, reusedSession: false, requiresUserAction: 'Brave tiene varias pestañas de SUNAT; deja visible la pestaña en la que quieres iniciar sesión.' };

    if (sunatTabs.length === 1) {
      try {
        await selectBraveTab(sunatTabs[0].name || sunatTabs[0].selector!, deadlineAt);
      } catch {
        return { authenticated: false, reusedSession: false, requiresUserAction: 'No se pudo activar la pestaña SUNAT en Brave.' };
      }
    } else {
      try {
        const addressBar = getBraveAddressBar(mainWindows[0]);
        if (!addressBar?.selector) throw new Error('Missing address bar');
        await focusBraveElement(addressBar.selector, deadlineAt);
        await typeBraveText('https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?pestana=%2A&agrupacion=%2A', true, deadlineAt);
        await sendBraveKeys('enter', deadlineAt);
      } catch {
        return { authenticated: false, reusedSession: false, requiresUserAction: 'No se pudo abrir el acceso oficial de SUNAT en el Brave existente.' };
      }
    }
    try {
      state = await inspectBrave(deadlineAt);
    } catch {
      return { authenticated: false, reusedSession: false, requiresUserAction: 'SUNAT no terminó de cargar en Brave; revisa la pestaña existente.' };
    }
    if (loggedInToSunat(state)) return { authenticated: true, reusedSession: true };
    sunatWindows = (state.windows ?? []).filter((window) => browserUrl(window));
  }

  if (sunatWindows.length !== 1 || !loginPageIsOpen(state)) {
    return { authenticated: false, reusedSession: false, requiresUserAction: 'Brave no muestra el formulario oficial de acceso a SUNAT.' };
  }

  const selected = await selectCredentialFromInspect(state, deadlineAt);
  if (!selected.selected) {
    const message = selected.reason === 'multiple_suggestions'
      ? 'Brave muestra varias credenciales guardadas para SUNAT. No se eligió ninguna; selecciona la cuenta en el navegador.'
      : selected.reason === 'suggestion_not_found'
        ? 'Brave no mostró una credencial guardada para SUNAT. Selecciónala en el navegador.'
        : 'No se pudo seleccionar de forma segura la credencial guardada de Brave.';
    return { authenticated: false, reusedSession: false, requiresUserAction: message, code: selected.reason };
  }

  state = selected.state;
  if (!loginPageIsOpen(state)) return { authenticated: false, reusedSession: false, requiresUserAction: 'La pestaña de SUNAT cambió después de seleccionar la credencial; no se envió el formulario.' };
  sunatWindows = (state.windows ?? []).filter((window) => browserUrl(window));
  const button = sunatWindows.length === 1 ? findLoginButton(sunatWindows[0]) : undefined;
  if (!button?.selector) return { authenticated: false, reusedSession: false, requiresUserAction: 'No se encontró el botón de acceso del formulario SUNAT.' };

  try {
    await runWinApp(['ui', 'invoke', button.selector, '-a', 'brave', '--action', 'invoke', '--json'], deadlineAt);
    state = await inspectBrave(deadlineAt);
  } catch {
    return { authenticated: false, reusedSession: false, requiresUserAction: 'No se pudo enviar el formulario de acceso de SUNAT desde Brave.' };
  }

  if (loggedInToSunat(state)) return { authenticated: true, reusedSession: false, usedSavedBrowserCredential: true };
  return {
    authenticated: false,
    reusedSession: false,
    requiresUserAction: loginPageIsOpen(state)
      ? 'SUNAT no confirmó el ingreso. Revisa el mensaje que aparece en Brave y completa cualquier verificación solicitada.'
      : 'SUNAT no confirmó el ingreso. Revisa Brave y completa allí cualquier verificación solicitada.',
  };
}
