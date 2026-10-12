import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES, analyze, asCSV, calcMissing, csvCell, extractFields, buildDraft, splitConversation, asPayload } from '../engine.js';

test('English freight RFQ: structured fields, category, urgency', () => {
  const r = analyze(SAMPLES.rfq);
  assert.equal(r.categoryId, 'rfq');
  assert.equal(r.priority, 'high');
  assert.equal(r.fields.origin, 'Vilnius, Lithuania');
  assert.equal(r.fields.destination, 'Hamburg, Germany');
  assert.equal(r.fields.loadingDate, '15 Oct 2026');
  assert.equal(r.fields.deliveryDate, '17 Oct 2026');
  assert.equal(r.fields.pallets, '22');
  assert.equal(r.fields.weightKg, '12500');
  assert.equal(r.fields.equipment.toLowerCase(), 'tautliner');
  assert.deepEqual(r.missing, []);
});
test('Incident: avoid invented ETA in draft', () => {
  const r = analyze(SAMPLES.issue);
  assert.equal(r.categoryId, 'issue');
  assert.equal(r.priority, 'high');
  assert.match(buildDraft(r), /check|investigate/i);
  assert.equal(r.fields.origin, 'Kaunas');
  assert.equal(r.fields.destination, 'Berlin');
});
test('Polish freight email date and weight', () => {
  const r = analyze(SAMPLES.pl);
  assert.equal(r.categoryId, 'rfq');
  assert.equal(r.language, 'pl');
  assert.equal(r.fields.loadingDate, '18.10.2026');
  assert.equal(r.fields.deliveryDate, '20.10.2026');
  assert.equal(r.fields.pallets, '10');
  assert.equal(r.fields.weightKg, '4800');
  assert.equal(r.fields.origin, 'Warszawy');
  assert.equal(r.fields.destination, 'Berlina');
});
test('Lithuanian example parses basic fields', () => {
  const r = analyze(SAMPLES.lt);
  assert.equal(r.language, 'lt');
  assert.equal(r.categoryId, 'rfq');
  assert.equal(r.fields.loadingDate, '2026-10-19');
  assert.equal(r.fields.deliveryDate, '2026-10-20');
  assert.equal(r.fields.weightKg, '1800');
  assert.equal(r.fields.pallets, '6');
});
test('Missing dates and quantities are not invented', () => {
  const fields = extractFields('Please quote shipment from Vilnius to Riga.');
  assert.equal(fields.weightKg, '');
  assert.equal(fields.loadingDate, '');
  assert.ok(calcMissing(fields,'rfq').includes('loadingDate'));
});
test('CSV escape stops spreadsheet formula injection', () => {
  assert.equal(csvCell('=HYPERLINK("malicious")'), '"\'=HYPERLINK(""malicious"")"');
  assert.ok(asCSV(analyze('=2+2. Quote from Vilnius to Riga.')).startsWith('\ufeff'));
});

test('Multistop stress case uses ONLY current message, not older quoted order', () => {
  const r = analyze(SAMPLES.stress);
  assert.equal(r.categoryId, 'rfq');
  assert.equal(r.priority, 'high');
  assert.equal(r.language, 'en');
  assert.equal(r.fields.origin, 'KAUNAS, Lithuania');
  assert.equal(r.fields.destination, 'Hamburg, Germany → Bremen, Germany');
  assert.equal(r.fields.loadingDate, '16 October 2026');
  assert.equal(r.fields.deliveryDate, '19 Oct / 20 Oct');
  assert.equal(r.fields.pallets, '18');
  assert.equal(r.fields.weightKg, '14200');
  assert.equal(r.fields.equipment.toLowerCase(), 'tautliner');
  assert.equal(r.stops.length, 2);
  assert.deepEqual(r.stops.map(s=>s.pallets), ['12','6']);
  assert.equal(r.adrStatus, 'unverified');
  assert.ok(r.warnings.some(w=>w.kind==='adr' && w.severity==='high'));
  assert.ok(r.warnings.some(w=>w.kind==='address'));
  assert.ok(r.warnings.some(w=>w.kind==='history'));
  assert.ok(r.warnings.some(w=>w.kind==='relative_deadline'));
  assert.ok(r.requirements.some(x=>x.includes('20 straps')));
  assert.equal(r.missing.length, 0);
});
test('JSON includes stop array, ADR, current-versus-quoted provenance and review', () => {
  const r = analyze(SAMPLES.stress);
  const p = asPayload(r);
  assert.equal(p.schema,'jurcasai.freight-intake.v0.2');
  assert.equal(p.human_review_required, true);
  assert.equal(p.freight.stops[1].place, 'Bremen, Germany');
  assert.equal(p.freight.adr_status, 'unverified');
  assert.match(p.active_message,/KAUNAS/);
  assert.doesNotMatch(p.active_message,/Previous email/);
});
test('Quoted historical pallet value cannot override the latest line', () => {
  const text = 'Hi,\nTotal: 14 pallets / 8800 kg\n\nPrevious email\nHello 99 pallets / 600 kg';
  assert.equal(extractFields(text).pallets, '14');
  assert.equal(extractFields(text).weightKg, '8800');
  assert.equal(splitConversation(text).removedQuotedHistory,true);
});
test('If total missing, aggregate correctly numbered delivery pallets',()=>{
  const text = 'Hi, quote pls.\n- Loading: Kaunas, Lithuania\n- Date: 17 October 2026\n- Delivery 1: Hamburg, Germany, 19 Oct — 12 EUR pallets\n- Delivery 2: Bremen, Germany, 20 Oct — 6 EUR pallets';
  assert.equal(extractFields(text).pallets,'18');
});
test('No fake ADR confirmation when cargo says probably non-ADR',()=>{
  const r = analyze('Hi, quote cargo: lithium battery modules, probably non-ADR, MSDS not yet available.');
  assert.equal(r.adrStatus,'unverified');
  assert.ok(r.warnings.some(w=>w.kind==='adr'));
  assert.match(buildDraft(r),/MSDS/);
});

test('CSV retains multi-stop details and unverified ADR', () => {
  const csv = asCSV(analyze(SAMPLES.stress));
  assert.match(csv,/delivery_stops_json/);
  assert.match(csv,/unverified/);
  assert.match(csv,/Bremen, Germany/);
});

test('Historical markdown Previous email is separated from current details', () => {
  const input='Hello,\n- Loading: KAUNAS, Lithuania (not Vilnius!)\n- Total: 18 EUR pallets / 14,200 kg\n\n---\n\n**Previous email — 12 Oct, 09:15**\n22 pallets, 12500 kg';
  const rec=analyze(input);
  assert.equal(rec.fields.pallets,'18');
  assert.equal(rec.fields.weightKg,'14200');
  assert.equal(rec.fields.origin,'KAUNAS, Lithuania');
});
