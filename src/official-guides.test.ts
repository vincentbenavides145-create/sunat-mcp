import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOfficialGuideReview, cleanOfficialGuides, createOfficialGuideReader, describeOfficialGuide, parseOfficialGuides, searchOfficialGuides } from './official-guides.js';
import { createProcedureReader, prepareProcedureCards } from './guide-procedures.js';

const record = { id: 'guia-00000000000000000001', title: 'Cómo generar el Número de Pago SUNAT', url: 'https://www.youtube.com/watch?v=d2kRPkVpy8U', kind: 'video', topics: ['pagos'], discoveredFrom: ['https://centrovirtual.sunat.gob.pe/nuestros-videos'], reviewedAt: '2026-10-24', reading: 'transcript-reviewed', availability: 'retrieved', summary: 'Describe la preparación del NPS; el pago es una fase posterior.', steps: [{ text: 'Acceder a Declaraciones y Pagos.', at: '0:50' }] };
const fixture = (records: unknown[] = [record]) => ({ schemaVersion: 1, updatedAt: '2026-10-24', coverage: { roots: ['https://centrovirtual.sunat.gob.pe/nuestros-videos'], pagesFetched: 1, pendingPages: 0, blockedPages: [], scope: 'Índices oficiales recorridos, no certificación de trámites.' }, records });

test('a guide needs official provenance and cannot impersonate a read procedure or carry an arbitrary URL', () => {
  assert.doesNotThrow(() => parseOfficialGuides(fixture()));
  assert.doesNotThrow(() => parseOfficialGuides(fixture([{ ...record, reading: 'visual-reviewed' }])));
  for (const url of ['http://sunat.gob.pe/manual', 'https://sunat.gob.pe.evil.test/manual', 'https://user:password@sunat.gob.pe/manual', 'https://sunat.gob.pe/manual.pdf?state=session', 'https://sunat.gob.pe/manual.pdf?dni=00000000', 'https://www.youtube.com/watch?v=d2kRPkVpy8U&token=secret', 'file:///C:/secret']) assert.throws(() => parseOfficialGuides(fixture([{ ...record, url }])));
  assert.throws(() => parseOfficialGuides(fixture([{ ...record, discoveredFrom: ['https://example.com/'] }])));
  assert.throws(() => parseOfficialGuides(fixture([{ ...record, reading: 'index-only' }])));
  assert.throws(() => parseOfficialGuides(fixture([{ ...record, summary: undefined }])));
  assert.throws(() => parseOfficialGuides(fixture([{ ...record, reading: 'visual-reviewed', summary: undefined }])));
  assert.throws(() => parseOfficialGuides(fixture([record, record])));
});

test('cleanup removes unavailable URLs and their provenance, merges only identical files, and is idempotent', () => {
  const failed = { ...record, id: 'guia-00000000000000000002', url: 'https://sunat.gob.pe/retirado.pdf', kind: 'pdf', reading: 'unavailable', availability: 'failed', summary: undefined, steps: undefined };
  const file = { ...record, kind: 'pdf', reading: 'content-reviewed', url: 'https://sunat.gob.pe/manual.pdf', contentFingerprint: { sha256: 'a'.repeat(64), basis: 'archivo' }, discoveredFrom: [failed.url, 'https://sunat.gob.pe/indice'] };
  const duplicate = { ...file, id: 'guia-00000000000000000003', url: 'https://sunat.gob.pe/copia.pdf', discoveredFrom: ['https://sunat.gob.pe/otro-indice'] };
  const cleaned = cleanOfficialGuides(fixture([file, duplicate, failed]));
  assert.equal(cleaned.schemaVersion, 2); assert.equal(cleaned.records.length, 1);
  assert.doesNotMatch(JSON.stringify(cleaned), /retirado\.pdf|copia\.pdf/);
  assert.deepEqual(cleaned.records[0].discoveredFrom, ['https://sunat.gob.pe/indice', 'https://sunat.gob.pe/otro-indice']);
  assert.deepEqual(cleaned.coverage.removed, { unavailable: 1, duplicates: 1, withoutProvenance: 0 });
  assert.deepEqual(cleanOfficialGuides(cleaned), cleaned);
  assert.throws(() => parseOfficialGuides({ ...fixture([failed]), schemaVersion: 2 }), /activo/);
});

test('normal queries return prepared steps first and separate mobile, technical, promotional and historical sources', () => {
  const web = { ...record, title: 'Emitir boleta', channels: ['sol-web'], operations: ['emision'], purpose: 'procedimiento', steps: [{ text: 'Preparar la boleta y revisar la vista previa.' }] };
  const mobile = { ...web, id: 'guia-00000000000000000002', url: 'https://sunat.gob.pe/movil', channels: ['app-movil'] };
  const promo = { ...web, id: 'guia-00000000000000000003', url: 'https://sunat.gob.pe/anuncio', purpose: 'informativo', summary: 'Anuncio para pedir boleta.', steps: [] };
  const technical = { ...web, id: 'guia-00000000000000000004', url: 'https://sunat.gob.pe/xml', purpose: 'tecnico', channels: ['api'] };
  const historical = { ...web, id: 'guia-00000000000000000005', url: 'https://sunat.gob.pe/historico', historical: true };
  const cards = prepareProcedureCards('## see-sol-factura — Factura o boleta\r\n\r\n**Fuente:** [Portal](https://sunat.gob.pe/manual).\r\n\r\n1. Preparar los datos.\r\n2. Revisar la vista previa antes de aprobar.\r\n\r\n**Resultado:** comprobante emitido.\r\n**Pendiente:** controles actuales.', [{ id: 'see-sol-factura', title: 'Factura o boleta', profiles: ['personas'], aliases: ['emitir boleta'], evidence: 'guia_publica' }]);
  const catalog = parseOfficialGuides(fixture([web, mobile, promo, technical, historical]));
  const result = searchOfficialGuides(catalog, 'emitir boleta', undefined, undefined, undefined, 10, { channel: 'sol-web', procedures: cards });
  assert.deepEqual(result.results.map((r) => r.id), ['see-sol-factura', web.id]);
  assert.ok((result.results[0].steps as unknown[]).length);
  assert.equal(searchOfficialGuides(catalog, 'boleta', undefined, undefined, undefined, 10, { channel: 'app-movil' }).total, 1);
  assert.equal(searchOfficialGuides(catalog, 'boleta', undefined, undefined, undefined, 10, { scope: 'todo' }).total, 5);
  const page = searchOfficialGuides(catalog, 'boleta', undefined, undefined, undefined, 1, { scope: 'todo' });
  assert.throws(() => searchOfficialGuides(catalog, 'boleta', undefined, undefined, page.nextCursor, 1, { scope: 'operativo' }), /cursor/);
  assert.deepEqual(cards[0].checks, ['comprobante emitido.', 'Revisar la vista previa antes de aprobar.']);
  assert.deepEqual(cards[0].gaps, ['controles actuales.']);
});

test('content caches detect same-size edits, stop on corrupt files and recover without stale fallback', async () => {
  let text = JSON.stringify(fixture()); const read = createOfficialGuideReader(async () => text);
  const first = await read(); assert.equal(await read(), first); assert.ok(Object.isFrozen(first.records[0]));
  text = text.replace('Describe', 'Explicaa');
  const second = await read(); assert.notEqual(second, first); assert.match(second.records[0].summary!, /Explicaa/);
  text = '{'; await assert.rejects(read(), /versión anterior/);
  text = JSON.stringify(fixture()); assert.notEqual(await read(), first);
  let guide = '## ficha-ruc — Ficha RUC\n\n1. Consultar.\n\n**Resultado:** dato visible.';
  let index = JSON.stringify({ publicProcedureGuide: { records: [{ id: 'ficha-ruc', title: 'Ficha RUC', profiles: ['personas'], evidence: 'guia_publica' }] } });
  const procedures = createProcedureReader(async (file) => file === 'guide' ? guide : index);
  const old = await procedures(); assert.equal(await procedures(), old);
  guide = guide.replace('Consultar.', 'Verificar.'); assert.notEqual(await procedures(), old);
  index = '{'; await assert.rejects(procedures(), /ficha anterior/);
});

test('a local review needs actual content, the current revision and generic data, then is reusable without opening its URL', () => {
  const reference = { ...record, reading: 'index-only', availability: 'indexed', summary: undefined, steps: undefined };
  const catalog = parseOfficialGuides(fixture([reference]));
  assert.equal(describeOfficialGuide(catalog.records[0]).needsSourceReview, true);
  const review = { id: reference.id, expectedRevision: describeOfficialGuide(catalog.records[0]).revision, reading: 'transcript-reviewed', summary: 'Describe la generación del NPS.', steps: [{ text: 'Revisar los datos y obtener aprobación antes de generar.', at: '0:50' }], purpose: 'procedimiento', channels: ['sol-web'], operations: ['generacion'], historical: false, requirements: ['Acceso al servicio habilitado.'], checks: ['Revisar la constancia del código.'], gaps: ['Comprobar los controles actuales.'], limitations: ['Subtítulos automáticos.'], entryPoints: ['declaraciones-pagos'], profiles: [], sourceSections: ['0:50'], fingerprintBasis: 'subtitulos' };
  assert.throws(() => applyOfficialGuideReview(catalog, review, new Uint8Array(), '2026-10-24'), /vacío/);
  assert.throws(() => applyOfficialGuideReview(catalog, { ...review, expectedRevision: 'f'.repeat(64) }, Buffer.from('contenido'), '2026-10-24'), /cambió/);
  assert.throws(() => applyOfficialGuideReview(catalog, { ...review, summary: 'Documento 00000001' }, Buffer.from('0:50 contenido'), '2026-10-24'), /identidades/);
  assert.throws(() => applyOfficialGuideReview(catalog, review, Buffer.from('Request Rejected'), '2026-10-24'), /rechazo/);
  assert.throws(() => applyOfficialGuideReview(catalog, review, Buffer.from('subtítulos sin esa marca'), '2026-10-24'), /marcas/);
  const changed = applyOfficialGuideReview(catalog, review, Buffer.from('0:50 Subtítulos realmente consultados'), '2026-10-24');
  const result = searchOfficialGuides(changed, 'generar NPS', undefined, undefined, undefined, 10, { channel: 'sol-web' });
  assert.equal(result.total, 1); assert.deepEqual(result.results[0].steps, review.steps);
  assert.equal(result.results[0].needsSourceReview, false);
  assert.equal(changed.records[0].contentFingerprint?.sha256.length, 64);
});

test('local discovery ignores accents, paginates every match and rejects cursors from a different search', () => {
  const records = Array.from({ length: 125 }, (_, i) => ({ ...record, id: 'guia-' + String(i).padStart(20, '0'), url: `https://orientacion.sunat.gob.pe/guia-${i}` }));
  const catalog = parseOfficialGuides(fixture(records));
  const seen = new Set(); let cursor: string | undefined;
  do {
    const page = searchOfficialGuides(catalog, 'numero pago', 'video', 'pagos', cursor, 17);
    assert.equal(page.total, 125);
    for (const r of page.results) { assert.equal(seen.has(r.id), false); seen.add(r.id); }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 125);
  const first = searchOfficialGuides(catalog, 'numero', undefined, undefined, undefined, 1);
  assert.throws(() => searchOfficialGuides(catalog, 'otra consulta', undefined, undefined, first.nextCursor), /cursor/);
  const changed = structuredClone(catalog); changed.records[0].summary = 'El contenido cambió en la misma fecha.';
  assert.throws(() => searchOfficialGuides(changed, 'numero', undefined, undefined, first.nextCursor), /cursor/, 'same-day content updates invalidate paging rather than silently skipping results');
});
