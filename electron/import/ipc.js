// IPC for the CSV/XLSX card import:
//   readSpreadsheet(projectId, { inputPath?, token?, sheet?, headerRow? })
//     -> { token, fileName, kind, sheets, sheet, headers, sampleRows, rowCount, suggestedMapping }
//   previewImport(token, mapping, options) -> { counts, rows (first 200), totalRows, newTypes, newFields, typeFieldAdds }
//   commitImport(token, mapping, options)  -> { created, updated, skipped, empty, newTypes, newFields }
// Columns map onto the project's card model (fields, card type); see cardImport.js.
// The file is read once and held under a token until it is imported (or another file is read).

const fs = require('fs');
const path = require('path');
const { readCsv } = require('./csv');
const { readXlsx } = require('./xlsx');
const cardImport = require('./cardImport');

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const PREVIEW_ROWS = 200;
const SAMPLE_ROWS = 8;

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
 * deps: { queryCards(projectId), getCardModel(projectId), importCards(projectId, plan), dialog, getWindow }
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
    return {
      token, fileName: p.fileName, kind: p.file.kind, sheets: p.file.sheets, sheet: p.sheet, headerRow: p.headerRow,
      headers: table.headers, sampleRows: table.rows.slice(0, SAMPLE_ROWS), rowCount: table.rows.length,
      suggestedMapping: cardImport.suggestMapping(table, deps.getCardModel(p.projectId)),
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

  const plan = (p, mapping, options) => cardImport.buildPlan(tableOf(p), mapping, deps.queryCards(p.projectId, {}), deps.getCardModel(p.projectId), {
    matchBy: options.matchBy === 'none' ? 'none' : 'name',
    blankClears: Boolean(options.blankClears),
    typeId: options.typeId,
    createTypes: options.createTypes !== false,
    addFieldsToTypes: options.addFieldsToTypes !== false,
  });

  ipcMain.handle('previewImport', (_, token, mapping, options = {}) => {
    const p = get(token);
    const { rows, counts, newTypes, newFields, typeFieldAdds } = plan(p, mapping, options);
    return { counts, rows: rows.slice(0, PREVIEW_ROWS), totalRows: rows.length, newTypes, newFields, typeFieldAdds };
  });

  ipcMain.handle('commitImport', (_, token, mapping, options = {}) => {
    const p = get(token);
    const planned = plan(p, mapping, options);
    const res = deps.importCards(p.projectId, { ...planned, rows: planned.rows.filter((r) => r.action !== 'skip') });
    pending.delete(token);
    return { ...res, skipped: planned.counts.skip, empty: planned.counts.empty };
  });
}

module.exports = { registerImportIpc, loadFile };
