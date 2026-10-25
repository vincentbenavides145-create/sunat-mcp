import assert from 'node:assert/strict';
import { test } from 'node:test';
import { navigateObservedRoute, type RouteNavigationIo } from './route-navigation.js';
import type { BrowserSnapshot } from './native-browser.js';

const url = 'https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm';
const page = (body: string): BrowserSnapshot => ({ url, text: '@e900 button "Salir"\n' + body, capturedAt: Date.now(), fingerprint: 'synthetic' });
function harness(pages: BrowserSnapshot[]) {
  const calls = { snapshots: 0, clicks: [] as string[], focused: [] as string[], waits: 0, observed: 0, steps: [] as string[] };
  const io: RouteNavigationIo = {
    snapshot: async () => { calls.snapshots++; const snapshot = pages.shift(); assert.ok(snapshot, 'unexpected full read'); return snapshot; },
    click: async (ref) => { calls.clicks.push(ref); },
    focusedClick: async (label) => { calls.focused.push(label); return 'clicked'; },
    wait: async () => { calls.waits++; return false; },
    observed: async () => { calls.observed++; },
    clicked: (label) => { calls.steps.push(label); },
  };
  return { calls, io };
}

test('a five-step known route reads the full page only at entry and destination', async () => {
  const { calls, io } = harness([page('@e1 link "Personas"'), page('- generic "Destino comprobado"')]);
  const route = { path: ['Personas', 'Sistema', 'Registros', 'Compras', 'Gestión'], destination: 'Destino comprobado' };
  assert.deepEqual(await navigateObservedRoute(route, true, io), { status: 'reached', stepsCompleted: 5 });
  assert.equal(calls.snapshots, 2);
  assert.equal(calls.focused.length, 4);
  assert.equal(calls.observed, 2);
  assert.equal(calls.steps.length, 5);
});

test('uncertain native clicks stop the route and are never repeated', async () => {
  const { calls, io } = harness([page('@e1 link "Personas"')]);
  io.focusedClick = async (label) => { calls.focused.push(label); throw new Error('uncertain'); };
  assert.deepEqual(await navigateObservedRoute({ path: ['Personas', 'Compras', 'Otra'], destination: 'Destino' }, true, io), { status: 'action_failed', stepsCompleted: 1, label: 'Compras' });
  assert.equal(calls.focused.length, 1);
  assert.equal(calls.clicks.length, 1);
});

test('tax-looking route steps are blocked even in a saved route', async () => {
  const { calls, io } = harness([page('@e1 button "Presentar declaración"')]);
  assert.equal((await navigateObservedRoute({ path: ['Presentar declaración'], destination: 'Destino' }, true, io)).status, 'approval_required');
  assert.equal(calls.clicks.length + calls.focused.length, 0);
});

test('focused ambiguity and session changes stop without another click', async () => {
  for (const status of ['ambiguous', 'session_changed'] as const) {
    const { calls, io } = harness([page('@e1 link "Personas"')]);
    io.focusedClick = async () => status;
    const result = await navigateObservedRoute({ path: ['Personas', 'Compras'], destination: 'Destino' }, true, io);
    assert.equal(result.status, status === 'ambiguous' ? 'control_ambiguous' : 'session_changed');
    assert.equal(result.stepsCompleted, 1);
    assert.equal(calls.clicks.length, 1);
  }
});

test('a focused miss falls back to a decision snapshot and still intercepts payment', async () => {
  const { calls, io } = harness([page('@e1 link "Personas"'), page('@e2 button "Pagar"')]);
  io.focusedClick = async () => 'snapshot_required';
  assert.equal((await navigateObservedRoute({ path: ['Personas', 'Pagar'], destination: 'Destino' }, true, io)).status, 'approval_required');
  assert.deepEqual(calls.clicks, ['e1']);
  assert.equal(calls.snapshots, 2);
});

test('SUNAT preconditions and missing authentication stop before any action', async () => {
  for (const snapshot of [page('No se encuentra registrado como obligado'), { ...page(''), text: 'Iniciar sesión' }]) {
    const { calls, io } = harness([snapshot]);
    const result = await navigateObservedRoute({ path: ['Personas'], destination: 'Destino' }, true, io);
    assert.ok(['precondition_not_met', 'session_changed'].includes(result.status));
    assert.equal(calls.clicks.length + calls.focused.length, 0);
  }
});

test('a failed final read retains progress instead of inviting a route replay', async () => {
  const { calls, io } = harness([page('@e1 link "Personas"')]);
  const result = await navigateObservedRoute({ path: ['Personas'], destination: 'Destino' }, true, io);
  assert.equal(result.status, 'action_failed');
  assert.equal(result.stepsCompleted, 1);
  assert.equal(calls.clicks.length, 1);
});

test('NPS destination checks verify its actual search form without inventing a Periodo field', async () => {
  const route = { path: ['Consulta de NPS'], destination: 'Consulta de Número de Pago SUNAT', destinationChecks: ['Criterios de Búsqueda de NPS', 'Número de NPS', 'Estado del NPS'] };
  const ready = harness([page('- generic "Consulta de Número de Pago SUNAT"\n- generic "Criterios de Búsqueda de NPS"\n- generic "Número de NPS"\n- generic "Estado del NPS"')]);
  assert.equal((await navigateObservedRoute(route, false, ready.io)).status, 'already_at_destination');
  assert.equal(ready.calls.clicks.length, 0);
  assert.equal(ready.calls.waits, 0);
  const menu = harness([page('@e1 option "Consulta de NPS"'), page('- generic "Consulta de Número de Pago SUNAT"'), page('- generic "Consulta de Número de Pago SUNAT"')]);
  assert.equal((await navigateObservedRoute(route, false, menu.io)).status, 'destination_unconfirmed');
});

test('an asynchronously loaded obligation gate replaces a provisional destination without route replay', async () => {
  const { io, calls } = harness([page('@e1 option "Compras"'), page('- generic "Registro de Compras Electrónico"\n- generic "Periodo"'), page('- generic "No se encuentra registrado como obligado"')]);
  io.wait = async (label, timeout, stopOnGate) => {
    assert.equal(label, 'Propuesta');
    assert.equal(stopOnGate, true);
    return false;
  };
  const result = await navigateObservedRoute({ path: ['Compras'], destination: 'Registro de Compras Electrónico', destinationChecks: ['Periodo', 'Propuesta'] }, false, io);
  assert.equal(result.status, 'precondition_not_met');
  assert.deepEqual(calls.clicks, ['e1']);
});

test('a known route can return safely from a service to the profile menu once', async () => {
  const { io, calls } = harness([page('@e10 button "Ir al inicio"'), page('@e1 tab "Personas"'), page('- generic "Destino"')]);
  assert.equal((await navigateObservedRoute({ path: ['Personas', 'Consultas'], destination: 'Destino' }, true, io)).status, 'reached');
  assert.deepEqual(calls.clicks, ['e10', 'e1']);
  assert.deepEqual(calls.focused, ['Consultas']);
});

test('route failures retain sanitized codes and distinguish preparation from dispatched input', async () => {
  const { io, calls } = harness([page('@e1 tab "Personas"')]);
  io.focusedClick = async () => { throw Object.assign(new Error('private details must not escape'), { code: 'target_obscured', actionDispatched: false }); };
  const result = await navigateObservedRoute({ path: ['Personas', 'Consultas'], destination: 'Destino' }, true, io);
  assert.equal(result.code, 'target_obscured');
  assert.equal(result.actionDispatched, false);
  assert.equal(calls.clicks.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('expanded parent menus are reused rather than clicked closed during a saved route', async () => {
  const { io, calls } = harness([page('@e1 option "Comprobantes" [expanded]\n@e2 option "SEE SOL"'), page('- generic "Destino"')]);
  const result = await navigateObservedRoute({ path: ['Comprobantes', 'SEE SOL', 'Boleta'], destination: 'Destino' }, true, io);
  assert.equal(result.status, 'reached');
  assert.deepEqual(calls.clicks, ['e2']);
  assert.deepEqual(calls.focused, ['Boleta']);
});

test('an access-denied notice stops the affected service but permits a requested route through home', async () => {
  const denied = harness([page('- generic "Acceso no autorizado"')]);
  assert.equal((await navigateObservedRoute({ path: ['Personas'], destination: 'Destino' }, true, denied.io)).status, 'precondition_not_met');
  assert.equal(denied.calls.clicks.length, 0);
  const other = harness([page('@e10 button "Ir al inicio"\n- generic "Acceso no autorizado"'), page('@e1 tab "Personas"'), page('- generic "Destino"')]);
  assert.equal((await navigateObservedRoute({ path: ['Personas'], destination: 'Destino' }, true, other.io)).status, 'reached');
  assert.deepEqual(other.calls.clicks, ['e10', 'e1']);
});
