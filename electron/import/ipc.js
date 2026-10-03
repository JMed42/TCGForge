// IPC for the CSV/XLSX card import:
//   readSpreadsheet(projectId, { inputPath?, token?, sheet?, headerRow? })
//     -> { token, fileName, kind, sheets, sheet, headers, sampleRows, rowCount, suggestedMapping, customFields }
//   previewImport(token, mapping, options) -> { counts, rows (first 200), totalRows }
//   commitImport(token, mapping, options)  -> { created, updated, skipped, empty }
// The file is read once and held under a token until it is imported (or another file is read).

const fs = require('fs');
const path = require('path');
const { readCsv } = require('./csv');
const { readXlsx } = require('./xlsx');
const cardImport = require('./cardImport');

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const PREVIEW_ROWS = 200;
const SAMPLE_ROWS = 8;

function customFieldsOf(cards, cardSchema) {
  const names = new Set();
  let schema = cardSchema;
  try { if (typeof schema === 'string') schema = JSON.parse(schema); } catch { schema = null; }
  const fields = Array.isArray(schema?.fields) ? schema.fields : Array.isArray(schema) ? schema : [];
  for (const f of fields) if (f && f.name && !cardImport.BUILTIN_FIELDS.includes(f.name) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name)) names.add(f.name);
  for (const c of cards) {
    try { for (const k of Object.keys(JSON.parse(c.custom_fields || '{}'))) names.add(k); } catch { /* ignore */ }
  }
  return [...names];
}

function loadFile(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) throw new Error('the file is larger than 50 MB');
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xlsm') {
    const wb = readXlsx(buf);
    return { kind: 'xlsx', sheets: wb.sheetNames, read: (sheet) => wb.readSheet(sheet ?? 0) };
  }
  if (ext === '.xls') throw new Error('old .xls files are not supported; save as .xlsx or .csv');
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) throw new Error('this looks like an .xlsx file; rename it to .xlsx');
  const { rows, delimiter } = readCsv(buf);
  return { kind: delimiter === '\t' ? 'tsv' : 'csv', sheets: [], read: () => rows };
}

/**
 * deps: { queryCards(projectId), getProject(projectId), importCards(projectId, planRows), dialog, getWindow }
 */
function registerImportIpc(ipcMain, deps) {
  let seq = 0;
  const pending = new Map(); // token -> { projectId, fileName, file, sheet, headerRow, table }

  const tableOf = (p) => {
    if (!p.table) p.table = cardImport.toTable(p.file.read(p.sheet), p.headerRow);
    return p.table;
  };

  const describe = (token, p) => {
    const table = tableOf(p);
    const cards = deps.queryCards(p.projectId, {});
    const customFields = customFieldsOf(cards, deps.getProject(p.projectId)?.card_schema);
    return {
      token, fileName: p.fileName, kind: p.file.kind, sheets: p.file.sheets, sheet: p.sheet, headerRow: p.headerRow,
      headers: table.headers, sampleRows: table.rows.slice(0, SAMPLE_ROWS), rowCount: table.rows.length,
      suggestedMapping: cardImport.suggestMapping(table.headers, customFields), customFields,
    };
  };

  const get = (token) => {
    const p = pending.get(token);
    if (!p) throw new Error('import expired; choose the file again');
    return p;
  };

  ipcMain.handle('readSpreadsheet', async (_, projectId, options = {}) => {
    if (options.token) {
      const p = get(options.token);
      if (options.sheet !== undefined && options.sheet !== p.sheet) {
        if (!p.file.sheets.includes(options.sheet)) throw new Error(`no sheet "${options.sheet}"`);
        p.sheet = options.sheet;
        p.table = null;
      }
      if (options.headerRow !== undefined && Boolean(options.headerRow) !== p.headerRow) { p.headerRow = Boolean(options.headerRow); p.table = null; }
      return describe(options.token, p);
    }
    let inputPath = options.inputPath;
    if (!inputPath) {
      const res = await deps.dialog.showOpenDialog(deps.getWindow(), {
        title: 'Import cards from a spreadsheet',
        properties: ['openFile'],
        filters: [{ name: 'Spreadsheets', extensions: ['csv', 'tsv', 'txt', 'xlsx'] }],
      });
      if (res.canceled || !res.filePaths[0]) return { canceled: true };
      inputPath = res.filePaths[0];
    }
    const file = loadFile(inputPath);
    const token = `sheet-${++seq}`;
    pending.clear(); // one import at a time
    const p = { projectId, fileName: path.basename(inputPath), file, sheet: file.sheets[0] ?? null, headerRow: options.headerRow !== false, table: null };
    pending.set(token, p);
    return describe(token, p);
  });

  const plan = (p, mapping, options) => cardImport.buildPlan(tableOf(p), mapping, deps.queryCards(p.projectId, {}), {
    matchBy: options.matchBy === 'none' ? 'none' : 'name',
    blankClears: Boolean(options.blankClears),
  });

  ipcMain.handle('previewImport', (_, token, mapping, options = {}) => {
    const p = get(token);
    const { rows, counts } = plan(p, mapping, options);
    return { counts, rows: rows.slice(0, PREVIEW_ROWS), totalRows: rows.length };
  });

  ipcMain.handle('commitImport', (_, token, mapping, options = {}) => {
    const p = get(token);
    const { rows, counts } = plan(p, mapping, options);
    const res = deps.importCards(p.projectId, rows.filter((r) => r.action !== 'skip'));
    pending.delete(token);
    return { ...res, skipped: counts.skip, empty: counts.empty };
  });
}

module.exports = { registerImportIpc, loadFile, customFieldsOf };
