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
  return { current: current || content.trim(), removedQuotedHistory: first < content.length };
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
function parseStops(text) {
  const stops = [];
  const re = /^\s*[-*•]?\s*(?:delivery|unloading|drop[ -]?off|rozladunek|rozładunek|pristatymas)\s*(?:#\s*)?(\d+)\s*[:\-]\s*(.+)$/gimu;
  for (const match of text.matchAll(re)) {
    const raw = match[2];
    const date = firstDate(raw);
    const beforeDate = date ? raw.slice(0, raw.indexOf(date)) : raw.split(/\s+[—–]\s+/u)[0];
    const place = cleanLabelPlace(beforeDate);
    if (!place || !/[\p{L}]/u.test(place)) continue;
    const pallets = raw.match(/\b(\d{1,3})\s*(?:EUR\s+|EURO\s+|EU\s+)?(?:pallets?|palet[\p{L}]*|epal|plt)\b/iu)?.[1] || '';
    const timeWindow = raw.match(/(?:before|by|until)\s+\d{1,2}:\d{2}|\b\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\b/iu)?.[0] || '';
    stops.push({order: Number(match[1]), place, date, timeWindow, pallets});
  }
  return stops.sort((a,b) => a.order - b.order);
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
    timestamp: new Date().toISOString(), sourceText: content, activeText: parsed.activeText,
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
  return {
    schema: 'jurcasai.freight-intake.v0.2', created_at: rec.timestamp,
    original_message: rec.sourceText, language: rec.language,
    classification: { id: rec.categoryId, label: CATEGORY[rec.categoryId], method: rec.categoryMethod, semantic_similarity: rec.semanticScore },
    priority: rec.priority,
    freight: {
      ...rec.fields, stops: rec.stops || [], cargo: rec.cargo || '',
      adr_status: rec.adrStatus || 'not_specified', requirements: rec.requirements || [],
    },
    warnings: rec.warnings || [],
    active_message: rec.activeText || rec.sourceText,
    missing_fields: [...rec.missing], human_review_required: true,
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
  const fields = ['created_at','category','priority','origin','destination','loading_date','delivery_date','pallets','weight_kg','equipment','delivery_stops_json','cargo','adr_status','requirements','warnings','missing_fields','original_message'];
  const values = [payload.created_at,payload.classification.id,payload.priority,
    rec.fields.origin,rec.fields.destination,rec.fields.loadingDate,rec.fields.deliveryDate,rec.fields.pallets,rec.fields.weightKg,rec.fields.equipment,
    JSON.stringify(rec.stops || []), rec.cargo || '', rec.adrStatus || 'not_specified', (rec.requirements || []).join('; '),
    (rec.warnings || []).map(w=>w.text).join('; '), rec.missing.join('; '), rec.sourceText];
  return '\ufeff' + fields.map(csvCell).join(',') + '\r\n' + values.map(csvCell).join(',') + '\r\n';
}
