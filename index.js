import { SAMPLES, CATEGORY, FIELD_LABELS, analyze, setCategory, calcMissing, buildDraft, asPayload, asCSV } from './engine.js';

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
    if (el) el.value = value || '';
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
  $('metric-missing').textContent = String(history.filter(r => r.missing.length > 0 || r.warnings?.some(w=>w.severity !== 'info')).length);
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
  $('method').textContent = current.categoryMethod === 'ai' ? 'HUGGING FACE AI' : 'REGULY';
  $('priority').textContent = current.priority === 'high' ? '● PILNE' : current.priority === 'mid' ? '● NORMALNE' : '● NISKIE';
  $('priority').className = `priority ${current.priority}`;
  $('semantic-info').textContent = current.categoryMethod === 'ai'
    ? `Model ${modelId} wybral najblizsza kategorie. Podobienstwo kosinusowe: ${current.semanticScore?.toFixed(3) ?? '?'} (to NIE jest procent pewnosci). Potwierdz wynik.`
    : 'Wynik z regul jezykowych. Wlacz model Hugging Face, aby porownac znaczenie wiadomosci z przykladami klas.';
  renderFields(current.fields); renderMissing(); renderQuality();
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
    current = rec; history.unshift(rec); if (history.length > 30) history.pop(); render();
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
});
$('analyze').addEventListener('click', analyzeCurrent);
$('load-ai').addEventListener('click', loadAI);
for (const el of document.querySelectorAll('[data-field]')) el.addEventListener('change', () => {
  if (!current) return;
  current.fields[el.dataset.field] = el.value.trim();
  current.missing = calcMissing(current.fields, current.categoryId);
  current.reviewed = false;
  renderMissing(); $('draft').value = buildDraft(current); renderHistory();
});
$('copy-draft').addEventListener('click', () => copyText($('draft').value));
$('export-json').addEventListener('click', () => {
  if (!current) return toast('Najpierw przeanalizuj wiadomosc');
  download('freight-intake.json',JSON.stringify(asPayload(current), null, 2),'application/json;charset=utf-8');
  toast('Eksport JSON gotowy. Wymagana reczna weryfikacja.');
});
$('export-csv').addEventListener('click', () => {
  if (!current) return toast('Najpierw przeanalizuj wiadomosc');
  download('freight-intake.csv',asCSV(current),'text/csv;charset=utf-8');
  toast('Eksport CSV gotowy. Wymagana reczna weryfikacja.');
});
$('clear-history').addEventListener('click', () => {
  history = []; renderHistory(); toast('Historia tej sesji wyczyszczona');
});
chooseSample('rfq');
