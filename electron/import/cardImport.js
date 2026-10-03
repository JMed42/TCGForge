// Spreadsheet rows -> cards. Column mapping (suggested from the headers, then edited by the
// user), a plan of what each row will do (create / update / skip, with the reasons), and the
// card data for each row. Writing happens in electron/import/ipc.js in one transaction.

const BUILTIN_FIELDS = ['name', 'type', 'set_name', 'rarity', 'cost', 'power', 'toughness', 'rules_text', 'flavor_text', 'tags', 'notes', 'image_path'];

const ALIASES = {
  name: ['name', 'card name', 'cardname', 'title', 'card title', 'card'],
  type: ['type', 'card type', 'type line', 'typeline', 'types', 'kind'],
  set_name: ['set', 'set name', 'setname', 'expansion', 'edition'],
  rarity: ['rarity', 'rar'],
  cost: ['cost', 'mana', 'mana cost', 'manacost', 'energy', 'cmc'],
  power: ['power', 'atk', 'attack', 'pow', 'str', 'strength'],
  toughness: ['toughness', 'def', 'defense', 'defence', 'tough', 'hp', 'health', 'life'],
  rules_text: ['rules', 'rules text', 'rulestext', 'text', 'card text', 'oracle text', 'ability', 'abilities', 'effect'],
  flavor_text: ['flavor', 'flavour', 'flavor text', 'flavour text', 'lore', 'quote'],
  tags: ['tags', 'tag', 'keywords', 'labels'],
  notes: ['notes', 'note', 'comment', 'comments'],
  image_path: ['image', 'image path', 'art', 'artwork', 'picture', 'image file'],
};

const MATCH_FIELDS = new Set(BUILTIN_FIELDS);

const norm = (h) => String(h ?? '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

// A custom field key usable in expressions ({{faction}}): letters, digits, underscore.
function fieldSlug(header) {
  let s = String(header ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  if (!s) return '';
  if (/^[0-9]/.test(s)) s = `f_${s}`;
  return s.slice(0, 64);
}

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

/**
 * One target per column: a built-in field, "custom:<key>", or "ignore".
 * Order: exact field name, existing custom field, alias, then a new custom field.
 */
function suggestMapping(headers, existingCustom = []) {
  const used = new Set();
  const custom = new Map(existingCustom.map((k) => [norm(k), k]));
  return headers.map((h) => {
    const n = norm(h);
    let target = null;
    const exact = BUILTIN_FIELDS.find((f) => norm(f) === n);
    if (exact) target = exact;
    else if (custom.has(n)) target = `custom:${custom.get(n)}`;
    else {
      const alias = BUILTIN_FIELDS.find((f) => ALIASES[f].includes(n));
      if (alias) target = alias;
      else {
        const slug = fieldSlug(h);
        target = slug && !/^column [a-z]+$/.test(n) ? `custom:${slug}` : 'ignore';
      }
    }
    if (target !== 'ignore' && used.has(target)) target = 'ignore';
    used.add(target);
    return target;
  });
}

function checkMapping(mapping, width) {
  if (!Array.isArray(mapping) || mapping.length !== width) throw new Error('the column mapping does not match the file');
  const seen = new Set();
  return mapping.map((t, i) => {
    const target = String(t || 'ignore');
    if (target === 'ignore') return target;
    if (target.startsWith('custom:')) {
      const key = target.slice(7);
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) throw new Error(`column ${i + 1}: "${key}" is not a valid field name (letters, digits, _)`);
    } else if (!MATCH_FIELDS.has(target)) throw new Error(`column ${i + 1}: unknown field "${target}"`);
    if (seen.has(target)) throw new Error(`two columns are mapped to ${target}`);
    seen.add(target);
    return target;
  });
}

const splitTags = (v) => String(v).split(/[,;]/).map((t) => t.trim()).filter(Boolean);

/**
 * @param table { headers, rows, firstRow }
 * @param mapping one target per column
 * @param existing cards of the project (DB rows: custom_fields as JSON text, tags as "a,b")
 * @param options { matchBy: 'name' | 'none', blankClears: boolean }
 * @returns {{ rows: Array<{ line, action, cardId?, name, data, problems }>, counts }}
 */
function buildPlan(table, mapping, existing = [], { matchBy = 'name', blankClears = false } = {}) {
  const targets = checkMapping(mapping, table.headers.length);
  if (!targets.includes('name')) throw new Error('map one column to the card name');
  const byName = new Map();
  if (matchBy === 'name') for (const c of existing) {
    const k = String(c.name || '').trim().toLowerCase();
    if (k && !byName.has(k)) byName.set(k, c);
  }
  const seenInFile = new Map();
  const out = [];
  const counts = { create: 0, update: 0, skip: 0, empty: 0 };
  table.rows.forEach((cells, i) => {
    const line = table.firstRow + i;
    if (cells.every((c) => !String(c).trim())) { counts.empty++; return; }
    const data = {};
    const custom = {};
    targets.forEach((t, col) => {
      if (t === 'ignore') return;
      const raw = String(cells[col] ?? '');
      const value = raw.replace(/\r\n?/g, '\n').trim();
      if (!value && !blankClears) return;
      if (t.startsWith('custom:')) custom[t.slice(7)] = value;
      else if (t === 'tags') data.tags = splitTags(value);
      else data[t] = value;
    });
    const name = String(data.name || '').trim();
    const problems = [];
    let action = 'create';
    let cardId;
    if (!name) { problems.push('no card name'); action = 'skip'; }
    const key = name.toLowerCase();
    if (name && seenInFile.has(key)) { problems.push(`same name as row ${seenInFile.get(key)}`); action = 'skip'; }
    if (name && !seenInFile.has(key)) seenInFile.set(key, line);
    if (action !== 'skip' && byName.has(key)) { action = 'update'; cardId = byName.get(key).id; }
    if (action === 'update') {
      const prev = byName.get(key);
      let prevCustom = {};
      try { prevCustom = typeof prev.custom_fields === 'string' ? JSON.parse(prev.custom_fields || '{}') : (prev.custom_fields || {}); } catch { prevCustom = {}; }
      const merged = { ...prevCustom, ...custom };
      for (const [k, v] of Object.entries(merged)) if (v === '') delete merged[k];
      if (Object.keys(custom).length) data.custom_fields = merged;
    } else if (Object.keys(custom).length) {
      for (const [k, v] of Object.entries(custom)) if (v === '') delete custom[k];
      data.custom_fields = custom;
    }
    counts[action]++;
    out.push({ line, action, cardId, name, data, problems });
  });
  return { rows: out, counts };
}

module.exports = { BUILTIN_FIELDS, ALIASES, fieldSlug, toTable, suggestMapping, checkMapping, buildPlan, columnLetter };
