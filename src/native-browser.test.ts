import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNativeSnapshot, compactBrowserResults, describeSnapshotReference, exactRouteSearchMatches, findSnapshotReferencesByLabel, isAuthenticatedSunatPage, isSensitiveInput, isTaxCommitControl, sanitizePageUrlForMcp, sanitizeSnapshotForMcp } from './native-browser.js';
import { findLoginButton, getBraveUrl, getPasswordSuggestions, isSunatTabLabel, NativeUiError, selectBraveMainWindow, typeBraveTextSequence, type UiaElement, type UiaWindow } from './windows-ui.js';

const url = new URL('https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm');

test('owned Brave credential bubbles do not hide the unique main window or choose between real windows', () => {
  const main = { hwnd: 101, ownerHwnd: 0, processName: 'brave', className: 'Chrome_WidgetWin_1' };
  const bubble = { ...main, hwnd: 102, ownerHwnd: 101 };
  assert.equal(selectBraveMainWindow([bubble, main]), 101);
  assert.equal(selectBraveMainWindow([main, { ...main, hwnd: 103 }]), undefined);
  assert.equal(selectBraveMainWindow([{ ...main, processName: 'other' }]), undefined);
});
function windowWith(children: UiaElement[]): UiaWindow {
  return { hwnd: 101, elements: [
    { type: 'Button', name: 'Cerrar navegador', selector: 'chrome-close' },
    { type: 'TabItem', name: 'Otra página', selector: 'chrome-tab' },
    { type: 'Document', name: 'SUNAT', selector: 'sunat-document', value: url.toString(), children },
  ] };
}
const button = (selector: string, name: string): UiaElement => ({ type: 'Button', selector, name, isInvokable: true, isEnabled: true });

test('SOL profile tabs carry menu evidence without trusting a similarly named form tab', () => {
  const snapshot = buildNativeSnapshot(windowWith([
    { type: 'TabItem', selector: 'profile', name: 'Empresas', automationId: 'divOpcionServicio2' },
    { type: 'TabItem', selector: 'form-tab', name: 'Empresas' },
  ]), url);
  const refs = findSnapshotReferencesByLabel(snapshot.text, 'Empresas');
  assert.equal(refs.length, 2);
  assert.equal(describeSnapshotReference(snapshot.text, refs[0].ref)?.navigation, true);
  assert.equal(describeSnapshotReference(snapshot.text, refs[1].ref)?.navigation, undefined);
});

test('annual Entrar login is recognized only when unique, visible and enabled', () => {
  assert.equal(findLoginButton(windowWith([button('annual', 'Entrar')]))?.selector, 'annual');
  assert.equal(findLoginButton(windowWith([button('a', 'Entrar'), button('b', 'Ingresar')])), undefined);
  assert.equal(findLoginButton(windowWith([{ ...button('a', 'Entrar'), isOffscreen: true }])), undefined);
  assert.equal(findLoginButton(windowWith([{ ...button('a', 'Entrar'), isEnabled: false }])), undefined);
});

test('approval values come from the current form, exclude credentials and do not retain another client', () => {
  const first = buildNativeSnapshot(windowWith([
    { type: 'Edit', selector: 'amount', name: 'Importe', value: '100' },
    { type: 'Edit', selector: 'password', name: 'Contraseña', value: 'synthetic-secret', isPassword: true },
    { type: 'Edit', selector: 'search', automationId: 'txtBusca', name: 'Busque una opción del menú', value: 'query' },
  ]), url);
  assert.deepEqual(first.formValues, [{ field: 'Importe', value: '100' }]);
  const next = buildNativeSnapshot(windowWith([{ type: 'Edit', selector: 'amount', name: 'Importe', value: '200' }]), url);
  assert.deepEqual(next.formValues, [{ field: 'Importe', value: '200' }]);
  assert.doesNotMatch(JSON.stringify(next.formValues), /100|synthetic-secret|query/);
});

test('SUNAT documents and project tabs are not mistaken for an official SOL tab', () => {
  assert.equal(isSunatTabLabel('SUNAT - Menú SOL'), true);
  assert.equal(isSunatTabLabel('SUNAT SOL Operaciones en Línea'), true);
  assert.equal(isSunatTabLabel('Pestaña de grupo de SUNAT - Menú SOL: elemento 1'), true);
  assert.equal(isSunatTabLabel('SUNAT MCP - Documentos de Google'), false);
  assert.equal(isSunatTabLabel('SUNAT - Menú SOL - Documentos de Google'), false);
  assert.equal(isSunatTabLabel('Proyecto SUNAT - GitHub'), false);
});

test('snapshots expose only page controls, not browser chrome or unrelated tabs', () => {
  const snapshot = buildNativeSnapshot(windowWith([button('consultar', 'Consultar')]), url);
  assert.match(snapshot.text, /Consultar/);
  assert.doesNotMatch(snapshot.text, /Cerrar navegador|Otra página/);
});

test('references remain stable when the page inserts another control', () => {
  const first = buildNativeSnapshot(windowWith([button('consultar', 'Consultar')]), url);
  const ref = findSnapshotReferencesByLabel(first.text, 'Consultar')[0].ref;
  const second = buildNativeSnapshot(windowWith([button('new-control', 'Nuevo'), button('consultar', 'Consultar')]), url);
  assert.equal(findSnapshotReferencesByLabel(second.text, 'Consultar')[0].ref, ref);
  assert.notEqual(findSnapshotReferencesByLabel(second.text, 'Nuevo')[0].ref, ref);
});

test('removed references are not reassigned to a different control', () => {
  const first = buildNativeSnapshot(windowWith([button('old', 'Anterior')]), url);
  const oldRef = findSnapshotReferencesByLabel(first.text, 'Anterior')[0].ref;
  const second = buildNativeSnapshot(windowWith([button('replacement', 'Otro')]), url);
  assert.equal(describeSnapshotReference(second.text, oldRef), undefined);
});

test('changing a form value invalidates approval even when visible labels do not change', () => {
  const page = (value: string) => windowWith([
    { type: 'Edit', selector: 'amount', name: 'Importe', value, isEditable: true }, button('submit', 'Presentar'),
  ]);
  const first = buildNativeSnapshot(page('example-before'), url);
  const changed = buildNativeSnapshot(page('example-after'), url);
  assert.equal(first.text, changed.text);
  assert.notEqual(first.fingerprint, changed.fingerprint);
  assert.doesNotMatch(changed.text, /example-before|example-after/);
});

test('disabled options cannot be resolved as a route step', () => {
  const snapshot = buildNativeSnapshot(windowWith([{ ...button('disabled', 'Consultar'), isEnabled: false }]), url);
  assert.equal(findSnapshotReferencesByLabel(snapshot.text, 'Consultar').length, 0);
  const hidden = buildNativeSnapshot(windowWith([{ ...button('hidden', 'Consultar'), isOffscreen: true }]), url);
  assert.equal(findSnapshotReferencesByLabel(hidden.text, 'Consultar').length, 0);
});

test('dropdowns and unnamed password fields retain usable typed references', () => {
  const snapshot = buildNativeSnapshot(windowWith([
    { type: 'ComboBox', selector: 'period', name: 'Periodo' },
    { type: 'Edit', selector: 'password', automationId: 'txtContrasena', isPassword: true },
  ]), url);
  assert.match(snapshot.text, /combobox "Periodo"/);
  const passwordLine = snapshot.text.split('\n').find((line) => line.includes('txtContrasena'))!;
  const ref = passwordLine.match(/@(e\d+)/)![1];
  assert.equal(isSensitiveInput(describeSnapshotReference(snapshot.text, ref)!), true);
});

test('missing document fails instead of exposing browser controls', () => {
  assert.throws(() => buildNativeSnapshot({ hwnd: 102, elements: [button('chrome', 'Configuración')] }, url), NativeUiError);
});

test('document URLs never become page text and login URL parameters are hidden', () => {
  const login = new URL('https://api-seguridad.sunat.gob.pe/v1/clientessol/example/oauth2/loginMenuSol?state=example-sensitive');
  const snapshot = buildNativeSnapshot(windowWith([{ type: 'Document', value: login.toString(), children: [] }]), login);
  assert.doesNotMatch(snapshot.text, /example-sensitive|clientessol\/example/);
});

test('ordinary SUNAT service URLs hide session parameters while approvals bind their real state', () => {
  const firstUrl = new URL('https://ww1.sunat.gob.pe/servicio?accion=EmisionRHE&p=synthetic-private&usub=synthetic-account#synthetic-fragment');
  const secondUrl = new URL('https://ww1.sunat.gob.pe/servicio?accion=EmisionRHE&p=synthetic-changed&usub=synthetic-account');
  const first = buildNativeSnapshot(windowWith([button('issue', 'Emitir Recibo')]), firstUrl);
  const second = buildNativeSnapshot(windowWith([button('issue', 'Emitir Recibo')]), secondUrl);
  assert.equal(sanitizePageUrlForMcp(firstUrl.toString()), 'https://ww1.sunat.gob.pe/servicio');
  assert.doesNotMatch(first.text, /synthetic-private|synthetic-account|synthetic-fragment|usub=|accion=/);
  assert.equal(first.text, second.text);
  assert.notEqual(first.approvalFingerprint, second.approvalFingerprint);
  assert.doesNotMatch(sanitizeSnapshotForMcp('URL: ' + firstUrl.toString()), /synthetic|usub=/);
});

test('native credential sequences refuse an unverified field order before typing', async () => {
  await assert.rejects(typeBraveTextSequence(['example-user', 'example-password']), (error: unknown) => error instanceof NativeUiError && error.code === 'unverified_field_order');
});

test('tax commits and credential inputs remain distinguished from ordinary navigation', () => {
  assert.equal(isTaxCommitControl({ role: 'button', label: 'Presentar' }), true);
  assert.equal(isTaxCommitControl({ role: 'link', label: 'Consultar' }), false);
  assert.equal(isSensitiveInput({ role: 'password field', label: 'Clave SOL' }), true);
});

test('SOL generation, deletion and proposal changes require tax approval', () => {
  for (const label of ['Generar', 'Generar registro', 'Generar registros', 'Generar Solicitud', 'Generar la solicitud', 'Generar pedido de deuda', 'Eliminar', 'Excluir', 'Actualizar propuesta', 'Actualizar la propuesta', 'Presente/Pague', 'Guardar cambios', 'Confirmar pago']) {
    assert.equal(isTaxCommitControl({ role: 'button', label }), true, label);
  }
});

test('consultation, report generation and menu headings remain ordinary navigation', () => {
  for (const label of ['Consultar', 'Buscar', 'Generar reporte', 'Generar constancia', 'Descargar reporte', 'Actualizar', 'Generación de Registro', 'Registro de Compras Electrónico', 'Solicitud de devolución', 'Ver detalle', 'Siguiente', 'Regresar']) {
    assert.equal(isTaxCommitControl({ role: 'link', label }), false, label);
  }
});

test('rendered document URL takes precedence over a stale or edited address bar', () => {
  const state = windowWith([]);
  state.elements!.unshift({ type: 'Edit', selector: 'address', automationId: 'view_1012', value: 'https://example.org/' });
  assert.equal(getBraveUrl(state)?.hostname, 'e-menu.sunat.gob.pe');
});

test('a menu URL alone does not establish an authenticated session', () => {
  const snapshot = (text: string) => ({ text, url: url.toString() });
  assert.equal(isAuthenticatedSunatPage(snapshot('SUNAT - Menú SOL')), false);
  assert.equal(isAuthenticatedSunatPage(snapshot('@e1 button "Iniciar sesión"')), false);
  assert.equal(isAuthenticatedSunatPage(snapshot('@e1 button "Salir"')), true);
  assert.equal(isAuthenticatedSunatPage(snapshot('@e1 button "Salir" [offscreen]')), false);
  assert.equal(isAuthenticatedSunatPage({ text: '@e1 button "Salir"', url: 'https://example.org/' }), false);
});

test('a hidden HTTPS scheme is restored even when the login query contains a redirect URL', () => {
  const window: UiaWindow = { hwnd: 101, elements: [{ type: 'Edit', selector: 'address', automationId: 'view_1012', value: 'api-seguridad.sunat.gob.pe/oauth2/loginMenuSol?redirect_uri=https://e-menu.sunat.gob.pe/' }] };
  assert.equal(getBraveUrl(window)?.origin, 'https://api-seguridad.sunat.gob.pe');
  assert.equal(getBraveUrl(window)?.pathname, '/oauth2/loginMenuSol');
});

test('saved password suggestions deduplicate one visual row without collapsing distinct accounts', () => {
  const row = { type: 'ListItem', name: 'Contraseña de cuenta sintética', selector: 'row', x: 50, y: 100 };
  const state = (rows: UiaElement[]) => ({ windows: [{ hwnd: 101, elements: [{ type: 'List', name: 'Autocompletar ', children: rows }] }] });
  assert.equal(getPasswordSuggestions(state([row, { ...row, selector: 'duplicate', x: 51 }])).length, 1);
  assert.equal(getPasswordSuggestions(state([row, { ...row, selector: 'second', y: 150 }])).length, 2);
  assert.equal(getPasswordSuggestions(state([{ ...row, isOffscreen: true }])).length, 0);
  assert.equal(getPasswordSuggestions(state([{ type: 'Group', children: [{ ...row, children: [{ ...row, selector: 'nested', x: 90 }] }] }])).length, 1);
});

test('credential fields are hidden without concealing public RUC navigation labels', () => {
  const text = sanitizeSnapshotForMcp('@e1 option "Mi RUC y Otros Registros"\n@e2 link "Ficha RUC"\n@e3 textbox "DNI"\n@e4 password field "Contraseña"');
  assert.match(text, /Mi RUC y Otros Registros/);
  assert.match(text, /Ficha RUC/);
  assert.match(text, /@e3 \[campo sensible oculto\]/);
  assert.match(text, /@e4 \[campo sensible oculto\]/);
});

test('service titles need native menu evidence to avoid an unnecessary tax confirmation', () => {
  const service = { type: 'Hyperlink', name: 'Registrar comprobantes de pago', selector: 'register-service', isInvokable: true };
  let snapshot = buildNativeSnapshot(windowWith([service]), url);
  let reference = describeSnapshotReference(snapshot.text, findSnapshotReferencesByLabel(snapshot.text, service.name)[0].ref)!;
  assert.equal(isTaxCommitControl(reference), true, 'an arbitrary link is not trusted as navigation');
  snapshot = buildNativeSnapshot(windowWith([{ type: 'Menu', name: 'Servicios', children: [service, button('commit', 'Registrar')] }]), url);
  reference = describeSnapshotReference(snapshot.text, findSnapshotReferencesByLabel(snapshot.text, service.name)[0].ref)!;
  assert.equal(reference.navigation, true);
  assert.equal(isTaxCommitControl(reference), false);
  assert.equal(isTaxCommitControl(describeSnapshotReference(snapshot.text, findSnapshotReferencesByLabel(snapshot.text, 'Registrar')[0].ref)!), true);
  snapshot = buildNativeSnapshot(windowWith([{ type: 'Menu', name: 'Servicios', children: [service, { type: 'Edit', selector: 'amount', name: 'Importe', value: 'example' }] }]), url);
  assert.equal(isTaxCommitControl(describeSnapshotReference(snapshot.text, findSnapshotReferencesByLabel(snapshot.text, service.name)[0].ref)!), true, 'a menu containing a form must not waive approval');
  for (const label of ['Cancelar', 'Aceptar', 'Confirmar pago', 'Eliminar registro']) assert.equal(isTaxCommitControl({ role: 'button', label, navigation: true }), true);
  for (const label of ['Cancelar búsqueda', 'Cancelar filtro', 'Cerrar ayuda', 'Regresar']) assert.equal(isTaxCommitControl({ role: 'button', label }), false);
});

test('the observed SOL sidebar opens the honorarios service without approving the final issue button', () => {
  const label = 'Emitir Recibo por Honorario Electrónico';
  const menu = { type: 'Group', automationId: 'divSubMenuIzquierda', children: [{ type: 'List', children: [{ type: 'ListItem', name: label, selector: 'honorarios-service' }] }] };
  const snapshot = buildNativeSnapshot(windowWith([menu, button('issue', 'Emitir Recibo')]), url);
  const ref = findSnapshotReferencesByLabel(snapshot.text, label)[0].ref;
  assert.equal(isTaxCommitControl(describeSnapshotReference(snapshot.text, ref)!), false);
  assert.equal(isTaxCommitControl(describeSnapshotReference(snapshot.text, findSnapshotReferencesByLabel(snapshot.text, 'Emitir Recibo')[0].ref)!), true);
  assert.equal(isTaxCommitControl({ role: 'option', label }), true, 'the same label outside the verified sidebar remains protected');
});

test('Emitir Factura opens a verified SOL menu while the same form button remains protected', () => {
  const label = 'Emitir Factura';
  const sidebar = { type: 'Group', automationId: 'divSubMenuIzquierda', children: [{ type: 'ListItem', name: label, selector: 'invoice-menu' }] };
  const snapshot = buildNativeSnapshot(windowWith([sidebar, button('invoice-submit', label)]), url);
  const lines = snapshot.text.split('\n');
  const menuRef = lines.find((line) => /option "Emitir Factura"/.test(line))!.match(/@(e\d+)/)![1];
  const submitRef = lines.find((line) => /button "Emitir Factura"/.test(line))!.match(/@(e\d+)/)![1];
  assert.equal(isTaxCommitControl(describeSnapshotReference(snapshot.text, menuRef)!), false);
  assert.equal(isTaxCommitControl(describeSnapshotReference(snapshot.text, submitRef)!), true);
});

test('read-only status and clock changes preserve approval but still update the page snapshot', () => {
  const page = (notice: string) => windowWith([
    { type: 'Edit', selector: 'amount', name: 'Importe', value: 'synthetic-amount' },
    button('submit', 'Presentar'), { type: 'Text', name: 'Resumen de la declaración' },
    { type: 'StatusBar', name: notice, children: [{ type: 'Text', name: notice }] },
  ]);
  const first = buildNativeSnapshot(page('Hora actual 10:20:30'), url);
  const changed = buildNativeSnapshot(page('Hora actual 10:21:00'), url);
  assert.notEqual(first.fingerprint, changed.fingerprint);
  assert.equal(first.approvalFingerprint, changed.approvalFingerprint);
  assert.equal(buildNativeSnapshot(page('Aviso informativo A'), url).approvalFingerprint, buildNativeSnapshot(page('Aviso informativo B'), url).approvalFingerprint);
});

test('approval continues to bind exact fields, summaries, account context and target state', () => {
  const page = (value = 'example', summary = 'Resumen original', account = 'Cuenta de prueba A', enabled = true) => windowWith([
    { type: 'Text', name: account }, { type: 'Edit', selector: 'amount', name: 'Importe', value },
    { ...button('submit', 'Presentar'), isEnabled: enabled }, { type: 'Text', name: summary },
  ]);
  const base = buildNativeSnapshot(page(), url).approvalFingerprint;
  for (const state of [page('changed'), page('example', 'Resumen modificado'), page('example', 'Resumen original', 'Cuenta de prueba B'), page('example', 'Resumen original', 'Cuenta de prueba A', false)]) {
    assert.notEqual(base, buildNativeSnapshot(state, url).approvalFingerprint);
  }
  assert.notEqual(base, buildNativeSnapshot(page(), new URL('https://e-menu.sunat.gob.pe/otra')).approvalFingerprint);
  assert.notEqual(base, buildNativeSnapshot({ ...page(), hwnd: 202 }, url).approvalFingerprint);
});

test('transaction notices and unknown status content cannot evade approval checks', () => {
  for (const [before, after] of [['Aviso informativo: total original', 'Aviso informativo: total cambiado'], ['Aviso informativo IGV 100', 'Aviso informativo IGV 200'], ['Aviso informativo 100', 'Aviso informativo 200'], ['Advertencia original', 'Advertencia nueva']]) {
    const page = (name: string) => windowWith([button('submit', 'Presentar'), { type: 'StatusBar', name }]);
    assert.notEqual(buildNativeSnapshot(page(before), url).approvalFingerprint, buildNativeSnapshot(page(after), url).approvalFingerprint);
  }
});

test('focused searches preserve ambiguity and never resolve offscreen or disabled targets', () => {
  const element = { type: 'Hyperlink', name: 'Compras', selector: 'compras', isInvokable: true };
  const search = (matches: UiaElement[], hasMore = false) => ({ matches, matchCount: matches.length, hasMore });
  assert.equal(exactRouteSearchMatches(search([element, element]), 'Compras')?.length, 1);
  assert.equal(exactRouteSearchMatches(search([element, { ...element, selector: 'other' }]), 'Compras')?.length, 2);
  assert.equal(exactRouteSearchMatches(search([element], true), 'Compras'), undefined);
  assert.equal(exactRouteSearchMatches(search([{ ...element, isOffscreen: true }, { ...element, isEnabled: false }]), 'Compras')?.length, 0);
  assert.equal(exactRouteSearchMatches(search([element]), 'Ventas')?.length, 0);
});

test('batch responses retain action results and errors while returning the page text only once', () => {
  const outputs = [{ action: 'snapshot', snapshot: 'before' }, { action: 'click', success: true }, { action: 'snapshot', snapshot: 'after' }, { action: 'click', error: 'uncertain' }];
  const compact = compactBrowserResults(outputs);
  assert.deepEqual(compact, [{ action: 'snapshot', snapshotOmitted: true }, outputs[1], outputs[2], outputs[3]]);
  assert.equal((outputs[0] as { snapshot: string }).snapshot, 'before');
});
