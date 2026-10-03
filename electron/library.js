// The project library (spec Phase 4, "Symbols, keywords and variables"): symbols ({fire} -> an
// image in assets/icons), keywords (a name, parameters and reminder text, optionally linked to a
// Game Docs rule entry) and global variables ({{HAND_SIZE}}), plus the project's reminder-text
// settings. The renderer turns these rows into what it draws (src/designer/library/library.ts).
//
// Symbols are stored by file path rather than the spec's asset_id: the assets index is rebuilt
// from disk, and a path survives that.

const SHORTCODE_RE = /^[A-Za-z0-9][A-Za-z0-9_+\-/]{0,23}$/;
const VARIABLE_RE = /^[A-Z][A-Z0-9_]{0,47}$/;
const PARAM_RE = /^[A-Z][A-Za-z0-9_]{0,15}$/;
const KEYWORD_RE = /^[\p{L}][\p{L}\p{N}' -]{0,39}$/u;
const PARAM_KINDS = ['number', 'word'];
const MAX_TEMPLATE = 2000;

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function checkShortcode(code) {
  if (!SHORTCODE_RE.test(code)) return 'a shortcode is letters, digits and _ + - /, up to 24 (like fire, T or W/U)';
  return null;
}

function checkVariableKey(key) {
  if (!VARIABLE_RE.test(key)) return 'a variable name is UPPER_CASE letters, digits and _ (like HAND_SIZE)';
  return null;
}

function checkKeywordName(name) {
  if (!KEYWORD_RE.test(name)) return 'a keyword starts with a letter: letters, digits, spaces, \' and -, up to 40';
  return null;
}

function cleanParams(params) {
  if (!Array.isArray(params)) return [];
  if (params.length > 4) throw new Error('at most 4 parameters');
  const seen = new Set();
  return params.map((p) => {
    const name = String((p && p.name) || '').trim();
    if (!PARAM_RE.test(name)) throw new Error(`parameter "${name}": start with a capital letter (like X or Amount)`);
    if (seen.has(name)) throw new Error(`parameter "${name}" is listed twice`);
    seen.add(name);
    const kind = PARAM_KINDS.includes(p.kind) ? p.kind : 'number';
    return { name, kind };
  });
}

function cleanSettings(raw) {
  const r = (raw && raw.reminders) || {};
  const sets = {};
  for (const [name, on] of Object.entries(r.sets || {})) {
    if (typeof on === 'boolean' && String(name).length <= 200) sets[String(name)] = on;
  }
  return { reminders: { show: r.show !== false, sets } };
}

const relOk = (rel) => typeof rel === 'string' && rel.startsWith('assets/') && !rel.split('/').includes('..') && !rel.includes('\\') && rel.length <= 512;

/**
 * deps: { queryAll, queryOne, exec, inTransaction, cardPatchSql(projectId, patch) -> { sql, values } | null,
 *         fileExists?(projectId, relPath) -> boolean }
 */
function createLibrary({ queryAll, queryOne, exec, inTransaction, cardPatchSql, fileExists }) {
  const settingsOf = (projectId) => {
    const row = queryOne('SELECT settings FROM projects WHERE id = ?', [projectId]);
    return cleanSettings(parseJson((row && row.settings) || '{}', {}));
  };

  function getLibrary(projectId) {
    const symbols = queryAll(
      `SELECT s.id, s.shortcode, s.rel_path, s.scale, s.baseline_offset, a.width, a.height, a.sha256
       FROM symbols s LEFT JOIN assets a ON a.project_id = s.project_id AND a.rel_path = s.rel_path
       WHERE s.project_id = ? ORDER BY s.shortcode COLLATE NOCASE`,
      [projectId],
    );
    const keywords = queryAll('SELECT id, name, params_json, reminder_template, rule_ref FROM keywords WHERE project_id = ? ORDER BY name COLLATE NOCASE', [projectId])
      .map(({ params_json: p, ...k }) => ({ ...k, params: parseJson(p || '[]', []) }));
    const variables = queryAll('SELECT id, key, value, description FROM variables WHERE project_id = ? ORDER BY key', [projectId]);
    return { symbols, keywords, variables, settings: settingsOf(projectId) };
  }

  const own = (table, projectId, id) => {
    const row = queryOne(`SELECT * FROM ${table} WHERE id = ?`, [Number(id)]);
    if (!row || row.project_id !== projectId) throw new Error(`not in this project (${table} ${id})`);
    return row;
  };

  // ── symbols ──
  function checkSymbol(projectId, s, id = null) {
    const shortcode = String(s.shortcode || '').trim().replace(/^\{|\}$/g, '');
    const bad = checkShortcode(shortcode);
    if (bad) throw new Error(bad);
    const clash = queryOne('SELECT id FROM symbols WHERE project_id = ? AND shortcode = ?', [projectId, shortcode]);
    if (clash && clash.id !== id) throw new Error(`{${shortcode}} already exists`);
    return shortcode;
  }

  function saveSymbol(projectId, s) {
    const id = s.id ? own('symbols', projectId, s.id).id : null;
    const shortcode = checkSymbol(projectId, s, id);
    const rel = String(s.rel_path || '');
    if (!relOk(rel)) throw new Error('the image must be a file in the project\'s assets folder');
    if (fileExists && !fileExists(projectId, rel)) throw new Error(`file not found: ${rel}`);
    const scale = Number(s.scale ?? 1);
    const offset = Number(s.baseline_offset ?? -0.12);
    if (!Number.isFinite(scale) || scale < 0.2 || scale > 4) throw new Error('size must be between 0.2 and 4 (times the text size)');
    if (!Number.isFinite(offset) || offset < -2 || offset > 2) throw new Error('baseline offset must be between -2 and 2 em');
    inTransaction(() => {
      if (id) exec('UPDATE symbols SET shortcode = ?, rel_path = ?, scale = ?, baseline_offset = ? WHERE id = ?', [shortcode, rel, scale, offset, id]);
      else exec('INSERT INTO symbols (project_id, shortcode, rel_path, scale, baseline_offset) VALUES (?, ?, ?, ?, ?)', [projectId, shortcode, rel, scale, offset]);
    });
    return getLibrary(projectId);
  }

  // ── keywords ──
  function checkKeyword(projectId, k, id = null) {
    const name = String(k.name || '').trim().replace(/\s+/g, ' ');
    const bad = checkKeywordName(name);
    if (bad) throw new Error(bad);
    const clash = queryOne('SELECT id FROM keywords WHERE project_id = ? AND lower(name) = lower(?)', [projectId, name]);
    if (clash && clash.id !== id) throw new Error(`keyword "${name}" already exists`);
    return name;
  }

  function saveKeyword(projectId, k) {
    const id = k.id ? own('keywords', projectId, k.id).id : null;
    const name = checkKeyword(projectId, k, id);
    const params = cleanParams(k.params);
    const reminder = String(k.reminder_template ?? '');
    if (reminder.length > MAX_TEMPLATE) throw new Error(`reminder text is longer than ${MAX_TEMPLATE} characters`);
    const ruleRef = k.rule_ref === null || k.rule_ref === undefined || k.rule_ref === '' ? null : Number(k.rule_ref);
    if (ruleRef !== null) {
      const doc = queryOne('SELECT project_id FROM documents WHERE id = ?', [ruleRef]);
      if (!doc || doc.project_id !== projectId) throw new Error('that rule entry is not in this project');
    }
    inTransaction(() => {
      if (id) exec("UPDATE keywords SET name = ?, params_json = ?, reminder_template = ?, rule_ref = ?, updated_at = datetime('now') WHERE id = ?", [name, JSON.stringify(params), reminder, ruleRef, id]);
      else exec('INSERT INTO keywords (project_id, name, params_json, reminder_template, rule_ref) VALUES (?, ?, ?, ?, ?)', [projectId, name, JSON.stringify(params), reminder, ruleRef]);
    });
    return getLibrary(projectId);
  }

  // ── variables ──
  function checkVariable(projectId, v, id = null) {
    const key = String(v.key || '').trim();
    const bad = checkVariableKey(key);
    if (bad) throw new Error(bad);
    const clash = queryOne('SELECT id FROM variables WHERE project_id = ? AND key = ?', [projectId, key]);
    if (clash && clash.id !== id) throw new Error(`${key} already exists`);
    return key;
  }

  function saveVariable(projectId, v) {
    const id = v.id ? own('variables', projectId, v.id).id : null;
    const key = checkVariable(projectId, v, id);
    const value = String(v.value ?? '');
    const description = String(v.description ?? '');
    if (value.length > MAX_TEMPLATE) throw new Error(`a value is at most ${MAX_TEMPLATE} characters`);
    if (description.length > 500) throw new Error('a description is at most 500 characters');
    inTransaction(() => {
      if (id) exec("UPDATE variables SET key = ?, value = ?, description = ?, updated_at = datetime('now') WHERE id = ?", [key, value, description, id]);
      else exec('INSERT INTO variables (project_id, key, value, description) VALUES (?, ?, ?, ?)', [projectId, key, value, description]);
    });
    return getLibrary(projectId);
  }

  const TABLES = { symbol: 'symbols', keyword: 'keywords', variable: 'variables' };

  function remove(projectId, kind, id) {
    const table = TABLES[kind];
    if (!table) throw new Error(`unknown library item "${kind}"`);
    own(table, projectId, id);
    inTransaction(() => exec(`DELETE FROM ${table} WHERE id = ?`, [Number(id)]));
    return getLibrary(projectId);
  }

  function saveSettings(projectId, settings) {
    const clean = cleanSettings(settings);
    inTransaction(() => exec('UPDATE projects SET settings = ? WHERE id = ?', [JSON.stringify(clean), projectId]));
    return getLibrary(projectId);
  }

  /**
   * Rename a symbol, keyword or variable and, in the same transaction, apply the rewrites the
   * renderer worked out from "where used": card patches, template contents, exception conditions.
   * change: { kind: 'symbol'|'keyword'|'variable', id, to }
   */
  function rename(projectId, { change, cards = [], templates = [], rules = [] }) {
    const table = TABLES[change && change.kind];
    if (!table) throw new Error('unknown library item');
    const row = own(table, projectId, change.id);
    let column;
    let value;
    if (change.kind === 'symbol') { column = 'shortcode'; value = checkSymbol(projectId, { shortcode: change.to }, row.id); }
    else if (change.kind === 'keyword') { column = 'name'; value = checkKeyword(projectId, { name: change.to }, row.id); }
    else { column = 'key'; value = checkVariable(projectId, { key: change.to }, row.id); }
    if (cards.length > 20000) throw new Error('too many cards at once');
    const cardSets = cards.map((c) => {
      const card = queryOne('SELECT project_id FROM cards WHERE id = ?', [Number(c && c.id)]);
      if (!card || card.project_id !== projectId) throw new Error(`card ${c && c.id} is not in this project`);
      return { id: Number(c.id), set: cardPatchSql(projectId, c.patch || {}) };
    });
    for (const t of templates) {
      const tpl = queryOne('SELECT project_id FROM templates WHERE id = ?', [Number(t.id)]);
      if (!tpl || tpl.project_id !== projectId) throw new Error(`template ${t.id} is not in this project`);
      JSON.parse(t.content);
    }
    inTransaction(() => {
      exec(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [value, row.id]);
      for (const c of cardSets) if (c.set) exec(`UPDATE cards SET ${c.set.sql} WHERE id = ?`, [...c.set.values, c.id]);
      for (const t of templates) exec("UPDATE templates SET content = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?", [t.content, Number(t.id)]);
      for (const r of rules) exec('UPDATE template_rules SET condition_expr = ? WHERE id = ? AND project_id = ?', [String(r.condition_expr), Number(r.id), projectId]);
    });
    return { library: getLibrary(projectId), cards: cardSets.length };
  }

  return { getLibrary, saveSymbol, saveKeyword, saveVariable, remove, saveSettings, rename };
}

function registerLibraryIpc(ipcMain, lib) {
  ipcMain.handle('getLibrary', (_, projectId) => lib.getLibrary(projectId));
  ipcMain.handle('saveSymbol', (_, projectId, symbol) => lib.saveSymbol(projectId, symbol));
  ipcMain.handle('saveKeyword', (_, projectId, keyword) => lib.saveKeyword(projectId, keyword));
  ipcMain.handle('saveVariable', (_, projectId, variable) => lib.saveVariable(projectId, variable));
  ipcMain.handle('deleteLibraryItem', (_, projectId, kind, id) => lib.remove(projectId, kind, id));
  ipcMain.handle('saveLibrarySettings', (_, projectId, settings) => lib.saveSettings(projectId, settings));
  ipcMain.handle('renameLibraryItem', (_, projectId, request) => lib.rename(projectId, request));
}

module.exports = {
  createLibrary, registerLibraryIpc, checkShortcode, checkVariableKey, checkKeywordName, cleanParams, cleanSettings,
};
