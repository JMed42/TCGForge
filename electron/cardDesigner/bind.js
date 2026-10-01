// {{field}} binding for template strings.
//
// This is deliberately the whole "expression language" for Phase 0: a regex that only
// accepts a bare identifier, looked up in a null-prototype map. No paths, calls, operators,
// eval or Function — template JSON can never execute code or reach prototypes.

const CARD_COLUMNS = [
  'id', 'name', 'type', 'set_name', 'rarity', 'cost', 'power', 'toughness',
  'rules_text', 'flavor_text', 'tags', 'image_path', 'notes',
];

const BINDING_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function parseCustomFields(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Build the lookup table for one card. Built-in columns win over custom fields of the same name.
function buildFieldMap(card) {
  const fields = Object.create(null);
  const custom = parseCustomFields(card && card.custom_fields);
  for (const key of Object.keys(custom)) {
    const v = custom[key];
    if (v === null || v === undefined || typeof v === 'object') continue;
    fields[key] = String(v);
  }
  for (const col of CARD_COLUMNS) {
    const v = card ? card[col] : undefined;
    if (v !== null && v !== undefined) fields[col] = String(v);
  }
  return fields;
}

// Returns { value, unresolved } where unresolved lists binding names with no value.
function bindString(str, fields) {
  if (typeof str !== 'string') return { value: str, unresolved: [] };
  const unresolved = [];
  const value = str.replace(BINDING_RE, (_, name) => {
    if (Object.prototype.hasOwnProperty.call(fields, name) && fields[name] !== '') return fields[name];
    unresolved.push(name);
    return '';
  });
  return { value, unresolved };
}

module.exports = { CARD_COLUMNS, buildFieldMap, bindString, parseCustomFields };
