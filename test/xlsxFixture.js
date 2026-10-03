// Builds small .xlsx files (and arbitrary zips) for the import tests with Node's zlib.

const zlib = require('zlib');
const { crc32 } = require('../electron/cardDesigner/pngDpi');

function zip(files, { store = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const data = store ? raw : zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// sheets: [{ name, rows: [[cell...]] }]; a cell is a string (shared string), number, boolean,
// { inline: 'text' }, { formula: 'A1*2', value: 4 }, { rich: ['a', 'b'] } (shared, rich runs) or null.
function xlsx(sheets) {
  const shared = [];
  const sharedIndex = (s) => { const i = shared.indexOf(s); if (i >= 0) return i; shared.push(s); return shared.length - 1; };
  const col = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  const sheetXml = sheets.map((sheet) => {
    const rows = sheet.rows.map((cells, r) => {
      if (!cells) return '';
      const cs = cells.map((v, c) => {
        const ref = `${col(c)}${r + 1}`;
        if (v === null || v === undefined) return '';
        if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
        if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
        if (typeof v === 'object' && 'inline' in v) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v.inline)}</t></is></c>`;
        if (typeof v === 'object' && 'formula' in v) return `<c r="${ref}"><f>${esc(v.formula)}</f><v>${v.value}</v></c>`;
        if (typeof v === 'object' && 'rich' in v) return `<c r="${ref}" t="s"><v>${sharedIndex({ rich: v.rich })}</v></c>`;
        return `<c r="${ref}" t="s"><v>${sharedIndex(v)}</v></c>`;
      }).join('');
      return `<row r="${r + 1}">${cs}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  const sst = shared.map((s) => (typeof s === 'object'
    ? `<si>${s.rich.map((t) => `<r><rPr><b/></rPr><t xml:space="preserve">${esc(t)}</t></r>`).join('')}<rPh><t>ignored</t></rPh></si>`
    : `<si><t xml:space="preserve">${esc(s)}</t></si>`)).join('');
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="${NS_R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/sharedStrings.xml', `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sst}</sst>`],
    ...sheetXml.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x]),
  ]);
}

module.exports = { zip, xlsx };
