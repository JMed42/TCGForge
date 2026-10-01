const path = require('path');
const fs = require('fs');
const { DB_FILE } = require('./legacyData');

let db;
let dbPath;

// Helper: run a query and return all rows as objects
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: run a query and return a single row as an object (or null)
function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

// Helper: run an INSERT/UPDATE/DELETE, save to disk, return last insert rowid
function run(sql, params = []) {
  db.run(sql, params);
  const result = queryOne('SELECT last_insert_rowid() as id');
  saveDatabase();
  return result ? result.id : null;
}

// Persist the in-memory database to disk
function saveDatabase() {
  if (!dbPath) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

async function initDatabase(userDataPath) {
  const initSqlJs = require('sql.js');
  // Tell sql.js exactly where to find the WASM binary
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
  });

  dbPath = path.join(userDataPath, DB_FILE);

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      card_schema TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT DEFAULT '',
      set_name TEXT DEFAULT '',
      rarity TEXT DEFAULT '',
      cost TEXT DEFAULT '',
      power TEXT DEFAULT '',
      toughness TEXT DEFAULT '',
      rules_text TEXT DEFAULT '',
      flavor_text TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      custom_fields TEXT DEFAULT '{}',
      notes TEXT DEFAULT '',
      image_path TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      parent_id INTEGER,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'document',
      content TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cards_project ON cards(project_id);
    CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);
    CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_name);
    CREATE INDEX IF NOT EXISTS idx_docs_project ON documents(project_id);
    CREATE INDEX IF NOT EXISTS idx_docs_parent ON documents(parent_id);
  `);

  saveDatabase();
}

// Cards for a project, applying the Card Database filter object. Shared with the Card Designer
// batch export so "export all" uses exactly the list the user sees.
function queryCards(projectId, filters = {}) {
  let sql = 'SELECT * FROM cards WHERE project_id = ?';
  const params = [projectId];

  if (filters.search) {
    sql += ' AND (name LIKE ? OR rules_text LIKE ?)';
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.type)   { sql += ' AND type = ?';     params.push(filters.type); }
  if (filters.set)    { sql += ' AND set_name = ?';  params.push(filters.set); }
  if (filters.rarity) { sql += ' AND rarity = ?';   params.push(filters.rarity); }
  if (filters.tags)   { sql += ' AND tags LIKE ?';  params.push(`%${filters.tags}%`); }

  const colMap = { name: 'name', type: 'type', set: 'set_name', cost: 'cost', created: 'created_at', updated: 'updated_at' };
  const sortCol = colMap[filters.sortBy] || 'name';
  const sortDir = filters.sortDir === 'DESC' ? 'DESC' : 'ASC';
  sql += ` ORDER BY ${sortCol} ${sortDir}`;

  return queryAll(sql, params);
}

function getCard(id) {
  return queryOne('SELECT * FROM cards WHERE id = ?', [id]);
}

function registerIpcHandlers(ipcMain) {
  // ── PROJECTS ──────────────────────────────────────────────

  ipcMain.handle('getProjects', () => {
    return queryAll('SELECT * FROM projects ORDER BY updated_at DESC');
  });

  ipcMain.handle('getProject', (_, id) => {
    return queryOne('SELECT * FROM projects WHERE id = ?', [id]);
  });

  ipcMain.handle('createProject', (_, data) => {
    // cardSchema may arrive as an object (parsed JSON) or a string — always store as string
    const schemaStr = typeof data.cardSchema === 'string'
      ? data.cardSchema
      : JSON.stringify(data.cardSchema || []);
    const id = run(
      'INSERT INTO projects (name, description, card_schema) VALUES (?, ?, ?)',
      [String(data.name || ''), String(data.description || ''), schemaStr]
    );
    return queryOne('SELECT * FROM projects WHERE id = ?', [id]);
  });

  ipcMain.handle('updateProject', (_, id, data) => {
    const fields = [];
    const values = [];
    if (data.name !== undefined)        { fields.push('name = ?');        values.push(data.name); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.cardSchema !== undefined)  {
      fields.push('card_schema = ?');
      values.push(typeof data.cardSchema === 'string' ? data.cardSchema : JSON.stringify(data.cardSchema));
    }
    fields.push("updated_at = datetime('now')");
    values.push(id);
    run(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, values);
    return queryOne('SELECT * FROM projects WHERE id = ?', [id]);
  });

  ipcMain.handle('deleteProject', (_, id) => {
    const cards = queryAll('SELECT id FROM cards WHERE project_id = ?', [id]);
    for (const c of cards) run('DELETE FROM cards WHERE id = ?', [c.id]);
    const docs = queryAll('SELECT id FROM documents WHERE project_id = ?', [id]);
    for (const d of docs) run('DELETE FROM documents WHERE id = ?', [d.id]);
    run('DELETE FROM projects WHERE id = ?', [id]);
  });

  // ── CARDS ─────────────────────────────────────────────────

  ipcMain.handle('getCards', (_, projectId, filters = {}) => {
    return queryCards(projectId, filters);
  });

  ipcMain.handle('getCard', (_, id) => {
    return getCard(id);
  });

  ipcMain.handle('createCard', (_, projectId, data) => {
    const id = run(
      `INSERT INTO cards (project_id, name, type, set_name, rarity, cost, power, toughness,
        rules_text, flavor_text, tags, custom_fields, notes, image_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [projectId, data.name, data.type || '', data.set_name || '', data.rarity || '',
       data.cost || '', data.power || '', data.toughness || '', data.rules_text || '',
       data.flavor_text || '', data.tags || '',
       typeof data.custom_fields === 'string' ? data.custom_fields : JSON.stringify(data.custom_fields || {}),
       data.notes || '', data.image_path || '']
    );
    return queryOne('SELECT * FROM cards WHERE id = ?', [id]);
  });

  ipcMain.handle('updateCard', (_, id, data) => {
    const allowed = ['name','type','set_name','rarity','cost','power','toughness',
                     'rules_text','flavor_text','tags','custom_fields','notes','image_path'];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (data[key] !== undefined) { fields.push(`${key} = ?`); values.push(data[key]); }
    }
    if (fields.length === 0) return queryOne('SELECT * FROM cards WHERE id = ?', [id]);
    fields.push("updated_at = datetime('now')");
    values.push(id);
    run(`UPDATE cards SET ${fields.join(', ')} WHERE id = ?`, values);
    return queryOne('SELECT * FROM cards WHERE id = ?', [id]);
  });

  ipcMain.handle('deleteCard', (_, id) => {
    run('DELETE FROM cards WHERE id = ?', [id]);
  });

  ipcMain.handle('bulkDeleteCards', (_, ids) => {
    for (const id of ids) run('DELETE FROM cards WHERE id = ?', [id]);
  });

  ipcMain.handle('duplicateCard', (_, id) => {
    const card = queryOne('SELECT * FROM cards WHERE id = ?', [id]);
    if (!card) return null;
    const newId = run(
      `INSERT INTO cards (project_id, name, type, set_name, rarity, cost, power, toughness,
        rules_text, flavor_text, tags, custom_fields, notes, image_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [card.project_id, card.name + ' (Copy)', card.type, card.set_name, card.rarity,
       card.cost, card.power, card.toughness, card.rules_text, card.flavor_text,
       card.tags, card.custom_fields, card.notes, card.image_path]
    );
    return queryOne('SELECT * FROM cards WHERE id = ?', [newId]);
  });

  // ── DOCUMENTS ─────────────────────────────────────────────

  ipcMain.handle('getDocuments', (_, projectId) => {
    return queryAll(
      'SELECT * FROM documents WHERE project_id = ? ORDER BY sort_order, title',
      [projectId]
    );
  });

  ipcMain.handle('getDocument', (_, id) => {
    return queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  });

  ipcMain.handle('createDocument', (_, projectId, data) => {
    const id = run(
      'INSERT INTO documents (project_id, parent_id, title, type, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [projectId, data.parentId || null, data.title, data.type || 'document',
       data.content || '', data.sort_order || 0]
    );
    return queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  });

  ipcMain.handle('updateDocument', (_, id, data) => {
    const fields = [];
    const values = [];
    if (data.title      !== undefined) { fields.push('title = ?');     values.push(data.title); }
    if (data.type       !== undefined) { fields.push('type = ?');      values.push(data.type); }
    if (data.content    !== undefined) { fields.push('content = ?');   values.push(data.content); }
    if (data.sort_order !== undefined) { fields.push('sort_order = ?');values.push(data.sort_order); }
    if (data.parentId   !== undefined) { fields.push('parent_id = ?'); values.push(data.parentId); }
    if (data.parent_id  !== undefined) { fields.push('parent_id = ?'); values.push(data.parent_id); }
    if (fields.length === 0) return queryOne('SELECT * FROM documents WHERE id = ?', [id]);
    fields.push("updated_at = datetime('now')");
    values.push(id);
    run(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`, values);
    return queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  });

  ipcMain.handle('deleteDocument', (_, id) => {
    const deleteRecursive = (docId) => {
      const children = queryAll('SELECT id FROM documents WHERE parent_id = ?', [docId]);
      for (const child of children) deleteRecursive(child.id);
      run('DELETE FROM documents WHERE id = ?', [docId]);
    };
    deleteRecursive(id);
  });

  ipcMain.handle('moveDocument', (_, id, newParentId) => {
    run("UPDATE documents SET parent_id = ?, updated_at = datetime('now') WHERE id = ?",
        [newParentId, id]);
    return queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  });

  ipcMain.handle('searchDocuments', (_, projectId, query) => {
    return queryAll(
      'SELECT * FROM documents WHERE project_id = ? AND (title LIKE ? OR content LIKE ?) ORDER BY title',
      [projectId, `%${query}%`, `%${query}%`]
    );
  });

  // ── IMPORT / EXPORT ───────────────────────────────────────

  ipcMain.handle('exportProject', (_, projectId) => {
    const project   = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
    const cards     = queryAll('SELECT * FROM cards WHERE project_id = ?', [projectId]);
    const documents = queryAll('SELECT * FROM documents WHERE project_id = ?', [projectId]);
    return JSON.stringify({ project, cards, documents }, null, 2);
  });

  ipcMain.handle('importProject', (_, jsonData) => {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

    const newProjectId = run(
      'INSERT INTO projects (name, description, card_schema) VALUES (?, ?, ?)',
      [data.project.name + ' (Imported)', data.project.description || '', data.project.card_schema || '[]']
    );

    const idMap = {};
    for (const doc of (data.documents || [])) {
      const mappedParent = doc.parent_id ? (idMap[doc.parent_id] || null) : null;
      const newDocId = run(
        'INSERT INTO documents (project_id, parent_id, title, type, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        [newProjectId, mappedParent, doc.title, doc.type, doc.content || '', doc.sort_order || 0]
      );
      idMap[doc.id] = newDocId;
    }

    for (const card of (data.cards || [])) {
      run(
        `INSERT INTO cards (project_id, name, type, set_name, rarity, cost, power, toughness,
          rules_text, flavor_text, tags, custom_fields, notes, image_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newProjectId, card.name, card.type || '', card.set_name || '', card.rarity || '',
         card.cost || '', card.power || '', card.toughness || '', card.rules_text || '',
         card.flavor_text || '', card.tags || '', card.custom_fields || '{}',
         card.notes || '', card.image_path || '']
      );
    }

    return queryOne('SELECT * FROM projects WHERE id = ?', [newProjectId]);
  });

  ipcMain.handle('exportCards', (_, projectId, format) => {
    const cards = queryAll('SELECT * FROM cards WHERE project_id = ?', [projectId]);
    if (format === 'csv') {
      const headers = ['name','type','set_name','rarity','cost','power','toughness',
                       'rules_text','flavor_text','tags','notes'];
      const rows = cards.map(c =>
        headers.map(h => `"${(c[h] || '').replace(/"/g, '""')}"`).join(',')
      );
      return [headers.join(','), ...rows].join('\n');
    }
    return JSON.stringify(cards, null, 2);
  });
}

module.exports = { initDatabase, registerIpcHandlers, queryCards, getCard };
