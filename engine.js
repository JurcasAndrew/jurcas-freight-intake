// Freight Intake MVP: deterministic field extraction and fallback classification.
// No user text leaves the browser in these functions.
export const SAMPLES = {
  stress: `Hi,

FINAL UPDATE!!! Please check carefully, client changed everything again.

We need ONE truck, but TWO delivery points.

CURRENT DETAILS:
- Loading: KAUNAS, Lithuania (not Vilnius!)
- Date: Friday 16 October 2026, 08:00–11:30
- Delivery 1: Hamburg, Germany, 19 Oct before 10:00 — 12 EUR pallets
- Delivery 2: Bremen, Germany, 20 Oct 08:00–12:00 — 6 EUR pallets
- Total: 18 EUR pallets / 14,200 kg
- Non-stackable, side loading required
- Trailer: tautliner, 20 straps required

Cargo: lithium battery modules. Customer says probably non-ADR, but MSDS is not yet available. Please verify classification!

PL: Dokladne adresy zaladunku i rozladunku bedziemy mieli jutro. Palety nie sa wymienne.

LT: Vairuotojas turi tureti apsaugine avalyne. Prasome atsiusti kaina iki rytojaus 10 val.

Can you quote an all-in price including both unloading points? We need an answer ASAP.

---
Previous email — 12 Oct, 09:15

Hello,
Please quote Vilnius → Hamburg. Loading: 15 Oct. Delivery: 17 Oct. 22 pallets, 12,500 kg. ADR: NO.
`,
  rfq: `Hello,\n\nPlease quote transport from Vilnius, Lithuania to Hamburg, Germany. Loading 15 Oct 2026, delivery 17 Oct 2026. 22 pallets, 12,500 kg. Tautliner required. Please send your rate ASAP.\n\nThank you!`,
  issue: `Hi team,\n\nOur shipment from Kaunas to Berlin is delayed. The truck was due this morning but has not arrived. Customer is angry and needs an urgent ETA update. Please investigate ASAP.`,
  pl: `Dzien dobry,\n\nProsze o wycene transportu z Warszawy do Berlina. Zaladunek 18.10.2026, rozladunek 20.10.2026. Towar: 10 palet, 4 800 kg. Potrzebna plandeka. Prosimy o oferte.`,
  lt: `Sveiki,\n\nPrasau transporto kainos is Vilniaus i Ryga. Pakrovimas 2026-10-19, pristatymas 2026-10-20. Krovinys: 6 paletes, 1800 kg. Reikia tentines puspriekabes. Aciu!`,
};
export const CATEGORY = Object.freeze({
  rfq: 'Nowe zapytanie / RFQ',
  issue: 'Problem / opoznienie',
  status: 'Zapytanie o status',
  documents: 'Dokumenty / POD',
  other: 'Inna wiadomosc',
});
export const FIELD_LABELS = Object.freeze({
  origin: 'Miejsce zaladunku',
  destination: 'Miejsce dostawy',
  loadingDate: 'Data zaladunku',
  deliveryDate: 'Data dostawy',
  pallets: 'Liczba palet',
  weightKg: 'Waga ladunku',
  equipment: 'Typ pojazdu',
});

function folded(s) { return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

// Quoted threads are a major source of wrong freight data. A safe parser only uses
// the newest identifiable message; quoted history remains in original_message.
export function splitConversation(text) {
  const content = String(text || '');
  const markers = [
    /^\s*[*_#\s]*(?:previous email|previous message|earlier email|original message|forwarded message|poprzednia wiadomosc|poprzednia wiadomość|ankstesnis laiškas)\b/imu,
    /^\s*-{2,}\s*(?:original message|forwarded message)\s*-*\s*$/imu,
    /^\s*On\s+.+\s+wrote:\s*$/imu,
  ];
  const matchPositions = markers.map(re => re.exec(content)?.index).filter(x => Number.isInteger(x));
  const first = matchPositions.length ? Math.min(...matchPositions) : content.length;
  const current = content.slice(0, first).replace(/(?:\n\s*-{3,}\s*)+$/, '').trim();
  return { current: first < content.length ? current : content.trim(), removedQuotedHistory: first < content.length };
}

function trimPlace(s) {
  return String(s || '').replace(/,?\s+\d+[,.]?\d*\s*(?:kg|pallets?|palet\w*|epal).*$/i, '')
    .replace(/\s+(?:loading|pickup|delivery|unloading|zaladunek|rozladunek|pakrovimas|pristatymas)\b.*$/i, '')
    .replace(/\s+(?:is|was|has)\s+(?:delayed|late|missing|damaged)\b.*$/i, '')
    .replace(/[,:;\s-]+$/, '').trim();
}
function route(text) {
  const patterns = [
    /(?:\bfrom\b|\bz\b|\biš\b|\bis\b|\bиз\b)\s+([^\n.;]{2,90}?)\s+(?:\bto\b|\bdo\b|\bį\b|\bi\b|\bв\b)\s+([^\n.;]{2,90}?)(?=[.;\n]|$)/iu,
    /(?:\broute\s*[:\-]?\s*|\btrasa\s*[:\-]?\s*)([^\n.;>]{2,75}?)\s*(?:->|→|–|—)\s*([^\n.;]{2,75})(?=[.;\n]|$)/iu,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return [trimPlace(m[1]), trimPlace(m[2])];
  }
  return ['', ''];
}
const DATE_PATTERN = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*(?:\d{4})?)`;
function firstDate(text) {
  return String(text).match(new RegExp(DATE_PATTERN, 'iu'))?.[1]?.trim() || '';
}
function dateAfter(text, keywords) {
  const re = new RegExp(`(?:${keywords})[^\\n]{0,80}?${DATE_PATTERN}`, 'iu');
  return text.match(re)?.[1]?.trim() || '';
}
function parseMass(raw, unit) {
  let n = String(raw).replace(/\s|\u00a0/g, '');
  if (/\d[,.]\d{3}$/.test(n)) n = n.replace(/[,.]/g, '');
  else if (n.includes('.') && n.includes(',')) n = n.replace(/\./g, '').replace(',', '.');
  else n = n.replace(',', '.');
  const value = Number(n);
  if (!Number.isFinite(value) || value <= 0) return '';
  const kilograms = /^(t|ton|tons|tonnes|tony|tonas)$/.test(unit.toLowerCase()) ? value * 1000 : value;
  return String(Math.round(kilograms * 100) / 100);
}
function cleanLabelPlace(raw) {
  const beforeDate = String(raw).split(new RegExp(DATE_PATTERN, 'iu'))[0];
  return trimPlace(beforeDate.replace(/\([^)]*\)/g, '').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, ''));
}
function getLoadingPlace(text) {
  const m = text.match(/(?:^|\n)\s*[-*•]?\s*(?:loading|pickup|collection|zaladunek|załadunek|pakrovimas)\s*:\s*([^\n]+)/imu);
  if (!m) return '';
  const city = cleanLabelPlace(m[1]);
  return /\d/.test(city.slice(0, 2)) ? '' : city;
}
// One source grammar for extraction and validation, including empty declarations.
// Horizontal whitespace and an explicit line boundary prevent consuming the next line.
function numberedStopDeclarations(text) {
  const re = /^[ \t]*[-*•]?[ \t]*(?:delivery|unloading|drop[ -]?off|rozladunek|rozładunek|pristatymas)[ \t]*(?:#[ \t]*)?(\d+)[ \t]*[:\-][ \t]*([^\r\n]*)/gimu;
  return [...text.matchAll(re)].map(match => ({order:Number(match[1]),raw:match[2].trim()}));
}
function parseDeclaredStop({order,raw}) {
  const date = firstDate(raw);
  const beforeDate = date ? raw.slice(0, raw.indexOf(date)) : raw.split(/\s+[—–]\s+/u)[0];
  const place = cleanLabelPlace(beforeDate);
  if (!place || !/[\p{L}]/u.test(place)) return null;
  const pallets = raw.match(/\b(\d{1,3})\s*(?:EUR\s+|EURO\s+|EU\s+)?(?:pallets?|palet[\p{L}]*|epal|plt)\b/iu)?.[1] || '';
  const timeWindow = raw.match(/(?:before|by|until)\s+\d{1,2}:\d{2}|\b\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\b/iu)?.[0] || '';
  return {order,place,date,timeWindow,pallets};
}
function parseStops(text) {
  return numberedStopDeclarations(text).map(parseDeclaredStop).filter(Boolean).sort((a,b) => a.order - b.order);
}
function parsePallets(text, stops) {
  const total = text.match(/(?:^|\n)\s*[-*•]?\s*(?:total|łącznie|laczn(?:ie)?|iš viso|viso)\s*:\s*(\d{1,4})\s*(?:EUR\s+|EURO\s+|EU\s+)?(?:pallets?|palet[\p{L}]*|epal|plt)\b/imu);
  if (total) return total[1];
  if (stops.length > 1 && stops.every(x => x.pallets)) return String(stops.reduce((n,x)=> n+Number(x.pallets), 0));
  return text.match(/\b(\d{1,4})\s*(?:EUR\s+|EURO\s+|EU\s+|euro[-\s]?)?(?:pallets?|palet[\p{L}]*|epal|plt)(?![\p{L}])/iu)?.[1] || '';
}
function cargoData(text) {
  const cargo = text.match(/(?:^|\n)\s*[-*•]?\s*(?:cargo|towar|krovinys)\s*:\s*([^\n.]+)/imu)?.[1]?.trim() || '';
  const f = folded(text);
  const adrMentioned = /\badr\b/iu.test(text);
  const adrUncertain = /\b(?:probably|maybe|uncertain|unknown|not yet|to be confirmed|please verify|pending)\b/iu.test(text) ||
    /(?:msds|sds).{0,35}(?:not yet|missing|pending|unavailable)/iu.test(text);
  let adrStatus = 'not_specified';
  if (adrMentioned && adrUncertain) adrStatus = 'unverified';
  else if (adrMentioned && /\b(?:adr\s*:\s*yes|adr\s+required)\b/iu.test(text)) adrStatus = 'declared_adr';
  else if (adrMentioned && /\b(?:non[-\s]?adr|adr\s*:\s*no)\b/iu.test(text)) adrStatus = 'declared_non_adr';
  const requirements = [];
  if (/non[-\s]?stackable|niepi[eę]trowaln/iu.test(f)) requirements.push('No stacking');
  if (/side loading|side load/iu.test(f)) requirements.push('Side loading');
  const straps = text.match(/\b(\d+)\s*straps?\b/iu)?.[1];
  if (straps) requirements.push(`${straps} straps`);
  if (/palety nie (?:sa|są) wymienne|non[-\s]?exchangeable pallets/iu.test(f)) requirements.push('Non-exchangeable pallets');
  if (/apsaugine avalyne|apsaugin[eė] avalyn[eė]|safety (?:footwear|shoes|boots)/iu.test(f)) requirements.push('Safety footwear for driver');
  return {cargo, adrStatus, requirements};
}
export function extractTransport(text) {
  const {current, removedQuotedHistory} = splitConversation(text);
  const stops = parseStops(current);
  const [routeFrom, routeTo] = route(current);
  const mass = current.match(/(\d{1,3}(?:[ ,.\u00a0]\d{3})+|\d+(?:[.,]\d+)?)\s*(kg|kgs|kilograms|t|ton|tons|tonnes|tony|tonas)(?![\p{L}])/iu);
  const equipment = current.match(/\b(tautliner|curtainsider|reefer|frigo|refrigerated|mega trailer|box truck|van|plandeka|plandeke|plandeki|firanka|naczepa|tentines?\s+puspriekabes?|tent|ftl|ltl)(?![\p{L}])/iu);
  let loadingDate = dateAfter(current, 'loading|pickup|collection|zaladunek|załadunek|pakrovimas|загрузк[аиыу]');
  if (!loadingDate && getLoadingPlace(current)) {
    const dateLine = current.match(/(?:^|\n)\s*[-*•]?\s*(?:date|data|datum)\s*:\s*([^\n]+)/imu)?.[1];
    if (dateLine) loadingDate = firstDate(dateLine);
  }
  const deliveryDate = stops.length ? stops.map(s=>s.date).filter(Boolean).join(' / ') :
    dateAfter(current, 'delivery|unloading|rozladunek|rozładunek|pristatymas|выгрузк[аиуы]|доставк[аиуы]');
  const fields = {
    origin: getLoadingPlace(current) || routeFrom,
    destination: stops.length ? stops.map(s=>s.place).join(' → ') : routeTo,
    loadingDate, deliveryDate,
    pallets: parsePallets(current, stops),
    weightKg: mass ? parseMass(mass[1],mass[2]) : '',
    equipment: equipment?.[1] || '',
  };
  const {cargo, adrStatus, requirements} = cargoData(current);
  const warnings = [];
  if (removedQuotedHistory) warnings.push({kind:'history', severity:'info', text:'Pominieto historyczna czesc e-maila, aby stare liczby nie nadpisaly aktualnych danych.'});
  if (stops.length > 1) warnings.push({kind:'multistop', severity:'info', text:`${stops.length} punkty rozladunku. Potwierdz kolejnosc i szczegoly obu dostaw.`});
  if (adrStatus === 'unverified') warnings.push({kind:'adr', severity:'high', text:'Status ADR niepotwierdzony — wymagane MSDS/SDS i weryfikacja klasyfikacji przez uprawniona osobe.'});
  if (/lithium\s+batter|battery\s+modules|baterie litowe|akumulatory litowe/iu.test(current) && adrStatus === 'not_specified')
    warnings.push({kind:'adr', severity:'high', text:'Ladunek z bateriami litowymi — zweryfikuj UN/ADR i dokumentacje przed oferta.'});
  if (/dokladne adresy|dokładne adresy|exact addresses? (?:will|not|to be)|adresy .{0,35}jutro/iu.test(folded(current)))
    warnings.push({kind:'address', severity:'medium', text:'Brakuje dokladnych adresow zaladunku i rozladunku; miasta to za malo do finalnej wyceny.'});
  if (/\b(?:tomorrow|jutro|rytojaus)\b/iu.test(current))
    warnings.push({kind:'relative_deadline', severity:'medium', text:'W wiadomosci jest wzgledny termin „jutro/rytojaus”. Ustal timestamp aktualnej wiadomosci przed wyliczeniem terminu oferty.'});
  return {fields, stops, cargo, adrStatus, requirements, warnings, activeText:current};
}
export function extractFields(text) { return extractTransport(text).fields; }
export function detectLanguage(text) {
  const beginning = String(text).trim().slice(0, 220);
  // Do not classify a predominantly English email as Lithuanian just because
  // its footer contains a short LT: instruction.
  if (/^(?:hi[,!]|hello[,!]|dear|good\s+(?:morning|afternoon))/iu.test(beginning)) return 'en';
  if (/^(?:dzien dobry|dzień dobry|szanown)/iu.test(beginning)) return 'pl';
  if (/^(?:sveiki|laba diena|labas)/iu.test(beginning)) return 'lt';
  if (/[А-Яа-яЁё]/u.test(text)) return 'ru';
  if (/(\b(?:sveiki|prasau|prašau|krovinys|pakrovimas|pristatymas|kaina|reikia|aciu|ačiū|paletes|paletės)\b)/iu.test(text)) return 'lt';
  if (/(\b(?:dzien|dzień|prosze|proszę|zaladunek|załadunek|rozladunek|rozładunek|wycene|wycenę|towar|palet|potrzebna|oferta)\b)/iu.test(text)) return 'pl';
  return 'en';
}
export function classifyRules(text) {
  const t = folded(text);
  const rules = [
    ['issue', /delayed|delay|late arrival|damage|damaged|broken|missing cargo|claim|problem|opozni|spoznien|uszkodz|reklamac|veluo|sugadint|задержк|опоздан|поврежд|жалоб/],
    ['documents', /\bpod\b|proof of delivery|signed cmr|invoice|document|dokument|faktura|saskait|документ|накладн/],
    ['status', /\beta\b|tracking|track shipment|where is|status|location of truck|gdzie jest|kur yra|sekim|статус|где машин/],
    ['rfq', /quot|quotation|freight rate|please send price|offer|pricing|wycen|oferte|ofert|cena|kaina|kainos|pasiul|stawka|ставк|тариф|расчет|transporto/],
  ];
  for (const [id, re] of rules) if (re.test(t)) return { id, reason: 'Dopasowanie sygnalow jezykowych (reguly)' };
  return { id: 'other', reason: 'Brak wystarczajacych sygnalow dla jednej kategorii' };
}
export function calcMissing(fields, categoryId) {
  if (categoryId !== 'rfq') return [];
  return ['origin','destination','loadingDate','deliveryDate','pallets','weightKg','equipment']
    .filter(k => !String(fields[k] ?? '').trim());
}
export function calcPriority(text, categoryId) {
  const urgent = /asap|urgent|urgently|immediately|right now|today|piln|natychmiast|dzis|skub|сроч|немедлен|kuo greiciau|kuo greičiau/iu.test(folded(text));
  if (urgent || categoryId === 'issue') return 'high';
  if (categoryId === 'rfq' || categoryId === 'status') return 'mid';
  return 'low';
}
export function analyze(text) {
  const content = String(text).trim();
  if (!content) throw new Error('Wklej tresc wiadomosci.');
  const classification = classifyRules(splitConversation(content).current);
  const parsed = extractTransport(content);
  const fields = parsed.fields;
  return {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7),
    timestamp: new Date().toISOString(), sourceText: content, analyzedSourceText: content, activeText: parsed.activeText,
    stops: parsed.stops, cargo: parsed.cargo, adrStatus: parsed.adrStatus,
    requirements: parsed.requirements, warnings: parsed.warnings,
    language: detectLanguage(parsed.activeText),
    categoryId: classification.id, categoryMethod: 'rules', reason: classification.reason,
    semanticScore: null, priority: calcPriority(content, classification.id), fields,
    missing: calcMissing(fields, classification.id),
    reviewed: false,
  };
}
export function setCategory(record, categoryId, method, reason, semanticScore = null) {
  if (!(categoryId in CATEGORY)) throw new Error('Nieznana kategoria');
  if (record.categoryId !== categoryId) invalidateApproval(record);
  record.categoryId = categoryId;
  record.categoryMethod = method;
  record.reason = reason;
  record.semanticScore = semanticScore;
  record.priority = calcPriority(record.activeText || record.sourceText, categoryId);
  record.missing = calcMissing(record.fields, categoryId);
  return record;
}
export function buildDraft(rec) {
  if (!rec) return '';
  const missing = rec.missing.map(k => FIELD_LABELS[k]);
  const pending = rec.warnings?.filter(w => ['adr','address','relative_deadline'].includes(w.kind)) || [];
  if (rec.language === 'pl') {
    if (rec.categoryId === 'rfq' && pending.length) return `Dzien dobry,\n\nDziekujemy za zapytanie. Przed oferta prosimy potwierdzic: ${[...missing, ...pending.map(x=>x.text)].join('; ')}.\n\nPozdrawiamy`;
    if (rec.categoryId === 'rfq') return missing.length
      ? `Dzien dobry,\n\nDziekujemy za zapytanie transportowe. Aby przygotowac rzetelna wycene, prosimy o potwierdzenie: ${missing.join(', ')}.\n\nPozdrawiamy`
      : 'Dzien dobry,\n\nDziekujemy za szczegoly zapytania. Sprawdzimy mozliwosci realizacji i wrocimy z oferta.\n\nPozdrawiamy';
    if (rec.categoryId === 'issue') return 'Dzien dobry,\n\nDziekujemy za informacje. Zweryfikujemy sytuacje i potwierdzimy aktualny status po sprawdzeniu z przewoznikiem.\n\nPozdrawiamy';
    return 'Dzien dobry,\n\nDziekujemy za wiadomosc. Zweryfikujemy informacje i wrocimy z odpowiedzia.\n\nPozdrawiamy';
  }
  if (rec.language === 'lt') {
    if (rec.categoryId === 'rfq') return missing.length
      ? `Sveiki,\n\nAciu uz transporto uzklausa. Kad galetume pateikti tikslu pasiulyma, prasome patikslinti: ${missing.join(', ')}.\n\nPagarbiai`
      : 'Sveiki,\n\nAciu uz informacija. Patikrinsime transporto galimybes ir pateiksime pasiulyma.\n\nPagarbiai';
    return 'Sveiki,\n\nAciu uz zinute. Patikrinsime informacija ir atsakysime.\n\nPagarbiai';
  }
  if (rec.language === 'ru') return 'Здравствуйте,\n\nСпасибо за сообщение. Проверим информацию и вернемся с ответом после уточнения деталей.\n\nС уважением';
  if (rec.categoryId === 'rfq' && pending.length) {
    const requests = [];
    if (missing.length) requests.push('the following missing information: '+missing.join(', '));
    if (pending.some(x=>x.kind==='address')) requests.push('the exact loading and unloading addresses');
    if (pending.some(x=>x.kind==='adr')) requests.push('the applicable ADR classification, relevant UN details and available MSDS/SDS documentation');
    if (pending.some(x=>x.kind==='relative_deadline')) requests.push('the exact deadline for our quotation');
    return `Hello,\n\nThank you for the revised transport request. Before we finalize a quotation, could you please confirm ${requests.join('; ')}?\n\nWe have noted the requested unloading points.\n\nBest regards`;
  }
  if (rec.categoryId === 'rfq') return missing.length
    ? `Hello,\n\nThank you for your transport enquiry. To prepare an accurate quotation, could you please confirm: ${missing.join(', ')}?\n\nBest regards`
    : 'Hello,\n\nThank you for the shipment details. We will check available transport options and get back to you with a quotation.\n\nBest regards';
  if (rec.categoryId === 'issue') return 'Hello,\n\nThank you for the update. We will investigate the situation and confirm the current status once we have checked with the carrier.\n\nBest regards';
  if (rec.categoryId === 'documents') return 'Hello,\n\nThank you for your message. We will check the document request and confirm what is available.\n\nBest regards';
  return 'Hello,\n\nThank you for your message. We will verify the details and get back to you.\n\nBest regards';
}
export function asPayload(rec) {
  if (!rec) throw new Error('Brak wyniku do eksportu');
  const gate = qualityGate(rec);
  return {
    app_version: '0.3.0', verification: gate, ready_for_crm: gate.ready_for_crm,
    schema: 'jurcasai.freight-intake.v0.2', created_at: rec.timestamp,
    original_message: rec.sourceText, language: rec.language,
    classification: { id: rec.categoryId, label: CATEGORY[rec.categoryId], method: rec.categoryMethod, semantic_similarity: rec.semanticScore },
    priority: rec.priority,
    freight: {
      ...rec.fields, stops: rec.stops || [], cargo: rec.cargo || '',
      adr_status: rec.adrStatus || 'not_specified', requirements: rec.requirements || [],
      verified_adr_classification: gate.adr_review_required ? null : rec.verification.values['adr.decision'],
      review_details: {...rec.verification.values},
    },
    warnings: rec.warnings || [],
    active_message: rec.activeText ?? rec.sourceText,
    missing_fields: calcMissing(rec.fields,rec.categoryId), human_review_required: !gate.ready_for_crm,
    bitrix_field_mapping: 'NOT_CONFIGURED',
  };
}
export function csvCell(value) {
  let v = String(value ?? '');
  // Protect spreadsheet users against formula injection from untrusted messages.
  if (/^[\s]*[=+\-@\t\r]/.test(v)) v = "'" + v;
  return `"${v.replaceAll('"', '""')}"`;
}
export function asCSV(rec) {
  const payload = asPayload(rec);
  const fields = ['verification_status','ready_for_crm','verification_json','created_at','category','priority','origin','destination','loading_date','delivery_date','pallets','weight_kg','equipment','delivery_stops_json','cargo','adr_status','requirements','warnings','missing_fields','original_message'];
  const values = [payload.verification.status,payload.ready_for_crm,JSON.stringify(payload.verification),payload.created_at,payload.classification.id,payload.priority,
    rec.fields.origin,rec.fields.destination,rec.fields.loadingDate,rec.fields.deliveryDate,rec.fields.pallets,rec.fields.weightKg,rec.fields.equipment,
    JSON.stringify(rec.stops || []), rec.cargo || '', rec.adrStatus || 'not_specified', (rec.requirements || []).join('; '),
    (rec.warnings || []).map(w=>w.text).join('; '), rec.missing.join('; '), rec.sourceText];
  return '\ufeff' + fields.map(csvCell).join(',') + '\r\n' + values.map(csvCell).join(',') + '\r\n';
}


// Quality Gate: browser-local human review; no CRM calls or regulatory decisions.
const Q_FIELDS = Object.keys(FIELD_LABELS);
const Q_STOP_LABELS = {order:'Kolejnosc',place:'Miejsce',date:'Data (z rokiem)',timeWindow:'Okno czasowe',pallets:'Palety'};
const qText = value => String(value ?? '').trim();
function qState(rec) {
  const source = rec.sourceText;
  const structure = JSON.stringify(rec.stops.map(stop => [stop.order,stop.place]));
  if (!rec.verification) rec.verification = { confirmed: {}, values: {}, approvedAt: null, approvedSnapshot: null, source, structure };
  const state = rec.verification;
  if (state.source !== source || state.structure !== structure) {
    if (state.source !== source) state.confirmed = {};
    else for (const id of Object.keys(state.confirmed)) {
      if (id.startsWith('stop.') || id.startsWith('address.stop.') || ['address.destination','field.destination','field.deliveryDate'].includes(id))
        delete state.confirmed[id];
    }
    state.approvedAt = null; state.approvedSnapshot = null; rec.reviewed = false;
    state.source = source; state.structure = structure;
  }
  return state;
}
// Editing the source in the UI also clears confirmations before reanalysis.
export function invalidateSourceReview(rec) {
  qState(rec).confirmed = {};
  invalidateApproval(rec);
}
function qSnapshot(rec) {
  return JSON.stringify([rec.sourceText,rec.activeText,rec.categoryId,rec.fields,rec.stops,rec.cargo,rec.adrStatus,rec.requirements,rec.warnings,rec.verification?.values,rec.verification?.confirmed]);
}
export function invalidateApproval(rec) {
  const state = qState(rec);
  state.approvedAt = null; state.approvedSnapshot = null; rec.reviewed = false;
}
function qDate(value) {
  const s = qText(value);
  let y, m, d, match;
  if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [,y,m,d] = match;
  else if ((match = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/))) [,d,m,y] = match;
  else if ((match = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/))) {
    if (!/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i.test(match[2])) return null;
    d = match[1]; y = match[3];
    m = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[2].slice(0,3).toLowerCase()) + 1;
  }
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m)-1 && date.getUTCDate() === Number(d) ? date.getTime() : null;
}
function qSource(rec, original, key, value) {
  const current = original.activeText;
  const parts = key.split('.');
  let matches = [];
  let offset = 0;
  for (const line of current.split('\n')) {
    let found = false;
    if (parts[0] === 'field' && qText(original.fields[parts[1]]) === value) {
      found = qText(extractTransport(line).fields[parts[1]]) === value;
      if (parts[1] === 'loadingDate' && !found && /^\s*[-*]?\s*(?:date|data)\s*:/iu.test(line)) found = firstDate(line) === value;
      if (original.stops.length && ['destination','deliveryDate'].includes(parts[1])) found = false;
    } else if (key === 'cargo' && original.cargo === value) {
      found = cargoData(line).cargo === value;
    } else if (parts[0] === 'stop') {
      const stop = original.stops.find(stop => stop.order === Number(rec.stops[Number(parts[1])]?.order));
      if (stop && qText(stop[parts[2]]) === value) {
        const parsed = parseStops(line);
        found = parsed.length === 1 && parsed[0].order === stop.order && qText(parsed[0][parts[2]]) === value;
      }
    }
    if (found && value) matches.push({text:line,start:offset,end:offset + line.length});
    offset += line.length + 1;
  }
  return matches.length === 1 ? matches[0] : null;
}
function qSourceConflicts(original, field) {
  if (!['origin','loadingDate','pallets','weightKg','equipment'].includes(field)) return [];
  const candidates = [];
  for (const line of original.activeText.split('\n')) {
    // Only repeated explicit declarations count; delivery quantities are not totals.
    const patterns = {
      origin:/^\s*[-*]?\s*(?:loading|pickup|collection|zaladunek|załadunek|pakrovimas)\s*:/iu,
      loadingDate:/^\s*[-*]?\s*(?:date|data|loading date|pickup date)\s*:/iu,
      pallets:/^\s*[-*]?\s*(?:total|łącznie|lacznie|viso)\s*:/iu,
      weightKg:/^\s*[-*]?\s*(?:total|weight|waga|mass)\s*:/iu,
      equipment:/^\s*[-*]?\s*(?:trailer|equipment|vehicle)\s*:/iu,
    };
    if (patterns[field].test(line)) {
      const value = field === 'loadingDate' ? firstDate(line) : extractTransport(line).fields[field];
      if (value) candidates.push(qText(value));
    }
  }
  return [...new Set(candidates)];
}
function qConfirmationContext(rec, key) {
  const s = qState(rec);
  if (key.startsWith('adr.')) return JSON.stringify([rec.sourceText,rec.cargo,rec.adrStatus,s.values['adr.decision'],s.values['adr.reference']]);
  if (key === 'address.loading') return JSON.stringify([rec.sourceText,rec.fields.origin]);
  if (key.startsWith('address.stop.')) return JSON.stringify([rec.sourceText,rec.stops[Number(key.split('.')[2])]?.place]);
  if (key === 'address.destination') return JSON.stringify([rec.sourceText,rec.fields.destination]);
  return rec.sourceText;
}
export function qualityGate(rec) {
  const state = qState(rec);
  const original = extractTransport(rec.sourceText);
  const entries = [];
  const issues = [];
  const add = (id,label,value,group,options={}) => {
    value = qText(value);
    const source = qSource(rec,original,id,value);
    const confirmation = state.confirmed[id];
    const confirmed = !!value && confirmation?.value === value && confirmation.context === qConfirmationContext(rec,id);
    const item = {id,label,value,group,required:true,source,status:!value?'missing':confirmed?'confirmed':source?'extracted':'requires_review',
      confirmed_at:confirmed?confirmation.at:null,note:confirmed?confirmation.note:'',...options};
    entries.push(item); return item;
  };
  const problem = (code,message,ids=[],status='conflict') => {
    issues.push({code,message,severity:'critical',blocking:true,fields:ids});
    for (const item of entries.filter(x => ids.includes(x.id))) { item.status=status; item.confirmed_at=null; }
  };
  add('category','Typ wiadomosci',rec.categoryId,'Dane podstawowe',{choices:Object.entries(CATEGORY)});
  for (const key of Q_FIELDS) add('field.'+key,FIELD_LABELS[key],rec.fields[key],'Dane podstawowe',
    {derived:rec.stops.length>0 && ['destination','deliveryDate'].includes(key)});
  add('cargo','Rodzaj ladunku',rec.cargo,'Dane podstawowe',{required:!!original.cargo || !!rec.cargo});
  add('requirements','Wymagania operacyjne (oddziel srednikiem)',rec.requirements.join('; '),'Dane podstawowe',{required:original.requirements.length>0 || rec.requirements.length>0});
  for (const [index,stop] of rec.stops.entries()) {
    for (const [key,label] of Object.entries(Q_STOP_LABELS))
      add(`stop.${index}.${key}`,label,stop[key],`Rozladunek ${index+1}`,{required:key!=='timeWindow' || !!original.stops.find(sourceStop => sourceStop.order === Number(stop.order))?.timeWindow});
  }
  add('address.loading','Pelny adres zaladunku',state.values['address.loading'],'Adresy i ryzyka');
  if (rec.stops.length) rec.stops.forEach((stop,i) => add(`address.stop.${i}`,`Pelny adres rozladunku ${i+1}`,state.values[`address.stop.${i}`],'Adresy i ryzyka'));
  else add('address.destination','Pelny adres rozladunku',state.values['address.destination'],'Adresy i ryzyka');
  add('adr.decision','Zweryfikowana klasyfikacja ADR',state.values['adr.decision'],'Adresy i ryzyka',
    {choices:[['adr','ADR'],['non_adr','non-ADR']]});
  add('adr.reference','Podstawa weryfikacji ADR (dokument / osoba / ustalenie)',state.values['adr.reference'],'Adresy i ryzyka');
  if (rec.warnings.some(x=>x.kind==='relative_deadline')) {
    const item = add('deadline','Dokladny termin oferty (data, godzina, strefa)',state.values.deadline,'Adresy i ryzyka');
    if (item.value && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(item.value) || !Number.isFinite(Date.parse(item.value)) || qDate(item.value.slice(0,10)) === null))
      problem('invalid_deadline','Podaj termin ISO ze strefa, np. 2026-10-13T10:00+03:00.',['deadline'],'requires_review');
  }
  if (rec.categoryId !== 'rfq') problem('unsupported_category','Gotowosc do CRM jest dostepna tylko dla zweryfikowanego zapytania RFQ.',['category'],'requires_review');
  for (const item of entries) {
    if (/\.pallets$|\.order$/.test(item.id) && item.value && (!/^\d+$/.test(item.value) || !Number.isSafeInteger(Number(item.value)) || Number(item.value)<=0))
      problem('invalid_number:'+item.id,'Wymagana dodatnia liczba calkowita: '+item.label,[item.id]);
    if (item.id==='field.weightKg' && item.value && (!/^\d+(?:\.\d+)?$/.test(item.value) || !Number.isFinite(Number(item.value)) || Number(item.value)<=0))
      problem('invalid_weight','Waga musi byc dodatnia liczba kilogramow.',['field.weightKg']);
    if ((item.id==='field.loadingDate' || (!rec.stops.length && item.id==='field.deliveryDate') || /^stop\.\d+\.date$/.test(item.id)) && item.value && qDate(item.value)===null)
      problem('date_review:'+item.id,'Ustal pelna i poprawna date z rokiem: '+item.label,[item.id],'requires_review');
  }
  for (const key of Q_FIELDS) {
    const candidates = qSourceConflicts(original,key);
    if (candidates.length > 1) {
      const item = entries.find(x=>x.id==='field.'+key);
      item.source_conflict = candidates;
      if (!(item.status==='confirmed' && item.note)) problem('source_conflict:'+key,'Sprzeczne deklaracje w e-mailu: '+FIELD_LABELS[key]+'. Wskaz poprawna wartosc i opisz rozstrzygniecie.',[item.id]);
    }
  }
  if (rec.sourceText !== rec.analyzedSourceText || rec.activeText !== original.activeText)
    problem('source_changed','Zmieniono wiadomosc zrodlowa. Przeanalizuj ja ponownie; stare potwierdzenia nie obowiazuja.',[],'requires_review');
  // Never infer source obligations from the editable stop array.
  const declarations = numberedStopDeclarations(original.activeText);
  const sourceOrders = declarations.map(stop => stop.order).sort((a,b) => a-b);
  if (!sourceOrders.every((order,index) => Number.isSafeInteger(order) && order === index+1))
    problem('source_stop_numbering','Niejednoznaczna numeracja rozladunkow w zrodle (duplikat, luka lub niepoprawny numer). Popraw wiadomosc i przeanalizuj ponownie.',[],'requires_review');
  for (const declaration of declarations) {
    const parsed = parseDeclaredStop(declaration);
    if (!parsed || /^(?:tbd|tbc|unknown|not (?:known|provided)|to be confirmed|do ustalenia|brak)$/iu.test(parsed.place))
      problem('source_stop_incomplete:'+declaration.order,'Pusty lub niejednoznaczny rozladunek '+declaration.order+' w zrodle. Uzupelnij wiadomosc i przeanalizuj ponownie.',[],'requires_review');
  }
  const counts = [...original.activeText.matchAll(/\b(one|two|three|\d+)\s+(?:delivery|unloading)\s+(?:points?|stops?)\b/giu)]
    .map(match => ({one:1,two:2,three:3})[match[1].toLowerCase()] || Number(match[1]));
  const validCount = count => Number.isSafeInteger(count) && count>0;
  const numberedCount = sourceOrders.filter(validCount).reduce((max,order) => Math.max(max,order),declarations.length);
  if (counts.some(count => !validCount(count)) || new Set(counts).size>1 || (declarations.length && counts.some(count => count!==numberedCount)))
    problem('source_stop_count_conflict','Sprzeczne deklaracje liczby rozladunkow w zrodle. Popraw wiadomosc i przeanalizuj ponownie.',[],'requires_review');
  const expectedCount = counts.filter(validCount).reduce((max,count) => Math.max(max,count),numberedCount);
  if (expectedCount && rec.stops.length !== expectedCount)
    problem('stop_count','Liczba punktow nie odpowiada aktualnej wiadomosci. Oczekiwano: '+expectedCount+'. Uzupelnij lub popraw punkty rozladunku.',[],'requires_review');
  if (rec.stops.length) {
    const orders = rec.stops.map(s=>Number(s.order)).sort((a,b)=>a-b);
    if (!orders.every((n,i)=>n===i+1)) problem('stop_order','Kolejnosc punktow musi byc unikalna: 1, 2, 3...',rec.stops.map((_,i)=>`stop.${i}.order`));
    if (rec.stops.every(s=>/^\d+$/.test(qText(s.pallets)))) {
      const sum=rec.stops.reduce((n,s)=>n+Number(s.pallets),0);
      if (sum!==Number(rec.fields.pallets)) problem('pallet_total',`Suma rozladunkow (${sum}) nie zgadza sie z liczba palet (${rec.fields.pallets || 'brak'}).`,
        ['field.pallets',...rec.stops.map((_,i)=>`stop.${i}.pallets`)]);
    }
    for (const [field,prop,joiner] of [['destination','place',' → '],['deliveryDate','date',' / ']]) {
      const item=entries.find(x=>x.id==='field.'+field);
      const expected=[...rec.stops].sort((a,b)=>Number(a.order)-Number(b.order)).map(s=>s[prop]).filter(Boolean).join(joiner);
      if (item.value!==expected) problem('stop_summary:'+field,'Podsumowanie trasy nie odpowiada punktom rozladunku.',[item.id]);
      else if (!issues.some(x=>x.fields.includes(item.id))) {
        const children=entries.filter(x=>new RegExp('^stop\\.\\d+\\.'+prop+'$').test(x.id));
        item.status=children.every(x=>x.status==='confirmed')?'confirmed':children.some(x=>x.status==='conflict')?'conflict':'requires_review';
        item.source=null;
      }
    }
  }
  const dateIds=['field.loadingDate',...(rec.stops.length
    ? rec.stops.map((s,i)=>({s,i})).sort((a,b)=>a.s.order-b.s.order).map(x=>`stop.${x.i}.date`)
    : ['field.deliveryDate'])];
  for (let i=1;i<dateIds.length;i++) {
    const a=entries.find(x=>x.id===dateIds[i-1]), b=entries.find(x=>x.id===dateIds[i]);
    const da=qDate(a.value), db=qDate(b.value);
    if (da!==null && db!==null && db<da) problem('date_order:'+i,'Rozladunek nie moze poprzedzac zaladunku ani poprzedniego punktu.',[a.id,b.id]);
  }
  const adr=entries.find(x=>x.id==='adr.decision');
  if (adr.value && !['adr','non_adr'].includes(adr.value)) problem('invalid_adr','Wybierz ADR lub non-ADR po recznej weryfikacji.',['adr.decision']);
  for (const warning of rec.warnings.filter(w=>w.severity!=='info' && !['adr','address','relative_deadline'].includes(w.kind)))
    problem('unresolved_warning:'+warning.kind,warning.text);
  for (const entry of entries.filter(e=>e.derived)) {
    if (!issues.some(x=>x.fields.includes(entry.id))) {
      const property=entry.id==='field.destination'?'place':'date';
      const children=entries.filter(e=>e.id.startsWith('stop.') && e.id.endsWith('.'+property));
      entry.status=children.every(e=>e.status==='confirmed')?'confirmed':children.some(e=>e.status==='conflict')?'conflict':'requires_review';
    }
  }
  for (const entry of entries) {
    if ((entry.required || entry.value) && entry.status!=='confirmed' && !issues.some(x=>x.fields.includes(entry.id)))
      issues.push({code:'review:'+entry.id,message:entry.label+': '+entry.status,severity:'critical',blocking:true,fields:[entry.id]});
  }
  const approved=!!state.approvedAt && state.approvedSnapshot===qSnapshot(rec) && issues.length===0;
  const status=approved?'confirmed':entries.some(x=>x.status==='conflict')?'conflict':entries.some(x=>x.required && x.status==='missing')?'missing':'requires_review';
  return {version:'0.3',status,ready_for_crm:approved,can_approve:issues.length===0,approved_at:approved?state.approvedAt:null,entries,issues,
    adr_review_required:entries.some(x=>x.id.startsWith('adr.') && x.status!=='confirmed')};
}
function qSyncStops(rec) {
  if (rec.stops.length) {
    const sorted=[...rec.stops].sort((a,b)=>Number(a.order)-Number(b.order));
    // Keep array order stable for review identifiers; derive summaries in delivery order.
    rec.fields.destination=sorted.map(s=>s.place).filter(Boolean).join(' → ');
    rec.fields.deliveryDate=sorted.map(s=>s.date).filter(Boolean).join(' / ');
  }
  rec.missing=calcMissing(rec.fields,rec.categoryId);
}
export function editQualityValue(rec,id,value) {
  const state=qState(rec), parts=id.split('.');
  value=qText(value);
  if (parts[0]==='field') {
    if (!Q_FIELDS.includes(parts[1])) throw new Error('Nieznane pole');
    if (rec.stops.length && ['destination','deliveryDate'].includes(parts[1])) throw new Error('Edytuj osobne punkty rozladunku.');
    rec.fields[parts[1]]=value;
  } else if (parts[0]==='stop') {
    const stop=rec.stops[Number(parts[1])];
    if (!stop || !(parts[2] in Q_STOP_LABELS)) throw new Error('Nieznany punkt');
    stop[parts[2]]=parts[2]==='order' && value ? Number(value) : value;
  } else if (id==='cargo') rec.cargo=value;
  else if (id==='requirements') rec.requirements=value.split(';').map(qText).filter(Boolean);
  else if (id==='category') {
    if (!(value in CATEGORY)) throw new Error('Nieznana kategoria');
    setCategory(rec,value,'manual','Kategoria wybrana recznie.');
  } else if (id.startsWith('address.') || id.startsWith('adr.') || id==='deadline') state.values[id]=value;
  else throw new Error('Nieznane pole weryfikacji');
  delete state.confirmed[id]; invalidateApproval(rec); qSyncStops(rec);
}
export function confirmQualityItem(rec,id,note='') {
  const state=qState(rec);
  const item=qualityGate(rec).entries.find(x=>x.id===id);
  if (!item || item.derived) throw new Error('Potwierdz osobne punkty rozladunku.');
  if (!item.value) throw new Error('Uzupelnij wartosc przed potwierdzeniem.');
  // Source ambiguity can be resolved only with an explicit human explanation.
  const structural=qualityGate(rec).issues.filter(x=>x.fields.includes(id) && !x.code.startsWith('review:') && !x.code.startsWith('source_conflict:'));
  if (structural.length) throw new Error(structural[0].message);
  if (item.source_conflict && !qText(note)) throw new Error('Opisz rozstrzygniecie sprzecznosci ze zrodla.');
  invalidateApproval(rec);
  state.confirmed[id]={value:item.value,context:qConfirmationContext(rec,id),at:new Date().toISOString(),note:qText(note)};
}
export function addDeliveryStop(rec) {
  invalidateApproval(rec);
  rec.stops.push({order:rec.stops.length+1,place:'',date:'',timeWindow:'',pallets:''});
  qSyncStops(rec);
}
export function removeDeliveryStop(rec,index) {
  invalidateApproval(rec);
  rec.stops.splice(index,1);
  const state=qState(rec);
  for (const key of Object.keys(state.confirmed)) if (key.startsWith('stop.') || key.startsWith('address.stop.')) delete state.confirmed[key];
  for (const key of Object.keys(state.values)) if (key.startsWith('address.stop.')) delete state.values[key];
  rec.stops.forEach((s,i)=>s.order=i+1);
  if (!rec.stops.length) {rec.fields.destination='';rec.fields.deliveryDate='';}
  qSyncStops(rec);
}
export function approveRecord(rec) {
  const gate=qualityGate(rec);
  if (!gate.can_approve) { invalidateApproval(rec); return {ok:false,issues:gate.issues}; }
  const state=qState(rec);
  state.approvedAt=new Date().toISOString(); state.approvedSnapshot=qSnapshot(rec); rec.reviewed=true;
  return {ok:true,issues:[]};
}
