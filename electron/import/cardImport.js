// Spreadsheet rows -> cards, mapped onto the project's card model (electron/cardModel.js).
//
// Each column maps to: a field of the library (by key), a new field ("new:<key>", created on
// import), the card type ("card_type"), or nothing ("ignore"). The card type comes either from one
// choice for every row or from a column of type names (unknown names can create types). The plan
// says what each row will do (create / update by name / skip, with reasons) and what the import
// adds to the model (types, fields, fields on types). Writing happens in one transaction.

const { STANDARD_FIELDS, STANDARD_KEYS, keyFromLabel, checkKey, inferKind } = require('../cardModel');

const ALIASES = {
  name: ['name', 'card name', 'cardname', 'title', 'card title', 'card'],
  type: ['type line', 'typeline', 'subtype', 'subtypes'],
  set_name: ['set', 'set name', 'setname', 'expansion', 'edition'],
  rarity: ['rarity', 'rar'],
  cost: ['cost', 'mana', 'mana cost', 'manacost', 'energy', 'cmc'],
  power: ['power', 'pow', 'str', 'strength'],
  toughness: ['toughness', 'tough'],
  rules_text: ['rules', 'rules text', 'rulestext', 'text', 'card text', 'oracle text', 'ability', 'abilities'],
  flavor_text: ['flavor', 'flavour', 'flavor text', 'flavour text', 'lore', 'quote'],
  tags: ['tags', 'tag', 'keywords', 'labels'],
  notes: ['notes', 'note', 'comment', 'comments'],
  image_path: ['image', 'image path', 'art', 'artwork', 'picture', 'image file'],
};
const CARD_TYPE_HEADERS = ['card type', 'cardtype', 'category', 'kind', 'card kind'];
const YES_NO = new Set(['true', 'false', 'yes', 'no']);

const norm = (h) => String(h ?? '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

const columnLetter = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** { headers, rows } from raw rows; without a header row the columns are named A, B, C... */
function toTable(rawRows, headerRow = true) {
  const width = rawRows.reduce((w, r) => Math.max(w, r.length), 0);
  const pad = (r) => Array.from({ length: width }, (_, i) => (r[i] === undefined || r[i] === null ? '' : String(r[i])));
  if (!headerRow) return { headers: Array.from({ length: width }, (_, i) => `Column ${columnLetter(i)}`), rows: rawRows.map(pad), firstRow: 1 };
  const [head = [], ...rest] = rawRows;
  const headers = pad(head).map((h, i) => h.trim() || `Column ${columnLetter(i)}`);
  return { headers, rows: rest.map(pad), firstRow: 2 };
}

const columnValues = (table, i) => table.rows.map((r) => String(r[i] ?? '').trim()).filter(Boolean);

/**
 * A suggested target per column. model: { fields: [{ key, label, kind }], types: [{ id, name }] }.
 * Order: card type column, a library field by label or key, a standard alias whose field is in
 * the library, then a new field named after the header.
 */
function suggestMapping(table, model) {
  const used = new Set();
  const lib = model.fields;
  const typeNames = new Set(model.types.map((t) => t.name.toLowerCase()));
  return table.headers.map((h, i) => {
    const n = norm(h);
    let target = null;
    const values = columnValues(table, i);
    const looksLikeTypes = values.length > 0 && values.filter((v) => typeNames.has(v.toLowerCase())).length / values.length >= 0.5;
    if (CARD_TYPE_HEADERS.includes(n) || (n === 'type' && looksLikeTypes)) target = 'card_type';
    else if (ALIASES.name.includes(n)) target = 'name';
    else {
      const byLabel = lib.find((f) => norm(f.label) === n || f.key === keyFromLabel(h));
      if (byLabel) target = byLabel.key;
      else {
        const std = Object.keys(ALIASES).find((k) => k !== 'name' && ALIASES[k].includes(n));
        if (std && lib.some((f) => f.key === std)) target = std;
        else if (/^column [a-z]+$/.test(n)) target = 'ignore';
        else {
          const key = std || keyFromLabel(h);
          target = key && !checkKey(key) ? `new:${key}` : 'ignore';
        }
      }
    }
    if (target !== 'ignore' && used.has(target)) target = 'ignore';
    used.add(target);
    return target;
  });
}

// Validate a mapping; returns { targets, newKeys: Map(key -> header) }.
function checkMapping(mapping, table, model) {
  if (!Array.isArray(mapping) || mapping.length !== table.headers.length) throw new Error('the column mapping does not match the file');
  const lib = new Set(model.fields.map((f) => f.key));
  const seen = new Set();
  const newKeys = new Map();
  const targets = mapping.map((t, i) => {
    let target = String(t || 'ignore');
    if (target === 'ignore') return target;
    if (target.startsWith('new:')) {
      const key = target.slice(4);
      const bad = checkKey(key);
      if (bad) throw new Error(`column ${i + 1}: ${bad}`);
      if (lib.has(key)) target = key; // exists after all
      else newKeys.set(key, table.headers[i]);
    } else if (target !== 'name' && target !== 'card_type' && !lib.has(target)) {
      throw new Error(`column ${i + 1}: unknown field "${target}"`);
    }
    if (seen.has(target)) throw new Error(`two columns are mapped to ${target === 'card_type' ? 'the card type' : target}`);
    seen.add(target);
    return target;
  });
  if (!targets.includes('name')) throw new Error('map one column to the card name');
  return { targets, newKeys };
}

const fieldKeyOf = (target) => (target.startsWith('new:') ? target.slice(4) : target);
const splitTags = (v) => String(v).split(/[,;]/).map((t) => t.trim()).filter(Boolean);
const toBool = (v) => ['true', 'yes', 'y', '1', 'x'].includes(String(v).trim().toLowerCase());

function parseCustom(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
}

/**
 * @param table { headers, rows, firstRow }
 * @param mapping one target per column
 * @param existing cards of the project (DB rows)
 * @param model { fields, types: [{ id, name, field_keys }] }
 * @param options {
 *   matchBy: 'name' | 'none', blankClears,
 *   typeId: the type for new cards (and rows with an empty type cell),
 *   createTypes: create types named in a card type column that don't exist,
 *   addFieldsToTypes: add mapped fields to the types whose cards get values for them,
 * }
 */
function buildPlan(table, mapping, existing = [], model = { fields: [], types: [] }, options = {}) {
  const { matchBy = 'name', blankClears = false, createTypes = true, addFieldsToTypes = true } = options;
  const { targets, newKeys } = checkMapping(mapping, table, model);
  const fieldByKey = new Map(model.fields.map((f) => [f.key, f]));
  const typeByName = new Map(model.types.map((t) => [t.name.toLowerCase(), t]));
  const fallbackType = model.types.find((t) => t.id === Number(options.typeId)) || model.types[0] || null;
  const typeCol = targets.indexOf('card_type');

  // Kinds for new fields, guessed from the column's values.
  const newFields = [];
  for (const [key, header] of newKeys) {
    const vals = columnValues(table, targets.indexOf(`new:${key}`));
    const std = STANDARD_FIELDS.find((f) => f.key === key);
    let kind = std ? std.kind : inferKind(vals);
    if (!std && vals.length && vals.every((v) => YES_NO.has(v.toLowerCase()))) kind = 'yesNo';
    newFields.push({ key, label: std ? std.label : String(header).trim().slice(0, 80) || key, kind, options: std?.options || [], help: std?.help || '' });
  }
  const kindOf = (key) => fieldByKey.get(key)?.kind || newFields.find((f) => f.key === key)?.kind || 'text';

  const byName = new Map();
  if (matchBy === 'name') for (const c of existing) {
    const k = String(c.name || '').trim().toLowerCase();
    if (k && !byName.has(k)) byName.set(k, c);
  }
  const seenInFile = new Map();
  const newTypes = new Map(); // lower name -> display name
  const typeAdds = new Map(); // type key ("id:3" or "new:relic") -> Set(field keys)
  const out = [];
  const counts = { create: 0, update: 0, skip: 0, empty: 0 };

  table.rows.forEach((cells, i) => {
    const line = table.firstRow + i;
    if (cells.every((c) => !String(c).trim())) { counts.empty++; return; }
    const data = {};
    const custom = {};
    const filled = [];
    const problems = [];
    const notes = [];
    targets.forEach((t, col) => {
      if (t === 'ignore' || t === 'card_type') return;
      const value = String(cells[col] ?? '').replace(/\r\n?/g, '\n').trim();
      if (!value && !blankClears) return;
      const key = fieldKeyOf(t);
      if (key === 'name') { data.name = value; return; }
      const kind = kindOf(key);
      if (value) filled.push(key);
      if (key === 'tags') data.tags = splitTags(value);
      else if (STANDARD_KEYS.has(key)) data[key] = value;
      else custom[key] = kind === 'yesNo' ? toBool(value) : value;
    });

    const name = String(data.name || '').trim();
    let action = 'create';
    let cardId;
    if (!name) { problems.push('no card name'); action = 'skip'; }
    const nk = name.toLowerCase();
    if (name && seenInFile.has(nk)) { problems.push(`same name as row ${seenInFile.get(nk)}`); action = 'skip'; }
    if (name && !seenInFile.has(nk)) seenInFile.set(nk, line);
    const prev = action !== 'skip' ? byName.get(nk) : null;
    if (prev) { action = 'update'; cardId = prev.id; }

    // Card type: from the column, else (new cards) the chosen type.
    let typeKey = null;
    let typeName = null;
    const cell = typeCol >= 0 ? String(cells[typeCol] ?? '').trim() : '';
    if (action !== 'skip' && cell) {
      const t = typeByName.get(cell.toLowerCase());
      if (t) { data.card_type_id = t.id; typeKey = `id:${t.id}`; typeName = t.name; }
      else if (createTypes) {
        if (!newTypes.has(cell.toLowerCase())) newTypes.set(cell.toLowerCase(), cell);
        data.card_type_name = newTypes.get(cell.toLowerCase());
        typeKey = `new:${cell.toLowerCase()}`;
        typeName = data.card_type_name;
        notes.push(`new type "${typeName}"`);
      } else { problems.push(`no card type "${cell}"`); action = 'skip'; }
    }
    if (action === 'create' && !typeKey && fallbackType) { data.card_type_id = fallbackType.id; typeKey = `id:${fallbackType.id}`; typeName = fallbackType.name; }
    if (action === 'update' && !typeKey) {
      const t = model.types.find((x) => x.id === prev.card_type_id);
      if (t) { typeKey = `id:${t.id}`; typeName = t.name; }
    }

    // Fields the row fills that its type doesn't list yet.
    if (action !== 'skip' && typeKey) {
      const type = typeKey.startsWith('id:') ? model.types.find((t) => `id:${t.id}` === typeKey) : null;
      const missing = filled.filter((k) => !(type && type.field_keys && type.field_keys.includes(k)));
      if (missing.length) {
        if (addFieldsToTypes) {
          if (!typeAdds.has(typeKey)) typeAdds.set(typeKey, new Set());
          for (const k of missing) typeAdds.get(typeKey).add(k);
        } else {
          notes.push(`${typeName} doesn't use ${missing.join(', ')} (values kept, hidden)`);
        }
      }
    }

    if (action === 'update') {
      const merged = { ...parseCustom(prev.custom_fields), ...custom };
      for (const [k, v] of Object.entries(merged)) if (v === '') delete merged[k];
      if (Object.keys(custom).length) data.custom_fields = merged;
    } else if (Object.keys(custom).length) {
      for (const [k, v] of Object.entries(custom)) if (v === '') delete custom[k];
      data.custom_fields = custom;
    }
    counts[action]++;
    out.push({ line, action, cardId, name, type: typeName, data, problems, notes });
  });

  const typeFieldAdds = [...typeAdds].map(([key, keys]) => ({
    ...(key.startsWith('id:') ? { typeId: Number(key.slice(3)) } : { typeName: newTypes.get(key.slice(4)) }),
    keys: [...keys],
  }));
  return { rows: out, counts, newTypes: [...newTypes.values()], newFields, typeFieldAdds };
}

module.exports = { ALIASES, toTable, suggestMapping, checkMapping, buildPlan, columnLetter };
