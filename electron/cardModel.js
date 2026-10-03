// Card types and fields: the project's data model (separate from templates, which only draw it).
//
// A project has a field library (card_fields: key, label, kind, options, default, help) and card
// types (card_types: name, colour, default template, ordered field_keys). Every card has one type.
// "Name" is implicit: always first, never in field_keys.
//
// Storage does not move: standard fields live in their existing card columns (cost, power,
// rules_text, ...); every other field lives in cards.custom_fields JSON. Yes/No values are JSON
// booleans. Keys are identifiers so templates can bind {{key}}.

const STANDARD_FIELDS = [
  { key: 'type', label: 'Type line', kind: 'text', help: 'e.g. Creature \u2014 Dragon' },
  { key: 'set_name', label: 'Set', kind: 'text', help: '' },
  { key: 'rarity', label: 'Rarity', kind: 'choice', options: ['Common', 'Uncommon', 'Rare', 'Mythic'], help: '' },
  { key: 'cost', label: 'Cost', kind: 'text', help: '' },
  { key: 'power', label: 'Power', kind: 'text', help: '' },
  { key: 'toughness', label: 'Toughness', kind: 'text', help: '' },
  { key: 'rules_text', label: 'Card text', kind: 'longText', help: '**bold** and *italic* work here' },
  { key: 'flavor_text', label: 'Flavor text', kind: 'longText', help: '' },
  { key: 'tags', label: 'Tags', kind: 'tags', help: 'Comma-separated' },
  { key: 'notes', label: 'Notes', kind: 'longText', help: 'Not printed unless a template uses it' },
  { key: 'image_path', label: 'Art', kind: 'image', help: '' },
];
const STANDARD_KEYS = new Set(STANDARD_FIELDS.map((f) => f.key));
const KINDS = ['text', 'longText', 'number', 'choice', 'yesNo', 'image', 'tags'];
const RESERVED_KEYS = new Set([
  'id', 'project_id', 'name', 'card_type', 'card_type_id', 'card_type_template_id', 'template_override_id',
  'custom_fields', 'created_at', 'updated_at', 'true', 'false', 'null',
]);
const KEY_RE = /^[a-z_][a-z0-9_]{0,47}$/;
const MAX_FIELDS = 200;
const MAX_TYPES = 100;
const MAX_OPTIONS = 200;
const DEFAULT_COLORS = ['#7c6ef0', '#e0794a', '#3fa7d6', '#59c26d', '#d65b8f', '#c9a227', '#8a8f98'];

// Starters for new projects (and the migration of existing ones).
const STARTERS = {
  blank: [{ name: 'Card', fields: [{ key: 'cost', kind: 'number' }, 'rules_text', 'image_path'] }],
  classic: [{ name: 'Card', fields: STANDARD_FIELDS.map((f) => f.key) }],
};

// "Action Rating" -> "action_rating"; "2nd Cost" -> "f_2nd_cost".
function keyFromLabel(label) {
  let s = String(label ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  if (!s) return '';
  if (/^[0-9]/.test(s)) s = `f_${s}`;
  return s.slice(0, 48).replace(/_+$/, '');
}

function checkKey(key) {
  if (!KEY_RE.test(key)) return 'keys use lower-case letters, digits and _, and start with a letter';
  if (RESERVED_KEYS.has(key)) return `"${key}" is reserved`;
  return null;
}

// Which kinds a key may have: standard columns are text, so Yes/No is custom-only; tags and art
// keep their own kinds.
function allowedKinds(key) {
  if (key === 'tags') return ['tags'];
  if (key === 'image_path') return ['image'];
  if (STANDARD_KEYS.has(key)) return ['text', 'longText', 'number', 'choice'];
  return KINDS.filter((k) => k !== 'tags');
}

// Guess a kind from sample values (migration and import).
function inferKind(values) {
  const vals = values.filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
  if (!vals.length) return 'text';
  if (vals.every((v) => typeof v === 'boolean')) return 'yesNo';
  if (vals.some((v) => /\n/.test(String(v)))) return 'longText';
  if (vals.every((v) => String(v).trim() !== '' && Number.isFinite(Number(v)))) return 'number';
  return 'text';
}

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function cleanField(input, existing) {
  const label = String(input.label ?? existing?.label ?? '').trim().slice(0, 80);
  if (!label) throw new Error('a field needs a label');
  const key = existing ? existing.key : String(input.key || keyFromLabel(label));
  if (!existing) {
    const bad = checkKey(key);
    if (bad) throw new Error(bad);
  }
  const kind = String(input.kind ?? existing?.kind ?? 'text');
  if (!allowedKinds(key).includes(kind)) {
    throw new Error(`"${label}" can't be ${kind}${STANDARD_KEYS.has(key) ? ' (standard field)' : ''}`);
  }
  let options = input.options ?? (existing ? parseJson(existing.options, []) : []);
  if (!Array.isArray(options)) throw new Error('options must be a list');
  options = [...new Set(options.map((o) => String(o).trim()).filter(Boolean))].slice(0, MAX_OPTIONS);
  const def = input.default_value ?? existing?.default_value ?? '';
  const help = String(input.help ?? existing?.help ?? '').slice(0, 200);
  return { key, label, kind, options: kind === 'choice' ? options : [], default_value: String(def).slice(0, 2000), help };
}

/**
 * Model operations over the database. db: { queryAll, queryOne, exec, inTransaction }, where exec
 * runs a statement without saving (used inside inTransaction).
 */
function createCardModel(db) {
  const { queryAll, queryOne, exec, inTransaction } = db;

  const listFields = (projectId) => queryAll('SELECT * FROM card_fields WHERE project_id = ? ORDER BY id', [projectId]);
  const listTypes = (projectId) => queryAll('SELECT * FROM card_types WHERE project_id = ? ORDER BY sort_order, id', [projectId]);
  const typeKeys = (t) => parseJson(t.field_keys, []);

  function getModel(projectId) {
    const counts = new Map(queryAll('SELECT card_type_id AS id, COUNT(*) AS n FROM cards WHERE project_id = ? GROUP BY card_type_id', [projectId]).map((r) => [r.id, r.n]));
    return {
      fields: listFields(projectId).map((f) => ({ ...f, options: parseJson(f.options, []) })),
      types: listTypes(projectId).map((t) => ({ ...t, field_keys: typeKeys(t), card_count: counts.get(t.id) || 0 })),
      standardFields: STANDARD_FIELDS,
      kinds: KINDS,
    };
  }

  // Inside a transaction: insert a field if the key is free; returns the key.
  function insertField(projectId, f) {
    const exists = queryOne('SELECT id FROM card_fields WHERE project_id = ? AND key = ?', [projectId, f.key]);
    if (exists) return f.key;
    exec('INSERT INTO card_fields (project_id, key, label, kind, options, default_value, help) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [projectId, f.key, f.label, f.kind, JSON.stringify(f.options || []), f.default_value || '', f.help || '']);
    return f.key;
  }

  function standardField(key, override = {}) {
    const s = STANDARD_FIELDS.find((f) => f.key === key);
    return { key, label: s.label, kind: override.kind || s.kind, options: s.options || [], default_value: '', help: s.help || '' };
  }

  function nextSortOrder(projectId) {
    return (queryOne('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM card_types WHERE project_id = ?', [projectId])?.n) || 0;
  }

  // Create the starter types for a project with none. Inside a transaction.
  function applyStarter(projectId, starter = 'classic') {
    const spec = STARTERS[starter] || STARTERS.classic;
    const ids = [];
    spec.forEach((t, i) => {
      const keys = t.fields.map((f) => insertField(projectId, typeof f === 'string' ? standardField(f) : standardField(f.key, f)));
      exec('INSERT INTO card_types (project_id, name, color, sort_order, field_keys) VALUES (?, ?, ?, ?, ?)',
        [projectId, t.name, DEFAULT_COLORS[i % DEFAULT_COLORS.length], nextSortOrder(projectId), JSON.stringify(keys)]);
      ids.push(queryOne('SELECT last_insert_rowid() AS id').id);
    });
    return ids;
  }

  // The project always has at least one type; cards without one get the first type.
  function ensureTypes(projectId) {
    if (!listTypes(projectId).length) inTransaction(() => applyStarter(projectId, 'classic'));
    const first = listTypes(projectId)[0];
    const orphan = 'project_id = ? AND (card_type_id IS NULL OR card_type_id NOT IN (SELECT id FROM card_types WHERE project_id = ?))';
    if (queryOne(`SELECT COUNT(*) AS n FROM cards WHERE ${orphan}`, [projectId, projectId]).n > 0) {
      inTransaction(() => exec(`UPDATE cards SET card_type_id = ? WHERE ${orphan}`, [first.id, projectId, projectId]));
    }
    return first.id;
  }

  function saveField(projectId, input) {
    const key = input.key || keyFromLabel(input.label);
    const existing = key ? queryOne('SELECT * FROM card_fields WHERE project_id = ? AND key = ?', [projectId, key]) : null;
    if (input.create && existing) throw new Error(`a field with the key "${key}" already exists`);
    if (!input.create && !existing && input.key) throw new Error(`no field "${input.key}"`);
    if (!existing && listFields(projectId).length >= MAX_FIELDS) throw new Error(`at most ${MAX_FIELDS} fields`);
    const f = cleanField(input, existing);
    inTransaction(() => {
      if (existing) {
        exec('UPDATE card_fields SET label = ?, kind = ?, options = ?, default_value = ?, help = ? WHERE id = ?',
          [f.label, f.kind, JSON.stringify(f.options), f.default_value, f.help, existing.id]);
      } else {
        insertField(projectId, f);
      }
    });
    return { key: f.key, model: getModel(projectId) };
  }

  /**
   * Rename a custom field's key: card values move, type field lists follow, and the template and
   * exception rewrites computed in the renderer (token-aware) are applied, all at once.
   * rewrites: { templates: [{ id, content }], rules: [{ id, condition_expr }] }
   */
  function renameField(projectId, oldKey, newKey, rewrites = {}) {
    const field = queryOne('SELECT * FROM card_fields WHERE project_id = ? AND key = ?', [projectId, oldKey]);
    if (!field) throw new Error(`no field "${oldKey}"`);
    if (STANDARD_KEYS.has(oldKey)) throw new Error('standard fields keep their key; change the label instead');
    const bad = checkKey(newKey);
    if (bad) throw new Error(bad);
    if (STANDARD_KEYS.has(newKey)) throw new Error(`"${newKey}" is a standard field`);
    if (queryOne('SELECT id FROM card_fields WHERE project_id = ? AND key = ?', [projectId, newKey])) throw new Error(`"${newKey}" is already used`);
    const templates = rewrites.templates || [];
    const rules = rewrites.rules || [];
    for (const t of templates) {
      const row = queryOne('SELECT project_id FROM templates WHERE id = ?', [t.id]);
      if (!row || row.project_id !== projectId) throw new Error(`template ${t.id} is not in this project`);
      JSON.parse(t.content);
    }
    let moved = 0;
    inTransaction(() => {
      exec('UPDATE card_fields SET key = ? WHERE id = ?', [newKey, field.id]);
      for (const c of queryAll('SELECT id, custom_fields FROM cards WHERE project_id = ?', [projectId])) {
        const data = parseJson(c.custom_fields || '{}', {});
        if (!Object.prototype.hasOwnProperty.call(data, oldKey)) continue;
        const next = {};
        for (const [k, v] of Object.entries(data)) next[k === oldKey ? newKey : k] = v;
        exec('UPDATE cards SET custom_fields = ? WHERE id = ?', [JSON.stringify(next), c.id]);
        moved++;
      }
      for (const t of listTypes(projectId)) {
        const keys = typeKeys(t);
        if (keys.includes(oldKey)) exec('UPDATE card_types SET field_keys = ?, updated_at = datetime(\'now\') WHERE id = ?', [JSON.stringify(keys.map((k) => (k === oldKey ? newKey : k))), t.id]);
      }
      for (const t of templates) exec("UPDATE templates SET content = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?", [t.content, t.id]);
      for (const r of rules) exec('UPDATE template_rules SET condition_expr = ? WHERE id = ? AND project_id = ?', [String(r.condition_expr), r.id, projectId]);
    });
    return { moved, model: getModel(projectId) };
  }

  function deleteField(projectId, key, { purgeValues = false } = {}) {
    const field = queryOne('SELECT * FROM card_fields WHERE project_id = ? AND key = ?', [projectId, key]);
    if (!field) throw new Error(`no field "${key}"`);
    const users = listTypes(projectId).filter((t) => typeKeys(t).includes(key)).map((t) => t.name);
    if (users.length) throw new Error(`remove it from ${users.join(', ')} first`);
    let purged = 0;
    inTransaction(() => {
      exec('DELETE FROM card_fields WHERE id = ?', [field.id]);
      if (!purgeValues) return;
      if (STANDARD_KEYS.has(key)) {
        purged = queryOne(`SELECT COUNT(*) AS n FROM cards WHERE project_id = ? AND COALESCE(${key}, '') <> ''`, [projectId]).n;
        exec(`UPDATE cards SET ${key} = '' WHERE project_id = ?`, [projectId]);
      } else {
        for (const c of queryAll('SELECT id, custom_fields FROM cards WHERE project_id = ?', [projectId])) {
          const data = parseJson(c.custom_fields || '{}', {});
          if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
          delete data[key];
          exec('UPDATE cards SET custom_fields = ? WHERE id = ?', [JSON.stringify(data), c.id]);
          purged++;
        }
      }
    });
    return { purged, model: getModel(projectId) };
  }

  // How many cards hold a value for a field (for delete confirmations).
  function fieldValueCount(projectId, key) {
    if (STANDARD_KEYS.has(key)) return queryOne(`SELECT COUNT(*) AS n FROM cards WHERE project_id = ? AND COALESCE(${key}, '') <> ''`, [projectId]).n;
    return queryAll('SELECT custom_fields FROM cards WHERE project_id = ?', [projectId])
      .filter((c) => { const d = parseJson(c.custom_fields || '{}', {}); return d[key] !== undefined && d[key] !== '' && d[key] !== null; }).length;
  }

  // Create or update a type: { id?, name, color, template_id, field_keys }.
  function saveType(projectId, input) {
    const name = String(input.name ?? '').trim().slice(0, 60);
    if (!name) throw new Error('a card type needs a name');
    const clash = queryOne('SELECT id FROM card_types WHERE project_id = ? AND lower(name) = lower(?)', [projectId, name]);
    if (clash && clash.id !== input.id) throw new Error(`there is already a type called "${name}"`);
    const known = new Set(listFields(projectId).map((f) => f.key));
    const keys = Array.isArray(input.field_keys) ? input.field_keys.map(String) : [];
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length) throw new Error(`unknown field(s): ${unknown.join(', ')}`);
    if (new Set(keys).size !== keys.length) throw new Error('a field is listed twice');
    let templateId = input.template_id === null || input.template_id === undefined || input.template_id === '' ? null : Number(input.template_id);
    if (templateId !== null) {
      const t = queryOne('SELECT project_id FROM templates WHERE id = ?', [templateId]);
      if (!t || t.project_id !== projectId) throw new Error('that template is not in this project');
    }
    const color = /^#[0-9a-fA-F]{6}$/.test(String(input.color || '')) ? input.color : DEFAULT_COLORS[0];
    let id = input.id ? Number(input.id) : null;
    if (id) {
      const row = queryOne('SELECT project_id FROM card_types WHERE id = ?', [id]);
      if (!row || row.project_id !== projectId) throw new Error('that type is not in this project');
    } else if (listTypes(projectId).length >= MAX_TYPES) throw new Error(`at most ${MAX_TYPES} card types`);
    inTransaction(() => {
      if (id) {
        exec("UPDATE card_types SET name = ?, color = ?, template_id = ?, field_keys = ?, updated_at = datetime('now') WHERE id = ?",
          [name, color, templateId, JSON.stringify(keys), id]);
      } else {
        exec('INSERT INTO card_types (project_id, name, color, sort_order, template_id, field_keys) VALUES (?, ?, ?, ?, ?, ?)',
          [projectId, name, color, nextSortOrder(projectId), templateId, JSON.stringify(keys)]);
        id = queryOne('SELECT last_insert_rowid() AS id').id;
      }
    });
    return { id, model: getModel(projectId) };
  }

  function deleteType(projectId, typeId, { moveTo } = {}) {
    const types = listTypes(projectId);
    const type = types.find((t) => t.id === typeId);
    if (!type) throw new Error('that type is not in this project');
    if (types.length === 1) throw new Error('a project needs at least one card type');
    const count = queryOne('SELECT COUNT(*) AS n FROM cards WHERE card_type_id = ?', [typeId]).n;
    const target = moveTo ? types.find((t) => t.id === Number(moveTo) && t.id !== typeId) : null;
    if (count > 0 && !target) throw new Error(`choose a type to move its ${count} card(s) to`);
    inTransaction(() => {
      if (count > 0) exec("UPDATE cards SET card_type_id = ?, updated_at = datetime('now') WHERE card_type_id = ?", [target.id, typeId]);
      exec('DELETE FROM card_types WHERE id = ?', [typeId]);
    });
    return { moved: count, model: getModel(projectId) };
  }

  function reorderTypes(projectId, ids) {
    const types = listTypes(projectId);
    const known = new Set(types.map((t) => t.id));
    if (!Array.isArray(ids) || ids.length !== types.length || !ids.every((id) => known.has(Number(id)))) throw new Error('the list of types does not match');
    inTransaction(() => ids.forEach((id, i) => exec('UPDATE card_types SET sort_order = ? WHERE id = ?', [i, Number(id)])));
    return getModel(projectId);
  }

  // Default values for a new card of a type: { columns, custom }.
  function defaultsFor(projectId, typeId) {
    const type = queryOne('SELECT * FROM card_types WHERE id = ? AND project_id = ?', [typeId, projectId]);
    if (!type) return { columns: {}, custom: {} };
    const fields = new Map(listFields(projectId).map((f) => [f.key, f]));
    const columns = {};
    const custom = {};
    for (const key of typeKeys(type)) {
      const f = fields.get(key);
      if (!f || f.default_value === '' || f.default_value === null) continue;
      if (STANDARD_KEYS.has(key)) columns[key] = f.default_value;
      else custom[key] = f.kind === 'yesNo' ? f.default_value === 'true' : f.default_value;
    }
    return { columns, custom };
  }

  return {
    getModel, listFields, listTypes, applyStarter, ensureTypes, saveField, renameField, deleteField,
    fieldValueCount, saveType, deleteType, reorderTypes, defaultsFor,
  };
}

function registerCardModelIpc(ipcMain, model) {
  ipcMain.handle('getCardModel', (_, projectId) => { model.ensureTypes(projectId); return model.getModel(projectId); });
  ipcMain.handle('saveCardField', (_, projectId, field) => model.saveField(projectId, field));
  ipcMain.handle('renameCardField', (_, projectId, oldKey, newKey, rewrites) => model.renameField(projectId, oldKey, newKey, rewrites));
  ipcMain.handle('deleteCardField', (_, projectId, key, options) => model.deleteField(projectId, key, options));
  ipcMain.handle('cardFieldValueCount', (_, projectId, key) => model.fieldValueCount(projectId, key));
  ipcMain.handle('saveCardType', (_, projectId, type) => model.saveType(projectId, type));
  ipcMain.handle('deleteCardType', (_, projectId, typeId, options) => model.deleteType(projectId, typeId, options));
  ipcMain.handle('reorderCardTypes', (_, projectId, ids) => model.reorderTypes(projectId, ids));
}

module.exports = {
  STANDARD_FIELDS, STANDARD_KEYS, KINDS, RESERVED_KEYS, STARTERS, DEFAULT_COLORS,
  keyFromLabel, checkKey, allowedKinds, inferKind, createCardModel, registerCardModelIpc,
};
