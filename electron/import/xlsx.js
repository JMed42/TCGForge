// Minimal .xlsx reader for the card import, with no dependency: a zip directory reader
// (stored or deflated entries, inflated with Node's zlib) and a small XML scanner for the
// workbook, its relationships, shared strings, number formats and worksheets. Cell values only:
// text, numbers, booleans, errors and the cached results of formulas. Cells with a date number
// format become ISO dates ("2026-01-01", or "2026-01-01 14:30" with a time).
//
// Hostile files: sizes and entry counts are capped before inflating, encrypted and zip64
// archives are refused, and entry names are only ever looked up, never written to disk.

const zlib = require('zlib');
const { MAX_ROWS, MAX_COLS } = require('./csv');

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_ENTRIES = 5000;

// ----- zip -----

function readZip(buf) {
  if (buf.length > MAX_FILE_BYTES) throw new Error('the file is larger than 50 MB');
  // End of central directory: last 22..65557 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not an .xlsx file (no zip directory)');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip64 files are not supported');
  if (count > MAX_ENTRIES) throw new Error('too many entries in the file');
  if (cdOffset + cdSize > buf.length) throw new Error('damaged zip directory');
  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip directory');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name.replace(/\\/g, '/'), { flags, method, compSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  let inflated = 0;
  const read = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new Error('encrypted workbooks are not supported');
    if (e.size > MAX_ENTRY_BYTES || e.compSize === 0xffffffff) throw new Error(`${name} is too large`);
    const lh = e.localOffset;
    if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) throw new Error('damaged zip entry');
    const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
    const data = buf.subarray(start, start + e.compSize);
    if (data.length !== e.compSize) throw new Error('damaged zip entry');
    let out;
    if (e.method === 0) out = data;
    else if (e.method === 8) {
      try {
        out = zlib.inflateRawSync(data, { maxOutputLength: Math.min(MAX_ENTRY_BYTES, MAX_TOTAL_BYTES - inflated) + 1 });
      } catch (err) {
        throw new Error(/buffer|length/i.test(err.message) ? `${name} is too large` : `damaged zip entry ${name}`);
      }
    } else throw new Error(`unsupported zip compression (method ${e.method})`);
    inflated += out.length;
    if (out.length > MAX_ENTRY_BYTES || inflated > MAX_TOTAL_BYTES) throw new Error('the workbook is too large when unpacked');
    return out.toString('utf8');
  };
  return { names: [...entries.keys()], read };
}

// ----- xml -----

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decodeXml(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

function attrs(s) {
  const out = Object.create(null);
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = decodeXml(m[3] ?? m[4]);
  return out;
}

// Walk tags in document order: onOpen(name, attrs, selfClosing), onClose(name), onText(text).
// Names lose their namespace prefix. Comments, PIs and CDATA are handled; DTDs are ignored.
function scan(xml, { onOpen = () => {}, onClose = () => {}, onText = () => {} }) {
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { onText(decodeXml(xml.slice(i))); break; }
    if (lt > i) onText(decodeXml(xml.slice(i, lt)));
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt); i = e < 0 ? xml.length : e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt); onText(xml.slice(lt + 9, e < 0 ? xml.length : e)); i = e < 0 ? xml.length : e + 3; continue; }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') { const e = xml.indexOf('>', lt); i = e < 0 ? xml.length : e + 1; continue; }
    const gt = xml.indexOf('>', lt);
    if (gt < 0) break;
    const body = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (body[0] === '/') { onClose(body.slice(1).trim().replace(/^[\w.-]+:/, '')); continue; }
    const self = body.endsWith('/');
    const inner = self ? body.slice(0, -1) : body;
    const sp = inner.search(/\s/);
    const name = (sp < 0 ? inner : inner.slice(0, sp)).replace(/^[\w.-]+:/, '');
    onOpen(name, attrs(sp < 0 ? '' : inner.slice(sp)), self);
    if (self) onClose(name);
  }
}

// ----- workbook -----

function relsOf(xml) {
  const map = new Map();
  if (!xml) return map;
  scan(xml, { onOpen: (n, a) => { if (n === 'Relationship' && a.Id) map.set(a.Id, { target: a.Target || '', type: a.Type || '' }); } });
  return map;
}

function resolvePath(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (baseDir ? baseDir.split('/') : []).concat(target.split('/'));
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

function sharedStrings(xml) {
  const list = [];
  if (!xml) return list;
  let cur = null;
  let inT = false;
  let skip = 0; // phonetic runs (rPh) are not part of the value
  scan(xml, {
    onOpen: (n) => {
      if (n === 'si') cur = '';
      else if (n === 'rPh') skip++;
      else if (n === 't' && cur !== null && !skip) inT = true;
    },
    onClose: (n) => {
      if (n === 'si') { list.push(cur ?? ''); cur = null; } else if (n === 'rPh') skip--;
      else if (n === 't') inT = false;
    },
    onText: (t) => { if (inT) cur += t; },
  });
  return list;
}

// Style index -> is a date format. Built-in date formats are ids 14-22 and 45-47; custom ones
// are recognised by d/m/y/h/s outside quotes, escapes and [colour] sections.
function dateStyles(xml) {
  const isDate = [];
  if (!xml) return isDate;
  const custom = new Map();
  let inXfs = false;
  scan(xml, {
    onOpen: (n, a) => {
      if (n === 'numFmt') custom.set(Number(a.numFmtId), a.formatCode || '');
      else if (n === 'cellXfs') inXfs = true;
      else if (n === 'xf' && inXfs) {
        const id = Number(a.numFmtId || 0);
        const code = custom.get(id);
        const builtin = (id >= 14 && id <= 22) || (id >= 45 && id <= 47);
        const customDate = code !== undefined && /[dmyhs]/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ''));
        isDate.push(builtin || customDate);
      }
    },
    onClose: (n) => { if (n === 'cellXfs') inXfs = false; },
  });
  return isDate;
}

// Excel serial (1900 date system) -> "YYYY-MM-DD" or "YYYY-MM-DD HH:MM".
function serialToIso(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return v;
  const ms = Math.round((n - 25569) * 86400) * 1000; // 25569 = 1970-01-01
  const d = new Date(ms);
  const pad = (x) => String(x).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return Number.isInteger(n) ? date : `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function numberText(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
}

function sheetRows(xml, strings, isDate = []) {
  const rows = [];
  let row = null;
  let rowIdx = -1;
  let cell = null; // { col, type, v, inline }
  let into = null; // 'v' | 't'
  let skip = 0;
  scan(xml, {
    onOpen: (n, a, self) => {
      if (n === 'row') {
        const r = Number(a.r);
        rowIdx = Number.isInteger(r) && r > 0 ? r - 1 : rowIdx + 1;
        if (rowIdx >= MAX_ROWS + 1) throw new Error(`more than ${MAX_ROWS} rows`);
        row = [];
        rows[rowIdx] = row;
        if (self) row = null;
      } else if (n === 'c' && row) {
        const c = colIndex(a.r);
        const col = c >= 0 ? c : row.length;
        if (col >= MAX_COLS) throw new Error(`more than ${MAX_COLS} columns`);
        cell = { col, type: a.t || 'n', v: '', inline: '', date: Boolean(isDate[Number(a.s || 0)]) };
        if (self) { cell = null; }
      } else if (n === 'rPh') skip++;
      else if (cell && n === 'v') into = 'v';
      else if (cell && n === 't' && !skip) into = 't';
    },
    onClose: (n) => {
      if (n === 'v' || n === 't') into = null;
      else if (n === 'rPh') skip--;
      else if (n === 'c' && cell && row) {
        let value;
        switch (cell.type) {
          case 's': value = strings[Number(cell.v)] ?? ''; break;
          case 'inlineStr': value = cell.inline; break;
          case 'b': value = cell.v === '1' ? 'TRUE' : 'FALSE'; break;
          case 'str': case 'e': value = cell.v; break;
          default: value = cell.v === '' ? '' : cell.date ? serialToIso(cell.v) : numberText(cell.v);
        }
        row[cell.col] = value;
        cell = null;
      } else if (n === 'row') row = null;
    },
    onText: (t) => {
      if (!cell) return;
      if (into === 'v') cell.v += t;
      else if (into === 't') cell.inline += t;
    },
  });
  // Dense rows: holes become empty strings.
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const dense = [];
    for (let j = 0; j < r.length; j++) dense.push(r[j] ?? '');
    out.push(dense);
  }
  return out;
}

/**
 * @returns {{ sheetNames: string[], readSheet(nameOrIndex): string[][] }}
 */
function readXlsx(buf) {
  const zip = readZip(buf);
  const rootRels = relsOf(zip.read('_rels/.rels'));
  let workbookPath = 'xl/workbook.xml';
  for (const r of rootRels.values()) if (/officeDocument$/.test(r.type)) workbookPath = resolvePath('', r.target);
  const workbook = zip.read(workbookPath);
  if (!workbook) throw new Error('not an .xlsx workbook');
  const baseDir = workbookPath.includes('/') ? workbookPath.slice(0, workbookPath.lastIndexOf('/')) : '';
  const relsPath = `${baseDir ? `${baseDir}/` : ''}_rels/${workbookPath.slice(baseDir ? baseDir.length + 1 : 0)}.rels`;
  const rels = relsOf(zip.read(relsPath));
  const sheets = [];
  scan(workbook, {
    onOpen: (n, a) => {
      if (n !== 'sheet') return;
      const rid = a['r:id'] ?? a.id ?? Object.entries(a).find(([k]) => k.endsWith(':id'))?.[1];
      const rel = rels.get(rid);
      if (rel) sheets.push({ name: a.name || `Sheet${sheets.length + 1}`, path: resolvePath(baseDir, rel.target) });
    },
  });
  if (!sheets.length) throw new Error('the workbook has no worksheets');
  let strings = null;
  let dates = null;
  const stringsPath = [...rels.values()].find((r) => /sharedStrings$/.test(r.type));
  const stylesPath = [...rels.values()].find((r) => /\/styles$/.test(r.type));
  return {
    sheetNames: sheets.map((s) => s.name),
    readSheet(which = 0) {
      const sheet = typeof which === 'number' ? sheets[which] : sheets.find((s) => s.name === which);
      if (!sheet) throw new Error(`no sheet "${which}"`);
      if (!strings) strings = sharedStrings(stringsPath ? zip.read(resolvePath(baseDir, stringsPath.target)) : zip.read(`${baseDir}/sharedStrings.xml`));
      if (!dates) dates = dateStyles(stylesPath ? zip.read(resolvePath(baseDir, stylesPath.target)) : null);
      const xml = zip.read(sheet.path);
      if (xml === null) throw new Error(`sheet "${sheet.name}" is missing from the file`);
      return sheetRows(xml, strings, dates);
    },
  };
}

module.exports = { readXlsx, readZip, scan, decodeXml, colIndex, dateStyles, serialToIso };
