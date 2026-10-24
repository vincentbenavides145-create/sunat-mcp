import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNativeSnapshot, describeSnapshotReference, findSnapshotReferencesByLabel, isAuthenticatedSunatPage, isSensitiveInput, isTaxCommitControl, sanitizeSnapshotForMcp } from './native-browser.js';
import { getBraveUrl, getPasswordSuggestions, isSunatTabLabel, NativeUiError, typeBraveTextSequence, type UiaElement, type UiaWindow } from './windows-ui.js';

const url = new URL('https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm');
function windowWith(children: UiaElement[]): UiaWindow {
  return { hwnd: 101, elements: [
    { type: 'Button', name: 'Cerrar navegador', selector: 'chrome-close' },
    { type: 'TabItem', name: 'Otra página', selector: 'chrome-tab' },
    { type: 'Document', name: 'SUNAT', selector: 'sunat-document', value: url.toString(), children },
  ] };
}
const button = (selector: string, name: string): UiaElement => ({ type: 'Button', selector, name, isInvokable: true, isEnabled: true });

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
