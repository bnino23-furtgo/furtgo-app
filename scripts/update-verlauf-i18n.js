/* eslint-disable */
// Updates the "verlauf" block in all locale JSONs:
//   - adds: heute, diesesJahr, keineHeute, keineJahr
//   - removes: alle, keineAlle
//   - keeps: dieseWoche, dieserMonat, keineWoche, keineMonat (+ rest)
// Preserves each file's original format (pretty 2-space vs. compact one-liner per top key).

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'i18n', 'locales');

const T = {
  de: { heute: 'Heute', diesesJahr: 'Dieses Jahr', keineHeute: 'Keine Fahrten heute', keineJahr: 'Keine Fahrten dieses Jahr' },
  en: { heute: 'Today', diesesJahr: 'This year', keineHeute: 'No trips today', keineJahr: 'No trips this year' },
  fr: { heute: "Aujourd'hui", diesesJahr: 'Cette année', keineHeute: "Aucune course aujourd'hui", keineJahr: 'Aucune course cette année' },
  it: { heute: 'Oggi', diesesJahr: "Quest'anno", keineHeute: 'Nessuna corsa oggi', keineJahr: "Nessuna corsa quest'anno" },
  es: { heute: 'Hoy', diesesJahr: 'Este año', keineHeute: 'Sin viajes hoy', keineJahr: 'Sin viajes este año' },
  pt: { heute: 'Hoje', diesesJahr: 'Este ano', keineHeute: 'Sem viagens hoje', keineJahr: 'Sem viagens este ano' },
  nl: { heute: 'Vandaag', diesesJahr: 'Dit jaar', keineHeute: 'Geen ritten vandaag', keineJahr: 'Geen ritten dit jaar' },
  pl: { heute: 'Dziś', diesesJahr: 'W tym roku', keineHeute: 'Brak przejazdów dzisiaj', keineJahr: 'Brak przejazdów w tym roku' },
  ro: { heute: 'Astăzi', diesesJahr: 'Anul acesta', keineHeute: 'Fără curse astăzi', keineJahr: 'Fără curse anul acesta' },
  hr: { heute: 'Danas', diesesJahr: 'Ove godine', keineHeute: 'Nema vožnji danas', keineJahr: 'Nema vožnji ove godine' },
  sr: { heute: 'Данас', diesesJahr: 'Ове године', keineHeute: 'Нема вожњи данас', keineJahr: 'Нема вожњи ове године' },
  bs: { heute: 'Danas', diesesJahr: 'Ove godine', keineHeute: 'Nema vožnji danas', keineJahr: 'Nema vožnji ove godine' },
  sl: { heute: 'Danes', diesesJahr: 'Letos', keineHeute: 'Ni voženj danes', keineJahr: 'Ni voženj letos' },
  sk: { heute: 'Dnes', diesesJahr: 'Tento rok', keineHeute: 'Žiadne jazdy dnes', keineJahr: 'Žiadne jazdy tento rok' },
  cs: { heute: 'Dnes', diesesJahr: 'Letos', keineHeute: 'Žádné jízdy dnes', keineJahr: 'Žádné jízdy letos' },
  hu: { heute: 'Ma', diesesJahr: 'Idén', keineHeute: 'Nincs út ma', keineJahr: 'Nincs út idén' },
  el: { heute: 'Σήμερα', diesesJahr: 'Φέτος', keineHeute: 'Καμία διαδρομή σήμερα', keineJahr: 'Καμία διαδρομή φέτος' },
  bg: { heute: 'Днес', diesesJahr: 'Тази година', keineHeute: 'Няма пътувания днес', keineJahr: 'Няма пътувания тази година' },
  mk: { heute: 'Денес', diesesJahr: 'Оваа година', keineHeute: 'Нема возења денес', keineJahr: 'Нема возења оваа година' },
  sq: { heute: 'Sot', diesesJahr: 'Këtë vit', keineHeute: 'Asnjë udhëtim sot', keineJahr: 'Asnjë udhëtim këtë vit' },
  ar: { heute: 'اليوم', diesesJahr: 'هذا العام', keineHeute: 'لا رحلات اليوم', keineJahr: 'لا رحلات هذا العام' },
  tr: { heute: 'Bugün', diesesJahr: 'Bu yıl', keineHeute: 'Bugün yolculuk yok', keineJahr: 'Bu yıl yolculuk yok' },
  ru: { heute: 'Сегодня', diesesJahr: 'В этом году', keineHeute: 'Поездок сегодня нет', keineJahr: 'Поездок в этом году нет' },
  sw: { heute: 'Leo', diesesJahr: 'Mwaka huu', keineHeute: 'Hakuna safari leo', keineJahr: 'Hakuna safari mwaka huu' },
  zh: { heute: '今天', diesesJahr: '今年', keineHeute: '今天没有行程', keineJahr: '今年没有行程' },
  ja: { heute: '今日', diesesJahr: '今年', keineHeute: '本日の運行なし', keineJahr: '今年の運行なし' },
};

// Find the matching closing brace for a `{` at startIndex in the source text.
function findMatchingBrace(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIndex; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Build the new verlauf object preserving original key order where possible.
function buildNextVerlauf(v, trans) {
  const next = {};
  if (v.titel !== undefined) next.titel = v.titel;
  next.heute = trans.heute;
  if (v.dieseWoche !== undefined) next.dieseWoche = v.dieseWoche;
  if (v.dieserMonat !== undefined) next.dieserMonat = v.dieserMonat;
  next.diesesJahr = trans.diesesJahr;
  for (const k of ['fahrt', 'einnahmen', 'ausgaben', 'abgeschlossen', 'abgebrochen']) {
    if (v[k] !== undefined) next[k] = v[k];
  }
  next.keineHeute = trans.keineHeute;
  if (v.keineWoche !== undefined) next.keineWoche = v.keineWoche;
  if (v.keineMonat !== undefined) next.keineMonat = v.keineMonat;
  next.keineJahr = trans.keineJahr;
  if (v.betrag !== undefined) next.betrag = v.betrag;
  return next;
}

// Serialize an object as a single-line JSON: { "k": "v", ... }
function compactSerialize(obj) {
  return '{ ' + Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ') + ' }';
}

// Serialize an object as pretty 2-space indent, with given baseIndent prefix on inner lines.
function prettySerialize(obj, baseIndent) {
  const innerIndent = baseIndent + '  ';
  const entries = Object.entries(obj).map(([k, v]) =>
    `${innerIndent}${JSON.stringify(k)}: ${JSON.stringify(v)}`
  );
  return '{\n' + entries.join(',\n') + '\n' + baseIndent + '}';
}

const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const lang = path.basename(file, '.json');
  const trans = T[lang];
  if (!trans) {
    console.warn(`[skip] no translations for ${lang}`);
    continue;
  }
  const full = path.join(LOCALES_DIR, file);
  const original = fs.readFileSync(full, 'utf8');

  // Locate "verlauf": { ... }
  const keyMatch = original.match(/(^|\n)([ \t]*)"verlauf":\s*\{/);
  if (!keyMatch) {
    console.warn(`[skip] no verlauf key in ${file}`);
    continue;
  }
  const baseIndent = keyMatch[2];
  const braceStart = keyMatch.index + keyMatch[0].lastIndexOf('{');
  const braceEnd = findMatchingBrace(original, braceStart);
  if (braceEnd < 0) {
    console.warn(`[skip] unmatched brace in ${file}`);
    continue;
  }

  const verlaufJson = original.slice(braceStart, braceEnd + 1);
  let verlauf;
  try {
    verlauf = JSON.parse(verlaufJson);
  } catch (e) {
    console.warn(`[skip] cannot parse verlauf in ${file}: ${e.message}`);
    continue;
  }

  const next = buildNextVerlauf(verlauf, trans);

  // Determine format style: pretty if a newline appears between { and the first key
  const isPretty = /\{\s*\n/.test(verlaufJson);
  const replacement = isPretty ? prettySerialize(next, baseIndent) : compactSerialize(next);

  const updated = original.slice(0, braceStart) + replacement + original.slice(braceEnd + 1);
  fs.writeFileSync(full, updated, 'utf8');
  console.log(`[ok] ${file}`);
}
