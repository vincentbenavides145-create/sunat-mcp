import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evidenceContent, renderedEvidence, requireWorkflow, workflowCatalog } from './workflows.js';

const page = (text: string) => ({ text, url: 'https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm' });
test('all 30 procedure cards have explicit assisted-operation contracts without claiming certification', async () => {
  const catalog = await workflowCatalog();
  assert.equal(catalog.length, 30); assert.equal(new Set(catalog.map((item) => item.id)).size, 30);
  for (const workflow of catalog) { assert.equal(workflow.execution, 'assisted'); assert.ok(workflow.guide.endsWith(workflow.id)); await requireWorkflow(workflow.id, 'consulta'); }
  await requireWorkflow('declara-facil-621', 'presentacion');
  await assert.rejects(requireWorkflow('ficha-ruc', 'pago'));
});
test('submission, payment, previews and asynchronous tickets are distinct results', () => {
  const submitted = page('- generic "Constancia de presentación Número de orden 123456"');
  assert.equal(renderedEvidence(submitted, 'presentacion'), 'presentation-receipt');
  assert.equal(renderedEvidence(submitted, 'pago'), undefined);
  assert.equal(renderedEvidence(page('@e1 button "Constancia de presentación Número de orden"'), 'presentacion'), undefined);
  assert.equal(renderedEvidence(page('- generic "Vista previa Constancia de presentación Número de orden"'), 'presentacion'), undefined);
  assert.equal(renderedEvidence(page('- generic "Ticket recibido Pendiente Número de orden"'), 'presentacion'), undefined);
  assert.equal(renderedEvidence({ ...submitted, url: 'https://example.com/' }, 'presentacion'), undefined);
  assert.equal(renderedEvidence(page('- generic "Constancia de presentación Número de orden"'), 'presentacion'), undefined, 'labels without a concrete identifier are not a receipt');
  assert.equal(evidenceContent(submitted, 'presentacion'), evidenceContent(page(submitted.text + '\n- generic "Otros datos cambiaron"'), 'presentacion'), 'unrelated page changes cannot turn the same old receipt into a new result');
  assert.equal(evidenceContent(page('- generic "24/10/2026 12:00"\n- generic "Constancia"')), evidenceContent(page('- generic "24/10/2026 12:01"\n- generic "Constancia"')));
});
