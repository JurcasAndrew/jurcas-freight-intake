import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, qualityGate, editQualityValue, confirmQualityItem, approveRecord, asPayload,
  addDeliveryStop, removeDeliveryStop, invalidateSourceReview } from '../engine.js';

const aliases = ['Delivery', 'Drop-off', 'Drop off', 'Dropoff', 'Unloading', 'Rozładunek', 'Rozladunek', 'Pristatymas'];
function email(label, emptySecond = false) {
  return [
    'Please quote transport.',
    'Loading: Kaunas, Lithuania',
    'Date: 16 October 2026',
    label + ' 1: Hamburg, Germany, 19 Oct 2026 - 12 EUR pallets',
    label + ' 2:' + (emptySecond ? '' : ' Bremen, Germany, 20 Oct 2026 - 6 EUR pallets'),
    'Total: ' + (emptySecond ? '12' : '18') + ' EUR pallets / 1000 kg',
    'Trailer: tautliner',
  ].join('\n');
}
function confirmValues(rec) {
  for (const e of qualityGate(rec).entries) if (e.value && !e.derived) confirmQualityItem(rec, e.id);
}
function reviewed(text) {
  const rec = analyze(text);
  editQualityValue(rec, 'address.loading', 'TEST ONLY: Loading Street 1, Kaunas, LT');
  rec.stops.forEach((_, i) => editQualityValue(rec, 'address.stop.' + i, 'TEST ONLY: Delivery Street ' + (i + 1) + ', DE'));
  editQualityValue(rec, 'adr.decision', 'non_adr');
  editQualityValue(rec, 'adr.reference', 'TEST ONLY: fictional classification verified by a fictional reviewer');
  confirmValues(rec);
  return rec;
}
function assertBlocked(rec, code) {
  const gate = qualityGate(rec);
  assert.equal(gate.can_approve, false);
  assert.equal(gate.ready_for_crm, false);
  assert.ok(gate.issues.some(i => i.code === code && i.blocking && i.severity === 'critical'), code);
  assert.equal(approveRecord(rec).ok, false);
  const payload = JSON.parse(JSON.stringify(asPayload(rec)));
  assert.equal(payload.ready_for_crm, false);
  assert.equal(payload.human_review_required, true);
  assert.equal(payload.verification.ready_for_crm, false);
  assert.equal(payload.verification.approved_at, null);
  assert.notEqual(payload.verification.status, 'confirmed');
  assert.ok(payload.verification.issues.some(i => i.code === code));
}
for (const label of aliases) {
  test(label + ': an empty second source stop blocks approval in the engine', () => {
    const rec = reviewed(email(label, true));
    assert.equal(rec.stops.length, 1);
    assertBlocked(rec, 'stop_count');
    assert.ok(qualityGate(rec).issues.some(i => i.code === 'source_stop_incomplete:2'));
  });
  test(label + ': deleting the second stop cannot hide it from source validation', () => {
    const rec = reviewed(email(label));
    assert.equal(approveRecord(rec).ok, true);
    removeDeliveryStop(rec, 1);
    assertBlocked(rec, 'stop_count');
  });
  test(label + ': moving all pallets to the remaining stop does not bypass the gate', () => {
    const rec = reviewed(email(label));
    approveRecord(rec);
    removeDeliveryStop(rec, 1);
    editQualityValue(rec, 'stop.0.pallets', '18');
    editQualityValue(rec, 'address.stop.0', 'TEST ONLY: Delivery Street 1, DE');
    confirmValues(rec);
    assert.equal(qualityGate(rec).issues.some(i => i.code === 'pallet_total'), false);
    assertBlocked(rec, 'stop_count');
  });
  test(label + ': two valid, separately reviewed stops can be approved', () => {
    const rec = reviewed(email(label));
    assert.equal(rec.stops.length, 2);
    assert.equal(qualityGate(rec).ready_for_crm, false);
    assert.equal(approveRecord(rec).ok, true);
    assert.equal(asPayload(rec).ready_for_crm, true);
    assert.deepEqual(asPayload(rec).verification.issues, []);
  });
  test(label + ': changed source blocks stale data and reanalysis starts without confirmations', () => {
    const rec = reviewed(email(label));
    assert.equal(approveRecord(rec).ok, true);
    rec.sourceText = rec.sourceText.replace('Bremen, Germany', 'Rostock, Germany');
    assertBlocked(rec, 'source_changed');
    assert.equal(qualityGate(rec).entries.some(e => e.status === 'confirmed'), false);
    confirmValues(rec); // Reconfirming cached old data is insufficient: analysis is mandatory.
    assertBlocked(rec, 'source_changed');
    const fresh = analyze(rec.sourceText);
    assert.equal(fresh.stops[1].place, 'Rostock, Germany');
    assert.equal(qualityGate(fresh).entries.some(e => e.status === 'confirmed'), false);
    assert.equal(asPayload(fresh).ready_for_crm, false);
  });
  test(label + ': blocked draft JSON contains source problems before record approval', () => {
    const rec = reviewed(email(label, true));
    const payload = JSON.parse(JSON.stringify(asPayload(rec)));
    assert.equal(payload.schema, 'jurcasai.freight-intake.v0.2');
    assert.equal(payload.ready_for_crm, false);
    assert.equal(payload.verification.can_approve, false);
    assert.equal(payload.verification.approved_at, null);
    assert.equal(payload.human_review_required, true);
    assert.ok(payload.verification.issues.some(i => i.code === 'source_stop_incomplete:2'));
  });
  test(label + ': duplicated source numbering cannot be resolved by editing only the record', () => {
    const rec = analyze(email(label).replace(label + ' 2:', label + ' 1:'));
    editQualityValue(rec, 'stop.1.order', '2');
    assertBlocked(rec, 'source_stop_numbering');
  });
  test(label + ': filling a blank source declaration in structured data still requires source correction', () => {
    const rec = reviewed(email(label, true));
    addDeliveryStop(rec);
    for (const [key, value] of Object.entries({place:'Bremen, Germany',date:'2026-10-20',pallets:'6'}))
      editQualityValue(rec, 'stop.1.' + key, value);
    editQualityValue(rec, 'field.pallets', '18');
    editQualityValue(rec, 'address.stop.1', 'TEST ONLY: Delivery Street 2, DE');
    confirmValues(rec);
    assertBlocked(rec, 'source_stop_incomplete:2');
  });
}

test('Mixed aliases, case, CRLF, bullets, # and hyphen separators share one interpretation', () => {
  const text = email('Delivery').replace('Delivery 1:', '  • dRoP oFf # 1 -')
    .replace('Delivery 2:', '\t* PRISTATYMAS #2:').replaceAll('\n', '\r\n');
  const rec = reviewed(text);
  assert.equal(rec.stops.length, 2);
  assert.equal(approveRecord(rec).ok, true);
  for (const e of qualityGate(rec).entries.filter(e => e.source))
    assert.equal(rec.activeText.slice(e.source.start, e.source.end), e.source.text);
});
test('Quoted historical stop declarations cannot add current delivery obligations', () => {
  const rec = reviewed(email('Drop-off') + '\nPrevious email\nDelivery 3:\nPristatymas 4:');
  assert.equal(rec.stops.length, 2);
  assert.equal(approveRecord(rec).ok, true);
});
test('A source numbering gap remains ambiguous after manual record renumbering', () => {
  const rec = analyze(email('Delivery').replace('Delivery 2:', 'Delivery 3:'));
  editQualityValue(rec, 'stop.1.order', '2');
  assertBlocked(rec, 'source_stop_numbering');
});
test('Zero or unsafe source numbers cannot be concealed by valid record numbers', () => {
  for (const number of ['0', '999999999999999999999999999999999999']) {
    const rec = analyze(email('Drop-off').replace('Drop-off 2:', 'Drop-off ' + number + ':'));
    rec.stops.forEach((s,i) => editQualityValue(rec, 'stop.' + i + '.order', String(i + 1)));
    assertBlocked(rec, 'source_stop_numbering');
  }
});
test('Conflicting source count declarations require source correction', () => {
  for (const prefix of ['We need one delivery point.\n', 'We need two delivery points. We need three unloading stops.\n']) {
    const rec = reviewed(prefix + email('Delivery'));
    assertBlocked(rec, 'source_stop_count_conflict');
  }
});
test('Adding, removing and recreating a stop cannot restore prior stop confirmations', () => {
  const rec = reviewed(email('Delivery'));
  approveRecord(rec);
  addDeliveryStop(rec);
  assert.equal(qualityGate(rec).entries.filter(e => e.id.startsWith('stop.')).some(e => e.status === 'confirmed'), false);
  removeDeliveryStop(rec, 2);
  assert.equal(qualityGate(rec).entries.filter(e => e.id.startsWith('stop.')).some(e => e.status === 'confirmed'), false);
  assert.equal(asPayload(rec).ready_for_crm, false);
  assert.equal(approveRecord(rec).ok, false);
});
test('Changing and restoring stop order requires new confirmations', () => {
  const rec = reviewed(email('Delivery'));
  approveRecord(rec);
  editQualityValue(rec, 'stop.0.order', '2');
  editQualityValue(rec, 'stop.0.order', '1');
  assert.equal(qualityGate(rec).entries.filter(e => e.id.startsWith('stop.')).some(e => e.status === 'confirmed'), false);
  assert.equal(approveRecord(rec).ok, false);
});
test('Direct structural changes are checked even without UI event handlers', () => {
  const rec = reviewed(email('Pristatymas'));
  approveRecord(rec);
  rec.stops.reverse();
  assert.equal(asPayload(rec).ready_for_crm, false);
  assert.equal(qualityGate(rec).entries.filter(e => e.id.startsWith('stop.')).some(e => e.status === 'confirmed'), false);
  assert.equal(approveRecord(rec).ok, false);
});

test('Clearing source review immediately revokes every confirmation, including ADR', () => {
  const rec = reviewed(email('Delivery'));
  approveRecord(rec);
  invalidateSourceReview(rec);
  const gate = qualityGate(rec);
  assert.equal(gate.entries.some(e => e.status === 'confirmed'), false);
  assert.equal(gate.adr_review_required, true);
  assert.equal(asPayload(rec).ready_for_crm, false);
  assert.equal(approveRecord(rec).ok, false);
});
test('Changing and then restoring source text does not resurrect observed old confirmations', () => {
  const rec = reviewed(email('Drop-off'));
  approveRecord(rec);
  const original = rec.sourceText;
  rec.sourceText += '\nUpdated order';
  assertBlocked(rec, 'source_changed');
  rec.sourceText = original;
  assert.equal(qualityGate(rec).entries.some(e => e.status === 'confirmed'), false);
  assert.equal(approveRecord(rec).ok, false);
});
test('Whitespace-only declarations cannot consume the following line as a place', () => {
  for (const label of aliases) {
    const rec = reviewed(email(label, true).replace(label + ' 2:', label + ' 2: \t'));
    assert.equal(rec.stops.length, 1);
    assertBlocked(rec, 'source_stop_incomplete:2');
  }
});
test('Placeholder places remain unresolved even when a reviewer fills the structured field', () => {
  for (const label of aliases) {
    const rec = analyze(email(label).replace('Bremen, Germany', 'TBD'));
    editQualityValue(rec, 'stop.1.place', 'Bremen, Germany');
    assertBlocked(rec, 'source_stop_incomplete:2');
  }
});
test('Source evidence and required time windows follow stop numbers rather than array positions', () => {
  const rec = reviewed(email('Drop-off').replace('19 Oct 2026', '19 Oct 2026 before 10:00'));
  approveRecord(rec);
  rec.stops.reverse();
  editQualityValue(rec, 'stop.1.timeWindow', '');
  const window = qualityGate(rec).entries.find(e => e.id === 'stop.1.timeWindow');
  assert.equal(window.required, true);
  assert.equal(window.status, 'missing');
  assertBlocked(rec, 'review:stop.1.timeWindow');
  editQualityValue(rec, 'stop.1.timeWindow', 'before 10:00');
  const place = qualityGate(rec).entries.find(e => e.id === 'stop.0.place');
  assert.match(place.source.text, /Drop-off 2: Bremen/);
  confirmValues(rec);
  assert.equal(approveRecord(rec).ok, true);
});
