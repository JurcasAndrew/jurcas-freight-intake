// Freight Intake MVP: deterministic field extraction and fallback classification.
// No user text leaves the browser in these functions.
export const SAMPLES = {
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
function dateAfter(text, keywords) {
  // Dates are kept as written, never silently converted into calendar dates.
  const dates = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})`;
  const re = new RegExp(`(?:${keywords}).{0,35}?${dates}`, 'iu');
  return text.match(re)?.[1] || '';
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
export function extractFields(text) {
  const [origin, destination] = route(text);
  const mass = text.match(/(\d{1,3}(?:[ ,.\u00a0]\d{3})+|\d+(?:[.,]\d+)?)\s*(kg|kgs|kilograms|t|ton|tons|tonnes|tony|tonas)(?![\p{L}])/iu);
  const pallet = text.match(/\b(\d{1,3})\s*(?:euro[-\s]?)?(?:pallets?|palet[\p{L}]*|epal|plt)(?![\p{L}])/iu);
  const equipment = text.match(/\b(tautliner|curtainsider|reefer|frigo|refrigerated|mega trailer|box truck|van|plandeka|plandeke|plandeki|firanka|naczepa|tentines?\s+puspriekabes?|tent|ftl|ltl)(?![\p{L}])/iu);
  return {
    origin, destination,
    loadingDate: dateAfter(text, 'loading|pickup|collection|zaladunek|załadunek|pakrovimas|загрузк[аиыу]'),
    deliveryDate: dateAfter(text, 'delivery|unloading|rozladunek|rozładunek|pristatymas|выгрузк[аиуы]|доставк[аиуы]'),
    pallets: pallet?.[1] || '',
    weightKg: mass ? parseMass(mass[1], mass[2]) : '',
    equipment: equipment?.[1] || '',
  };
}
export function detectLanguage(text) {
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
  const classification = classifyRules(content);
  const fields = extractFields(content);
  return {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7),
    timestamp: new Date().toISOString(), sourceText: content,
    language: detectLanguage(content),
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
  record.priority = calcPriority(record.sourceText, categoryId);
  record.missing = calcMissing(record.fields, categoryId);
  return record;
}
export function buildDraft(rec) {
  if (!rec) return '';
  const missing = rec.missing.map(k => FIELD_LABELS[k]);
  if (rec.language === 'pl') {
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
    schema: 'jurcasai.freight-intake.v0.1', created_at: rec.timestamp,
    original_message: rec.sourceText, language: rec.language,
    classification: { id: rec.categoryId, label: CATEGORY[rec.categoryId], method: rec.categoryMethod, semantic_similarity: rec.semanticScore },
    priority: rec.priority, freight: { ...rec.fields },
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
  const fields = ['created_at','category','priority','origin','destination','loading_date','delivery_date','pallets','weight_kg','equipment','missing_fields','original_message'];
  const values = [payload.created_at,payload.classification.id,payload.priority,
    rec.fields.origin,rec.fields.destination,rec.fields.loadingDate,rec.fields.deliveryDate,rec.fields.pallets,rec.fields.weightKg,rec.fields.equipment,rec.missing.join('; '),rec.sourceText];
  return '\ufeff' + fields.map(csvCell).join(',') + '\r\n' + values.map(csvCell).join(',') + '\r\n';
}
