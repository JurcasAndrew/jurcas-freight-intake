import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES, analyze, asPayload, asCSV, qualityGate, editQualityValue, confirmQualityItem, approveRecord, setCategory, addDeliveryStop, removeDeliveryStop } from '../engine.js';

const item = (rec,id) => qualityGate(rec).entries.find(x=>x.id===id);
function reviewDetails(rec) {
  editQualityValue(rec,'address.loading','TEST: Loading Street 1, Kaunas, LT');
  if(rec.stops.length) rec.stops.forEach((_,i)=>editQualityValue(rec,'address.stop.'+i,'TEST: Delivery Street '+(i+1)+', Germany'));
  else editQualityValue(rec,'address.destination','TEST: Delivery Street 2, Hamburg, DE');
  // Synthetic test fixture; this is not an ADR classification of real cargo.
  editQualityValue(rec,'adr.decision','adr');
  editQualityValue(rec,'adr.reference','TEST ONLY: classification supplied by a fictional qualified reviewer');
  if(rec.warnings.some(w=>w.kind==='relative_deadline')) editQualityValue(rec,'deadline','2026-10-13T10:00+03:00');
}
function confirmAll(rec) {
  for(const entry of qualityGate(rec).entries)
    if(!entry.derived && entry.value) confirmQualityItem(rec,entry.id);
}
function complete(rec=analyze(SAMPLES.rfq)) { reviewDetails(rec);confirmAll(rec);return rec; }
function completeStress() {
  const rec=analyze(SAMPLES.stress);
  editQualityValue(rec,'stop.0.date','2026-10-19');
  editQualityValue(rec,'stop.1.date','2026-10-20');
  return complete(rec);
}

test('Quality Gate never treats extracted values as human confirmation',()=>{
  const rec=analyze(SAMPLES.rfq);
  assert.equal(item(rec,'field.origin').status,'extracted');
  assert.equal(qualityGate(rec).entries.some(e=>e.status==='confirmed'),false);
  assert.equal(approveRecord(rec).ok,false);
  assert.equal(asPayload(rec).ready_for_crm,false);
});

test('Provenance is an exact current-message span, never the quoted old order',()=>{
  const rec=analyze(SAMPLES.stress);
  for(const entry of qualityGate(rec).entries.filter(e=>e.source)) {
    assert.equal(rec.activeText.slice(entry.source.start,entry.source.end),entry.source.text);
    assert.doesNotMatch(entry.source.text,/Previous email|ADR: NO|22 pallets/);
  }
  assert.match(item(rec,'field.origin').source.text,/KAUNAS/);
  assert.match(item(rec,'field.weightKg').source.text,/14,200 kg/);
  assert.match(item(rec,'stop.1.pallets').source.text,/6 EUR pallets/);
  assert.equal(item(rec,'field.destination').source,null);
});

test('A manual correction or ambiguous repeated source gets no invented quotation',()=>{
  const rec=analyze(SAMPLES.rfq);
  editQualityValue(rec,'field.origin','TEST: corrected city');
  assert.equal(item(rec,'field.origin').source,null);
  assert.equal(item(rec,'field.origin').status,'requires_review');
  const repeated=analyze('Please quote.\nTotal: 18 pallets\nTotal: 18 pallets');
  assert.equal(item(repeated,'field.pallets').source,null);
});

test('Missing data and the old reviewed boolean cannot bypass the gate',()=>{
  const rec=analyze('Please quote from Vilnius to Riga.');
  rec.reviewed=true;
  assert.equal(item(rec,'field.weightKg').status,'missing');
  assert.throws(()=>confirmQualityItem(rec,'field.weightKg'),/Uzupelnij/);
  assert.equal(approveRecord(rec).ok,false);
  assert.equal(asPayload(rec).human_review_required,true);
});

test('Every required item must be manually confirmed before explicit record approval',()=>{
  const rec=complete();
  assert.equal(qualityGate(rec).can_approve,true);
  assert.equal(qualityGate(rec).ready_for_crm,false);
  assert.equal(approveRecord(rec).ok,true);
  const payload=asPayload(rec);
  assert.equal(payload.app_version,'0.3.0');
  assert.equal(payload.verification.status,'confirmed');
  assert.equal(payload.ready_for_crm,true);
  assert.equal(payload.human_review_required,false);
  assert.deepEqual(payload.verification.issues,[]);
  assert.ok(payload.verification.approved_at);
  assert.equal(payload.bitrix_field_mapping,'NOT_CONFIGURED');
  assert.match(asCSV(rec),/ready_for_crm/);
});

test('Probably non-ADR cannot become approved without a decision and review basis',()=>{
  const rec=analyze(SAMPLES.stress);
  assert.equal(qualityGate(rec).adr_review_required,true);
  assert.equal(item(rec,'adr.decision').value,'');
  assert.equal(approveRecord(rec).ok,false);
  editQualityValue(rec,'adr.decision','non_adr');
  confirmQualityItem(rec,'adr.decision');
  assert.equal(qualityGate(rec).adr_review_required,true);
  assert.throws(()=>confirmQualityItem(rec,'adr.reference'),/Uzupelnij/);
  assert.equal(asPayload(rec).freight.verified_adr_classification,null);
});

test('Two unloading points require separate confirmation; summary cannot bypass them',()=>{
  const rec=completeStress();
  editQualityValue(rec,'stop.1.place','Bremen, Germany');
  assert.equal(item(rec,'stop.0.place').status,'confirmed');
  assert.notEqual(item(rec,'stop.1.place').status,'confirmed');
  assert.equal(approveRecord(rec).ok,false);
  assert.throws(()=>editQualityValue(rec,'field.destination','Override'),/osobne/);
  assert.throws(()=>confirmQualityItem(rec,'field.destination'),/osobne/);
  confirmQualityItem(rec,'stop.1.place');
  assert.equal(approveRecord(rec).ok,true);
});

test('A missing date in one stop blocks approval even if aggregate deliveryDate is populated',()=>{
  const rec=analyze(SAMPLES.stress);
  editQualityValue(rec,'stop.1.date','');
  assert.ok(rec.fields.deliveryDate);
  assert.equal(item(rec,'stop.1.date').status,'missing');
  assert.equal(approveRecord(rec).ok,false);
});

test('Pallet arithmetic conflicts cannot be dismissed with a confirmation note',()=>{
  const rec=completeStress();
  editQualityValue(rec,'field.pallets','19');
  assert.equal(item(rec,'field.pallets').status,'conflict');
  assert.ok(qualityGate(rec).issues.some(i=>i.code==='pallet_total'));
  assert.throws(()=>confirmQualityItem(rec,'field.pallets','I accept'),/Suma/);
  assert.equal(approveRecord(rec).ok,false);
  editQualityValue(rec,'field.pallets','18');
  confirmQualityItem(rec,'field.pallets');
  assert.equal(approveRecord(rec).ok,true);
});

test('Conflicting source declarations require an explicit documented human resolution',()=>{
  const rec=analyze(SAMPLES.stress.replace('- Total: 18 EUR pallets / 14,200 kg','- Total: 18 EUR pallets / 14,200 kg\n- Total: 20 EUR pallets / 14,200 kg'));
  assert.equal(item(rec,'field.pallets').status,'conflict');
  assert.throws(()=>confirmQualityItem(rec,'field.pallets'),/rozstrzygniecie/);
  confirmQualityItem(rec,'field.pallets','TEST: reviewer confirmed 12 + 6, the second total is stale.');
  assert.equal(item(rec,'field.pallets').status,'confirmed');
  assert.match(item(rec,'field.pallets').note,/12 \+ 6/);
});

test('Duplicate stop order and reversed dates are blocking conflicts',()=>{
  const rec=completeStress();
  editQualityValue(rec,'stop.1.order','1');
  assert.ok(qualityGate(rec).issues.some(i=>i.code==='stop_order'));
  assert.throws(()=>confirmQualityItem(rec,'stop.1.order'),/Kolejnosc/);
  editQualityValue(rec,'stop.1.order','2');
  editQualityValue(rec,'stop.1.date','2026-10-15');
  assert.ok(qualityGate(rec).issues.some(i=>i.code.startsWith('date_order:')));
  assert.equal(approveRecord(rec).ok,false);
});

test('Dates without a year and impossible calendar dates require correction',()=>{
  const rec=analyze(SAMPLES.stress);
  assert.equal(item(rec,'stop.0.date').status,'requires_review');
  assert.throws(()=>confirmQualityItem(rec,'stop.0.date'),/date z rokiem/);
  editQualityValue(rec,'stop.0.date','2026-02-30');
  assert.throws(()=>confirmQualityItem(rec,'stop.0.date'),/date z rokiem/);
  editQualityValue(rec,'stop.0.date','2026-10-19');
  confirmQualityItem(rec,'stop.0.date');
  assert.equal(item(rec,'stop.0.date').status,'confirmed');
});

test('Nonpositive or invalid quantities block confirmation',()=>{
  for(const [id,value] of [['field.pallets','0'],['field.pallets','1.5'],['field.weightKg','-1'],['field.weightKg','NaN']]) {
    const rec=complete();editQualityValue(rec,id,value);
    assert.equal(item(rec,id).status,'conflict');
    assert.throws(()=>confirmQualityItem(rec,id));
    assert.equal(approveRecord(rec).ok,false);
  }
});

test('Editing a confirmed value invalidates approval and its confirmation',()=>{
  const rec=complete();assert.equal(approveRecord(rec).ok,true);
  editQualityValue(rec,'field.weightKg','13000');
  assert.equal(asPayload(rec).ready_for_crm,false);
  assert.notEqual(item(rec,'field.weightKg').status,'confirmed');
  assert.equal(item(rec,'field.equipment').status,'confirmed');
  confirmQualityItem(rec,'field.weightKg');
  assert.equal(qualityGate(rec).ready_for_crm,false);
  assert.equal(approveRecord(rec).ok,true);
});

test('Export recalculates readiness after mutations instead of trusting a cached flag',()=>{
  const rec=complete();approveRecord(rec);
  rec.fields.weightKg='';
  assert.equal(asPayload(rec).ready_for_crm,false);
  assert.ok(asPayload(rec).verification.issues.some(i=>i.fields.includes('field.weightKg')));
  assert.equal(asPayload(rec).human_review_required,true);
});

test('Changes to route, ADR evidence, category or source invalidate related confirmations',()=>{
  const rec=complete();approveRecord(rec);
  editQualityValue(rec,'field.origin','Riga');
  assert.notEqual(item(rec,'address.loading').status,'confirmed');
  editQualityValue(rec,'adr.reference','TEST: revised decision reference');
  assert.notEqual(item(rec,'adr.decision').status,'confirmed');
  setCategory(rec,'documents','manual','Test');
  assert.equal(approveRecord(rec).ok,false);
  const fresh=complete();approveRecord(fresh);
  fresh.sourceText+='\nNew message changes the order.';
  assert.equal(asPayload(fresh).ready_for_crm,false);
  assert.equal(qualityGate(fresh).can_approve,false);
});

test('Unparsed declared stop cannot silently disappear; add/remove maintains the gate',()=>{
  const rec=analyze(SAMPLES.stress.replace('- Delivery 2: Bremen, Germany, 20 Oct 08:00–12:00 — 6 EUR pallets','- Delivery 2:'));
  assert.ok(qualityGate(rec).issues.some(i=>i.code==='stop_count'));
  addDeliveryStop(rec);
  assert.equal(item(rec,'stop.1.place').status,'missing');
  assert.equal(approveRecord(rec).ok,false);
  removeDeliveryStop(rec,1);
  assert.ok(qualityGate(rec).issues.some(i=>i.code==='stop_count'));
});

test('Relative quotation deadline needs an explicit date, time and timezone',()=>{
  const rec=completeStress();
  editQualityValue(rec,'deadline','tomorrow 10:00');
  assert.throws(()=>confirmQualityItem(rec,'deadline'),/ISO/);
  editQualityValue(rec,'deadline','2026-10-13T10:00');
  assert.throws(()=>confirmQualityItem(rec,'deadline'),/ISO/);
  editQualityValue(rec,'deadline','2026-10-13T10:00+03:00');
  confirmQualityItem(rec,'deadline');
  assert.equal(approveRecord(rec).ok,true);
});

test('Full stress review exports independent stop decisions and resolved ADR evidence',()=>{
  const rec=completeStress();
  assert.equal(approveRecord(rec).ok,true);
  const payload=asPayload(rec);
  assert.equal(payload.freight.verified_adr_classification,'adr');
  assert.equal(payload.freight.adr_status,'unverified');
  assert.equal(payload.verification.entries.find(x=>x.id==='stop.1.place').status,'confirmed');
  assert.match(payload.freight.review_details['adr.reference'],/TEST ONLY/);
  assert.ok(payload.warnings.some(w=>w.kind==='adr'));
  assert.equal(payload.ready_for_crm,true);
});

test('Cargo and operational requirements also need review; changing cargo invalidates ADR',()=>{
  const rec=completeStress();approveRecord(rec);
  assert.equal(item(rec,'cargo').status,'confirmed');
  assert.equal(item(rec,'requirements').status,'confirmed');
  editQualityValue(rec,'cargo','Changed cargo');
  assert.notEqual(item(rec,'adr.decision').status,'confirmed');
  assert.equal(approveRecord(rec).ok,false);
  editQualityValue(rec,'requirements','');
  assert.equal(item(rec,'requirements').status,'missing');
});

test('New unresolved operational warnings cannot silently bypass approval',()=>{
  const rec=complete();
  rec.warnings.push({kind:'customs',severity:'high',text:'Unresolved customs restriction'});
  assert.equal(approveRecord(rec).ok,false);
  assert.ok(qualityGate(rec).issues.some(x=>x.code==='unresolved_warning:customs'));
});

test('A message consisting only of quoted history is not current-source evidence',()=>{
  const rec=analyze('Previous email\nPlease quote from Vilnius to Hamburg. 22 pallets. ADR: NO.');
  assert.equal(rec.activeText,'');
  assert.equal(asPayload(rec).active_message,'');
  assert.equal(rec.fields.pallets,'');
  assert.equal(qualityGate(rec).entries.some(x=>x.source),false);
  assert.equal(approveRecord(rec).ok,false);
});

test('A date conflict propagates into the derived delivery-date summary',()=>{
  const rec=completeStress();
  editQualityValue(rec,'field.loadingDate','2026-10-25');
  assert.equal(item(rec,'field.deliveryDate').status,'conflict');
  assert.equal(approveRecord(rec).ok,false);
});

test('Extracted time windows cannot be erased to bypass review; invalid month names are rejected',()=>{
  const rec=completeStress();
  editQualityValue(rec,'stop.0.timeWindow','');
  assert.equal(item(rec,'stop.0.timeWindow').status,'missing');
  assert.equal(approveRecord(rec).ok,false);
  editQualityValue(rec,'stop.0.date','19 Octopus 2026');
  assert.throws(()=>confirmQualityItem(rec,'stop.0.date'),/date z rokiem/);
  editQualityValue(rec,'stop.0.date','19-10-2026');
  confirmQualityItem(rec,'stop.0.date');
  assert.equal(item(rec,'stop.0.date').status,'confirmed');
});
