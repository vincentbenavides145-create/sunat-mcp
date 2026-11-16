import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyCdpFailure, describeCdpFailure, diagnoseCdpFailure, sanitizeCdpDiagnostic } from './cdp-diagnostics.js';

const classify = (message: string, name = 'Error') => classifyCdpFailure(Object.assign(new Error(message), { name })).reason;

test('known Playwright/CDP failure messages map to a closed set of reasons', () => {
  assert.equal(classify('Execution context was destroyed, most likely because of a navigation'), 'execution_context_destroyed');
  assert.equal(classify('Protocol error (Runtime.callFunctionOn): Cannot find context with specified id'), 'execution_context_destroyed');
  assert.equal(classify('Frame was detached'), 'frame_detached');
  assert.equal(classify('frame got detached.'), 'frame_detached');
  assert.equal(classify('Target page, context or browser has been closed'), 'target_closed');
  assert.equal(classify('Protocol error (Runtime.callFunctionOn): Target closed.'), 'target_closed');
  assert.equal(classify('Connection closed.'), 'connection_closed');
  assert.equal(classify('WebSocket error: socket hang up'), 'connection_closed');
  assert.equal(classify('Timeout 6000ms exceeded.', 'TimeoutError'), 'timeout');
  assert.equal(classify('Object reference chain is too long'), 'serialization');
});

test('exceptions thrown by the local page adapter are separated from protocol failures', () => {
  assert.equal(classify("Cannot read properties of null (reading 'children')", 'TypeError'), 'adapter_exception');
  assert.equal(classify('state is not defined', 'ReferenceError'), 'adapter_exception');
  assert.equal(classify('something nobody has seen before'), 'unknown');
  assert.equal(classify(''), 'unknown');
  assert.equal(classifyCdpFailure(undefined).reason, 'unknown');
  assert.equal(classifyCdpFailure({ message: 42 }).reason, 'unknown');
});

test('a diagnostic never carries the original message, URLs, identities or arbitrary error names', () => {
  const secret = 'Execution context was destroyed at https://e-menu.sunat.gob.pe/cl-ti-itmenu/x?token=SECRETTOKEN "Juan Perez" RUC 20123456789';
  const error = Object.assign(new Error(secret), { name: 'CustomLeakyName20123456789' });
  const diagnostic = diagnoseCdpFailure(error, { stage: 'read', operation: 'snapshot', frameDetached: true, pageClosed: false, loginPage: false });
  assert.equal(diagnostic.reason, 'execution_context_destroyed');
  assert.equal(diagnostic.errorName, 'Other');
  assert.deepEqual({ ...diagnostic, digest: undefined }, { stage: 'read', reason: 'execution_context_destroyed', operation: 'snapshot', errorName: 'Other', frameDetached: true, pageClosed: false, loginPage: false, digest: undefined });
  assert.match(diagnostic.digest, /^[0-9a-f]{8}$/);
  const text = JSON.stringify(diagnostic) + describeCdpFailure(diagnostic, 'Base');
  assert.doesNotMatch(text, /SECRETTOKEN|20123456789|sunat\.gob|Juan|Perez|Leaky/);
});

test('the digest correlates repeats of the same failure but ignores volatile page data', () => {
  const a = diagnoseCdpFailure(new Error('Timeout 6000ms exceeded. waiting for "Boton Uno" at https://e-menu.sunat.gob.pe/a?x=1'), { stage: 'click' });
  const b = diagnoseCdpFailure(new Error('Timeout 6000ms exceeded. waiting for "Otro Boton" at https://e-menu.sunat.gob.pe/b?y=22'), { stage: 'click' });
  const c = diagnoseCdpFailure(new Error('Frame was detached'), { stage: 'click' });
  assert.equal(a.digest, b.digest);
  assert.notEqual(a.digest, c.digest);
});

test('only strictly valid operation names are reported', () => {
  assert.equal(diagnoseCdpFailure(new Error('x'), { stage: 'read', operation: 'scroll-element' }).operation, 'scroll-element');
  for (const bad of ['Snapshot', '../etc', 'a'.repeat(40), 'op with space', 42, undefined]) {
    assert.equal(diagnoseCdpFailure(new Error('x'), { stage: 'read', operation: bad }).operation, undefined);
  }
});

test('the message mentions the technical cause and advises a fresh read only when the page changed underneath', () => {
  const changed = describeCdpFailure(diagnoseCdpFailure(new Error('Execution context was destroyed'), { stage: 'read' }), 'La operación CDP no se pudo verificar');
  assert.match(changed, /navegó o se recargó/);
  assert.match(changed, /lectura nueva/);
  const timeout = describeCdpFailure(diagnoseCdpFailure(new Error('Timeout 10ms exceeded'), { stage: 'read' }), 'La operación CDP no se pudo verificar');
  assert.match(timeout, /tiempo límite/);
  assert.doesNotMatch(timeout, /lectura nueva/);
});

test('sanitizing an untrusted diagnostic keeps only whitelisted fields with valid values', () => {
  const valid = diagnoseCdpFailure(new Error('Frame was detached'), { stage: 'frame', operation: 'snapshot', frameDetached: true });
  assert.deepEqual(sanitizeCdpDiagnostic(valid), valid);
  const dirty = sanitizeCdpDiagnostic({ ...valid, message: 'RUC 20123456789', url: 'https://e-menu.sunat.gob.pe/', errorName: 'Leaky', digest: 'not-a-digest', operation: '../x', frameDetached: 'yes' });
  assert.ok(dirty);
  assert.deepEqual(Object.keys(dirty!).sort(), ['digest', 'errorName', 'reason', 'stage']);
  assert.equal(dirty!.errorName, 'Other');
  assert.equal(dirty!.digest, '00000000');
  for (const bad of [undefined, null, 'text', 42, {}, { stage: 'read' }, { stage: 'nope', reason: 'timeout' }, { stage: 'read', reason: 'invented' }]) {
    assert.equal(sanitizeCdpDiagnostic(bad), undefined);
  }
});
