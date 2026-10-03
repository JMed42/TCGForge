// Schema migrations, tracked with SQLite's PRAGMA user_version.
// Version 0 is the original TCG Studio schema created by initDatabase.
//
// Rules: append new migrations, never edit a shipped one. Each run happens inside one
// transaction, and the database file is copied to {db}.bak-v{N} before the first change.

const fs = require('fs');
const templates = require('./cardDesigner/templates');
const { convertLegacyTemplate, isLegacyTemplate } = require('./cardDesigner/convertLegacyTemplate');
const cardModel = require('./cardModel');

// Rows of a query on the raw sql.js database (migrations run before the helpers exist).
function rows(db, sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
}

const labelFromKey = (key) => {
  const s = key.replace(/_+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const MIGRATIONS = [
  {
    version: 1,
    name: 'templates table',
    up(db) {
      db.run(`
        CREATE TABLE IF NOT EXISTS templates (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name        TEXT NOT NULL,
          content     TEXT NOT NULL DEFAULT '{}',
          created_at  TEXT DEFAULT (datetime('now')),
          updated_at  TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_templates_project ON templates(project_id);
      `);
    },
  },
  {
    version: 2,
    name: 'import Phase 0 template files',
    // Phase 0 kept templates as {userData}/projects/{id}/templates/*.json. Copy them into the
    // table; the files stay where they are (that folder remains the asset root).
    up(db, { userDataPath, log }) {
      if (!userDataPath) return;
      const projects = db.exec('SELECT id FROM projects');
      const ids = projects.length ? projects[0].values.map((r) => r[0]) : [];
      for (const projectId of ids) {
        const existing = new Set(
          (db.exec('SELECT name FROM templates WHERE project_id = ?', [projectId])[0]?.values || []).map((r) => r[0])
        );
        for (const file of templates.listTemplateFiles(userDataPath, projectId)) {
          if (file.error) { log(`skipped template file ${file.id}.json in project ${projectId}: ${file.error}`); continue; }
          if (existing.has(file.name)) continue;
          db.run('INSERT INTO templates (project_id, name, content) VALUES (?, ?, ?)', [projectId, file.name, file.content]);
          existing.add(file.name);
          log(`imported template "${file.name}" into project ${projectId}`);
        }
      }
    },
  },
  {
    version: 3,
    name: 'template schema v1 (mm frames)',
    // Templates move from the Phase 0 pixel format to the spec's schema v1. The original JSON
    // is kept in legacy_content; version starts at 1 and bumps on every save.
    up(db, { log }) {
      db.run('ALTER TABLE templates ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
      db.run('ALTER TABLE templates ADD COLUMN legacy_content TEXT');
      const res = db.exec('SELECT id, name, content FROM templates');
      for (const [id, name, content] of res.length ? res[0].values : []) {
        let parsed;
        try { parsed = JSON.parse(content); } catch {
          log(`template ${id} "${name}": content is not JSON, left as is`);
          continue;
        }
        if (!isLegacyTemplate(parsed)) continue;
        const { template, notes } = convertLegacyTemplate(parsed);
        template.name = String(name || template.name);
        db.run('UPDATE templates SET content = ?, legacy_content = ? WHERE id = ?', [JSON.stringify(template, null, 2), content, id]);
        log(`converted template ${id} "${name}" to schema v1${notes.length ? ` (${notes.join('; ')})` : ''}`);
      }
    },
  },
  {
    version: 4,
    name: 'template rules, card template override, assets index',
    // Spec data model: template_rules pick a card's template (first match by priority);
    // cards.template_override_id is the per-card exception; assets indexes files on disk.
    up(db) {
      db.run(`
        CREATE TABLE IF NOT EXISTS template_rules (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          priority        INTEGER NOT NULL DEFAULT 0,
          condition_expr  TEXT NOT NULL DEFAULT '',
          template_id     INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
          created_at      TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_template_rules_project ON template_rules(project_id, priority);
        CREATE TABLE IF NOT EXISTS assets (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          rel_path    TEXT NOT NULL,
          kind        TEXT NOT NULL DEFAULT 'other',
          sha256      TEXT NOT NULL DEFAULT '',
          width       INTEGER,
          height      INTEGER,
          size        INTEGER NOT NULL DEFAULT 0,
          mtime       REAL NOT NULL DEFAULT 0,
          UNIQUE (project_id, rel_path)
        );
        CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id, kind);
      `);
      db.run('ALTER TABLE cards ADD COLUMN template_override_id INTEGER');
    },
  },
  {
    version: 5,
    name: 'card types and fields',
    // The project's own data model (electron/cardModel.js). Every project gets one type, "Card",
    // with today's standard fields plus the custom fields its cards actually hold, and every card
    // is assigned to it. No card data moves.
    up(db, { log }) {
      db.run(`
        CREATE TABLE IF NOT EXISTS card_fields (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          key            TEXT NOT NULL,
          label          TEXT NOT NULL,
          kind           TEXT NOT NULL DEFAULT 'text',
          options        TEXT NOT NULL DEFAULT '[]',
          default_value  TEXT NOT NULL DEFAULT '',
          help           TEXT NOT NULL DEFAULT '',
          created_at     TEXT DEFAULT (datetime('now')),
          UNIQUE (project_id, key)
        );
        CREATE TABLE IF NOT EXISTS card_types (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name         TEXT NOT NULL,
          color        TEXT NOT NULL DEFAULT '#7c6ef0',
          sort_order   INTEGER NOT NULL DEFAULT 0,
          template_id  INTEGER REFERENCES templates(id) ON DELETE SET NULL,
          field_keys   TEXT NOT NULL DEFAULT '[]',
          created_at   TEXT DEFAULT (datetime('now')),
          updated_at   TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_card_types_project ON card_types(project_id, sort_order);
      `);
      db.run('ALTER TABLE cards ADD COLUMN card_type_id INTEGER');
      for (const { id: projectId } of rows(db, 'SELECT id FROM projects')) {
        const used = new Map(); // custom key -> sample values
        for (const c of rows(db, 'SELECT custom_fields FROM cards WHERE project_id = ?', [projectId])) {
          let data;
          try { data = JSON.parse(c.custom_fields || '{}'); } catch { continue; }
          if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
          for (const [k, v] of Object.entries(data)) {
            if (v === null || v === '' || typeof v === 'object') continue;
            if (cardModel.checkKey(k) || cardModel.STANDARD_KEYS.has(k)) continue; // not bindable: left as stored values
            if (!used.has(k)) used.set(k, []);
            used.get(k).push(v);
          }
        }
        const insert = (f) => db.run('INSERT INTO card_fields (project_id, key, label, kind, options, default_value, help) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [projectId, f.key, f.label, f.kind, JSON.stringify(f.options || []), '', f.help || '']);
        const keys = [];
        for (const f of cardModel.STANDARD_FIELDS) { insert(f); keys.push(f.key); }
        for (const [k, vals] of used) { insert({ key: k, label: labelFromKey(k), kind: cardModel.inferKind(vals) }); keys.push(k); }
        db.run('INSERT INTO card_types (project_id, name, color, sort_order, field_keys) VALUES (?, ?, ?, 0, ?)',
          [projectId, 'Card', cardModel.DEFAULT_COLORS[0], JSON.stringify(keys)]);
        const typeId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        db.run('UPDATE cards SET card_type_id = ? WHERE project_id = ?', [typeId, projectId]);
        log(`project ${projectId}: card type "Card" with ${keys.length} fields${used.size ? ` (custom: ${[...used.keys()].join(', ')})` : ''}`);
      }
    },
  },
  {
    version: 6,
    name: 'fit cache',
    // Spec data model: fit_cache holds each card's fit results (electron/fitCache.js). Computed
    // data only; nothing existing changes.
    up(db) {
      db.run(`
        CREATE TABLE IF NOT EXISTS fit_cache (
          card_id           INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
          project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          template_id       INTEGER,
          template_version  INTEGER,
          data_hash         TEXT NOT NULL,
          results_json      TEXT NOT NULL DEFAULT '{}',
          computed_at       TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fit_cache_project ON fit_cache(project_id);
      `);
    },
  },
];

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function getVersion(db) {
  return db.exec('PRAGMA user_version')[0].values[0][0];
}

/**
 * Bring db up to LATEST_VERSION. Does not save; the caller persists once afterwards.
 * @returns {{ from: number, to: number, backup: string|null, applied: string[] }}
 */
function runMigrations(db, { dbPath, userDataPath, log = () => {} } = {}) {
  const from = getVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from, backup: null, applied: [] };

  let backup = null;
  if (dbPath && fs.existsSync(dbPath)) {
    backup = `${dbPath}.bak-v${from}`;
    if (!fs.existsSync(backup)) fs.copyFileSync(dbPath, backup);
  }

  db.run('BEGIN');
  try {
    for (const m of pending) {
      m.up(db, { userDataPath, log });
      db.run(`PRAGMA user_version = ${m.version}`);
    }
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw new Error(`database migration failed (still at version ${from}): ${err.message}`);
  }
  return { from, to: getVersion(db), backup, applied: pending.map((m) => `v${m.version} ${m.name}`) };
}

module.exports = { runMigrations, getVersion, LATEST_VERSION, MIGRATIONS };
