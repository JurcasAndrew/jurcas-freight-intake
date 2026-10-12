import { SAMPLES, CATEGORY, FIELD_LABELS, analyze, setCategory, calcMissing, buildDraft, asPayload, asCSV, qualityGate, editQualityValue, confirmQualityItem, approveRecord, invalidateSourceReview, addDeliveryStop, removeDeliveryStop } from './engine.js';

const $ = id => document.getElementById(id);
const modelId = 'Xenova/multilingual-e5-small';
const modelExamples = [
  ['rfq', 'Client requests a quotation for transporting 20 pallets by truck from Warsaw to Hamburg.'],
  ['rfq', 'Please give a freight price for pickup and delivery of cargo next Monday.'],
  ['rfq', 'Proszę o wycenę transportu palet, załadunek jutro, rozładunek Berlin.'],
  ['rfq', 'Sveiki, kiek kainuotų pervežti krovinį į Vokietiją?'],
  ['issue', 'Freight is late, delivery is delayed, truck broken, customer has a complaint.'],
  ['issue', 'Shipment damaged in transit and urgent incident investigation required.'],
  ['issue', 'Dostawa spóźniona, towar uszkodzony, reklamacja przewozu.'],
  ['issue', 'Krovinys vėluoja, klientas skundžiasi dėl pažeisto krovinio.'],
  ['status', 'Where is the truck and what is its current delivery ETA?'],
  ['status', 'Please send tracking and current shipment status update.'],
  ['status', 'Jaki jest status przesyłki i kiedy dojedzie kierowca?'],
  ['status', 'Kur dabar yra vilkikas ir kada planuojamas pristatymas?'],
  ['documents', 'Please send the signed CMR and proof of delivery.'],
  ['documents', 'We need invoice, POD, shipping papers and transport documents.'],
  ['documents', 'Poproszę dokumenty przewozowe i fakturę za usługę.'],
  ['documents', 'Prašau atsiųsti krovinio važtaraštį ir sąskaitą faktūrą.'],
  ['other', 'Thank you for the meeting. Let us catch up next week.'],
  ['other', 'This email is only about the weather and holiday greetings.'],
  ['other', 'Zapraszamy na spotkanie zespołu w piątek.'],
  ['other', 'Labas, linkėjimai ir iki susitikimo kitą savaitę.'],
];
let extractor = null, prototypeVectors = null, aiLoading = false, current = null, history = [], busy = false;
let toastTimeout = null;

let sourceDirty = false;
const reviewRows = new Map();
function refreshReview() {
  if (!current) return;
  const gate=qualityGate(current);
  $('review-status').textContent=gate.status;
  $('review-status').className='review-badge '+gate.status;
  $('review-summary').textContent=sourceDirty
    ? 'Zmieniono e-mail. Kliknij Analizuj wiadomosc, aby sprawdzic aktualna tresc.'
    : gate.ready_for_crm ? 'Dane zatwierdzone — gotowe do CRM. Nic nie zostalo wyslane.'
    : `${gate.entries.filter(x=>x.status==='confirmed').length} / ${gate.entries.length} pol potwierdzonych. Problemy blokujace: ${gate.issues.length}.`;
  $('review-summary').className='risk-line '+(gate.ready_for_crm&&!sourceDirty?'review-ok':'high');
  $('adr-warning').hidden=!gate.adr_review_required;
  $('adr-warning').textContent='ADR NIEPOTWIERDZONE. Zweryfikuj klasyfikacje z uprawniona osoba i dokumentacja MSDS/SDS. Wpisz wynik oraz podstawe ustalenia; samo wykrycie non-ADR w e-mailu nie wystarcza.';
  $('approve-data').disabled=sourceDirty || !gate.can_approve || gate.ready_for_crm;
  $('approve-data').textContent=gate.ready_for_crm?'Dane zatwierdzone':'Zatwierdz dane';
  $('add-stop').disabled=sourceDirty;
  for (const id of ['export-json','export-csv']) $(id).disabled=sourceDirty;
  for (const el of document.querySelectorAll('[data-field]')) {
    el.readOnly=!!current.stops.length && ['destination','deliveryDate'].includes(el.dataset.field);
    el.disabled=sourceDirty;
    el.title=el.readOnly?'Podsumowanie punktow. Edytuj osobne rozladunki w Quality Gate.':'';
  }
  $('review-issues').replaceChildren();
  $('issue-summary').textContent=`Problemy blokujace (${gate.issues.length})`;
  for (const issue of gate.issues) {
    const li=document.createElement('li'); li.textContent=issue.message; $('review-issues').append(li);
  }
  for (const item of gate.entries) {
    const row=reviewRows.get(item.id); if (!row) continue;
    row.badge.textContent=item.status; row.badge.className='review-badge '+item.status;
    if (document.activeElement!==row.input) row.input.value=item.value;
    row.input.disabled=sourceDirty || !!item.derived;
    row.button.disabled=sourceDirty || !item.value || item.status==='confirmed' || !!item.derived;
    row.button.textContent=item.status==='confirmed'?'Potwierdzone':'Potwierdz';
    row.button.hidden=!!item.derived;
    row.source.textContent=item.derived?'Wyliczone z osobnych rozladunkow — potwierdz kazdy punkt.'
      : item.source ? 'Zrodlo: '+item.source.text : 'Brak jednoznacznego cytatu dla tej wartosci. Wymagana reczna weryfikacja.';
    row.note.hidden=!item.source_conflict;
    row.note.disabled=sourceDirty;
    row.conflict.textContent=item.source_conflict ? 'Sprzeczne deklaracje: '+item.source_conflict.join(' / ')+'. Opisz wybor poprawnej wartosci.' : '';
  }
}
function afterReviewEdit() {
  renderFields(current.fields); renderMissing(); renderQuality(); refreshReview(); renderHistory();
  $('draft').value=buildDraft(current);
}
function renderReview() {
  const area=$('review-groups'); area.replaceChildren(); reviewRows.clear();
  const groups=new Map();
  for (const item of qualityGate(current).entries) {
    if (!groups.has(item.group)) {
      const group=document.createElement('details'); group.className='review-group'; group.open=true;
      const summary=document.createElement('summary'); summary.textContent=item.group;
      group.append(summary); area.append(group); groups.set(item.group,group);
    }
    const row=document.createElement('div'); row.className='review-row';
    const label=document.createElement('label'); label.htmlFor='review-input-'+item.id;
    label.textContent=item.label+(item.required?'':' (opcjonalne)');
    const badge=document.createElement('span');
    const heading=document.createElement('div'); heading.className='review-row-heading'; heading.append(label,badge);
    const input=document.createElement(item.choices?'select':'input'); input.id='review-input-'+item.id;
    if (item.choices) {
      const option=document.createElement('option'); option.value=''; option.textContent='Wybierz po weryfikacji'; input.append(option);
      for (const [value,text] of item.choices) { const option=document.createElement('option'); option.value=value; option.textContent=text; input.append(option); }
    } else { input.type='text'; input.placeholder=item.id==='deadline'?'2026-10-13T10:00+03:00':'Uzupelnij dane'; }
    input.value=item.value;
    input.addEventListener(item.choices?'change':'input',()=>{
      if(sourceDirty)return;
      try { editQualityValue(current,item.id,input.value); afterReviewEdit(); } catch(err) {toast(err.message);}
    });
    const source=document.createElement('p'); source.className='source-snippet';
    const conflict=document.createElement('p'); conflict.className='review-conflict';
    const note=document.createElement('input'); note.type='text'; note.placeholder='Dlaczego ta wartosc jest poprawna?';
    note.setAttribute('aria-label','Rozstrzygniecie: '+item.label);
    const button=document.createElement('button'); button.type='button'; button.className='button secondary confirm-field';
    button.setAttribute('aria-label','Potwierdz: '+item.group+' — '+item.label);
    button.addEventListener('click',()=>{
      if(sourceDirty)return;
      try {confirmQualityItem(current,item.id,note.value);afterReviewEdit();} catch(err){toast(err.message);}
    });
    row.append(heading,input,source,conflict,note,button);
    groups.get(item.group).append(row);
    reviewRows.set(item.id,{input,badge,source,note,button,conflict});
  }
  current.stops.forEach((stop,index)=>{
    const button=document.createElement('button');button.className='button ghost';button.type='button';
    button.textContent='Usun punkt '+(index+1);
    button.addEventListener('click',()=>{if(!sourceDirty){removeDeliveryStop(current,index);render();}});
    groups.get('Rozladunek '+(index+1)).append(button);
  });
  refreshReview();
}


function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').classList.remove('show'), 3100);
}
function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function setAiStatus(message, level = '') {
  $('ai-status').textContent = message;
  $('ai-light').className = `status-light ${level}`;
  $('metric-ai').textContent = level === 'ready' ? 'ON' : level === 'error' ? 'ERROR' : 'OFF';
  $('metric-ai').style.color = level === 'ready' ? '#80eabf' : '#ffb96a';
  $('metric-ai-sub').textContent = level === 'ready' ? 'embeddingi w przegladarce' : level === 'error' ? 'tryb regul dostepny' : 'tryb regul aktywny';
}
function renderFields(fields) {
  Object.entries(fields).forEach(([key, value]) => {
    const el = $(`field-${key}`);
    if (el && document.activeElement !== el) el.value = value || '';
  });
}
function renderMissing() {
  if (!current) return;
  const values = Object.values(current.fields).filter(v => String(v).trim()).length;
  $('filled-count').textContent = `${values} / 7 POL`;
  $('missing-number').textContent = String(current.missing.length);
  const area = $('missing-chips'); area.replaceChildren();
  if (current.categoryId !== 'rfq') {
    const chip = document.createElement('span'); chip.className = 'chip';
    chip.textContent = 'Kontrola brakow dotyczy obecnie RFQ'; area.appendChild(chip);
  } else if (!current.missing.length) {
    const chip = document.createElement('span'); chip.className = 'chip ok';
    chip.textContent = 'Wszystkie 7 pol wypelnione — zweryfikuj je recznie'; area.appendChild(chip);
  } else current.missing.forEach(key => {
    const chip = document.createElement('span'); chip.className = 'chip';
    chip.textContent = FIELD_LABELS[key]; area.appendChild(chip);
  });
}
function renderQuality() {
  if (!current) return;
  const stops = $('stop-list'); stops.replaceChildren();
  const warnings = $('risk-list'); warnings.replaceChildren();
  const stopsData = current.stops || [];
  $('stop-count').textContent = `${stopsData.length} przystanki`;
  if (!stopsData.length) {
    const item = document.createElement('p'); item.className = 'empty-hint';
    item.textContent = 'Brak rozpisanych punktow dostawy (dla prostych zlecen zwykle wystarczy jedno pole docelowe).';
    stops.appendChild(item);
  }
  for (const stop of stopsData) {
    const div = document.createElement('div'); div.className = 'stop-line';
    const title = document.createElement('strong'); title.textContent = `${stop.order}. ${stop.place}`;
    const details = document.createElement('span');
    details.textContent = [stop.date,stop.timeWindow, stop.pallets ? `${stop.pallets} palet` : ''].filter(Boolean).join(' · ');
    div.append(title,details); stops.appendChild(div);
  }
  $('cargo-type').textContent = current.cargo || 'Nie okreslono';
  $('adr-state').textContent = ({unverified:'NIEPOTWIERDZONY',declared_adr:'Zadeklarowano ADR',declared_non_adr:'Zadeklarowano non-ADR',not_specified:'Nie podano'})[current.adrStatus] || 'Nie podano';
  $('requirements').textContent = current.requirements?.length ? current.requirements.join(' · ') : 'Brak wychwyconych wymagan';
  const items = current.warnings || [];
  $('risk-count').textContent = String(items.length);
  if (!items.length) {
    const p = document.createElement('p'); p.className = 'empty-hint';
    p.textContent = 'Nie wykryto dodatkowych ostrzezen. Nadal sprawdz dane ze zrodlem.';
    warnings.appendChild(p);
  }
  for (const item of items) {
    const div = document.createElement('div'); div.className = `risk-line ${item.severity}`;
    div.textContent = item.text; warnings.appendChild(div);
  }
}
function renderHistory() {
  $('metric-total').textContent = String(history.length);
  $('metric-missing').textContent = String(history.filter(r => !qualityGate(r).ready_for_crm).length);
  const tbody = $('history-body'); tbody.replaceChildren();
  if (!history.length) {
    const tr = document.createElement('tr'); const cell = document.createElement('td');
    cell.colSpan = 5; cell.className = 'empty'; cell.textContent = 'Jeszcze brak analiz';
    tr.appendChild(cell); tbody.appendChild(tr); return;
  }
  for (const rec of history.slice(0, 12)) {
    const tr = document.createElement('tr');
    const time = new Date(rec.timestamp).toLocaleTimeString('pl-PL', {hour:'2-digit',minute:'2-digit'});
    const routeText = [rec.fields.origin,rec.fields.destination].filter(Boolean).join(' → ') || '—';
    for (const [i, value] of [time,CATEGORY[rec.categoryId],routeText,rec.priority === 'high' ? 'PILNY' : rec.priority === 'mid' ? 'NORMALNY' : 'NISKI',rec.categoryId === 'rfq' ? String(rec.missing.length) : 'n/d'].entries()) {
      const td = document.createElement('td'); td.textContent = value;
      if (i === 1 || i === 3) { td.className = 'history-tag-cell'; const tag = document.createElement('span'); tag.className = i === 3 ? `tag ${rec.priority}` : 'tag'; tag.textContent = value; td.replaceChildren(tag); }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}
function render() {
  if (!current) return;
  $('category').textContent = CATEGORY[current.categoryId];
  $('reason').textContent = current.reason;
  $('method').textContent = current.categoryMethod === 'ai' ? 'HUGGING FACE AI' : current.categoryMethod === 'manual' ? 'RECZNIE' : 'REGULY';
  $('priority').textContent = current.priority === 'high' ? '● PILNE' : current.priority === 'mid' ? '● NORMALNE' : '● NISKIE';
  $('priority').className = `priority ${current.priority}`;
  $('semantic-info').textContent = current.categoryMethod === 'ai'
    ? `Model ${modelId} wybral najblizsza kategorie. Podobienstwo kosinusowe: ${current.semanticScore?.toFixed(3) ?? '?'} (to NIE jest procent pewnosci). Potwierdz wynik.`
    : 'Wynik z regul jezykowych. Wlacz model Hugging Face, aby porownac znaczenie wiadomosci z przykladami klas.';
  renderFields(current.fields); renderMissing(); renderQuality(); renderReview();
  $('draft').value = buildDraft(current); renderHistory();
}
function cosine(a,b) {
  let sum = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { sum += a[i]*b[i]; aa += a[i]*a[i]; bb += b[i]*b[i]; }
  return sum / Math.sqrt((aa || 1)*(bb || 1));
}
async function semanticClassification(rec) {
  if (!extractor || !prototypeVectors) return;
  const query = await extractor('query: ' + (rec.activeText || rec.sourceText).slice(0, 1600), {pooling:'mean',normalize:true});
  const queryVector = query.tolist()[0];
  const scores = {};
  modelExamples.forEach(([category], i) => {
    const score = cosine(queryVector, prototypeVectors[i]);
    scores[category] = Math.max(scores[category] ?? -1, score);
  });
  const sorted = Object.entries(scores).sort((a,b) => b[1] - a[1]);
  if (current?.id !== rec.id) return;
  const [winner, score] = sorted[0];
  const margin = score - sorted[1][1];
  if (margin < 0.012) {
    current.reason = `Model AI niejednoznaczny (roznica podobienstwa ${margin.toFixed(3)}). Pozostawiono wynik regul do recznej weryfikacji.`;
    render();
  } else {
    setCategory(current, winner, 'ai', `Dopasowanie semantyczne przez ${modelId}. Sprawdz wynik przed uzyciem.`, score);
    render();
  }
}
async function analyzeCurrent() {
  if (busy) return;
  try {
    busy = true; $('analyze').disabled = true;
    const rec = analyze($('message').value);
    sourceDirty = false; current = rec; history.unshift(rec); if (history.length > 30) history.pop(); render();
    if (extractor) {
      $('semantic-info').textContent = 'Trwa klasyfikacja semantyczna...';
      try { await semanticClassification(rec); } catch (err) { toast('Blad modelu AI. Wynik regul pozostaje dostepny.'); console.warn(err); }
    }
  } catch (err) { toast(err.message || 'Nie udalo sie przeanalizowac wiadomosci'); }
  finally { busy = false; $('analyze').disabled = false; }
}
async function loadAI() {
  if (extractor || aiLoading) return;
  aiLoading = true; $('load-ai').disabled = true; $('load-ai').textContent = 'Pobieranie...';
  setAiStatus('Ladowanie biblioteki i wag modelu. Pierwszy start moze potrwac (wymagane polaczenie internetowe).');
  try {
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6');
    extractor = await pipeline('feature-extraction', modelId, {dtype:'q8'});
    setAiStatus('Model pobrany. Przygotowuje przyklady klas...', '');
    const examples = modelExamples.map(([, t]) => 'query: ' + t);
    const embeddings = await extractor(examples, {pooling:'mean',normalize:true});
    prototypeVectors = embeddings.tolist();
    $('load-ai').textContent = '✓ Model gotowy';
    setAiStatus('Model gotowy. Klasyfikacja semantyczna dziala lokalnie w przegladarce.', 'ready');
    if (current) { try { await semanticClassification(current); } catch (e) { console.warn(e); toast('Nie udalo sie porownac ostatniej wiadomosci.'); } }
  } catch (e) {
    console.warn('Hugging Face model loading failed',e);
    extractor = null; prototypeVectors = null;
    $('load-ai').disabled = false; $('load-ai').textContent = '↻ Sprobuj ponownie';
    setAiStatus('Nie mozna zaladowac modelu (siec/pamiec/ograniczenia przegladarki). Tryb regul nadal dziala.', 'error');
    toast('Model HF niedostepny — wciaz mozesz uzyc analizy regulowej.');
  } finally { aiLoading = false; }
}
async function copyText(text) {
  if (!text) { toast('Brak tekstu do skopiowania'); return; }
  try { await navigator.clipboard.writeText(text); toast('Skopiowano do schowka'); }
  catch { toast('Schowek niedostepny — zaznacz i skopiuj tekst recznie.'); }
}
function chooseSample(name) {
  $('message').value = SAMPLES[name];
  document.querySelectorAll('.sample').forEach(el => el.classList.toggle('active',el.dataset.sample === name));
  $('char-count').textContent = `${$('message').value.length} znakow`;
  analyzeCurrent();
}
for (const b of document.querySelectorAll('[data-sample]')) b.addEventListener('click', () => chooseSample(b.dataset.sample));
$('message').addEventListener('input', () => {
  $('char-count').textContent = `${$('message').value.length} znakow`;
  document.querySelectorAll('.sample').forEach(b => b.classList.remove('active'));
  if (current) { sourceDirty = $('message').value.trim() !== current.sourceText; invalidateSourceReview(current); refreshReview(); }
});
$('analyze').addEventListener('click', analyzeCurrent);
$('load-ai').addEventListener('click', loadAI);
for (const el of document.querySelectorAll('[data-field]')) el.addEventListener('input', () => {
  if (!current || sourceDirty) return;
  try { editQualityValue(current,'field.'+el.dataset.field,el.value); afterReviewEdit(); } catch(err){toast(err.message);}
});
$('copy-draft').addEventListener('click', () => copyText($('draft').value));
$('export-json').addEventListener('click', () => {
  if (!current) return toast('Najpierw przeanalizuj wiadomosc');
  download('freight-intake.json',JSON.stringify(asPayload(current), null, 2),'application/json;charset=utf-8');
  toast(qualityGate(current).ready_for_crm ? 'JSON: dane zatwierdzone, bez wysylki do CRM.' : 'JSON: wersja robocza z problemami do weryfikacji.');
});
$('export-csv').addEventListener('click', () => {
  if (!current) return toast('Najpierw przeanalizuj wiadomosc');
  download('freight-intake.csv',asCSV(current),'text/csv;charset=utf-8');
  toast(qualityGate(current).ready_for_crm ? 'CSV: dane zatwierdzone, bez wysylki do CRM.' : 'CSV: wersja robocza z problemami do weryfikacji.');
});
$('clear-history').addEventListener('click', () => {
  history = []; renderHistory(); toast('Historia tej sesji wyczyszczona');
});
$('approve-data').addEventListener('click',()=>{
  if (!current || sourceDirty) return;
  const result=approveRecord(current); refreshReview(); renderHistory();
  toast(result.ok?'Dane zatwierdzone. Nic nie zostalo wyslane do CRM.':'Najpierw usun problemy i potwierdz pola.');
});
$('add-stop').addEventListener('click',()=>{if(current&&!sourceDirty){addDeliveryStop(current);render();}});
chooseSample('rfq');
