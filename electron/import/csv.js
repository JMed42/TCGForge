// CSV / TSV reading for the card import (spec: "A one-time CSV/XLSX import").
// RFC 4180: quoted fields, doubled quotes, line breaks inside quotes, CRLF or LF. The delimiter
// (comma, semicolon or tab) is detected from the first lines. Bytes are read as UTF-8 (with or
// without BOM) or UTF-16 with BOM; anything that is not valid UTF-8 falls back to Windows-1252,
// which is what Excel writes for "CSV" on Western Windows.

const MAX_ROWS = 20000;
const MAX_COLS = 500;

// Windows-1252 differs from Latin-1 in 0x80-0x9F (curly quotes, dashes, euro...). Node's
// TextDecoder decodes that label as Latin-1, so the range is mapped here.
const CP1252 = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f'
  + '\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';
function decodeCp1252(bytes) {
  let out = '';
  for (const b of bytes) out += b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80] : String.fromCharCode(b);
  return out;
}

function decode(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  const body = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return decodeCp1252(body);
  }
}

// Count candidate delimiters outside quotes over the first few lines; the most frequent wins.
function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 10; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n')) lines++;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/** @returns {string[][]} rows of cells; a trailing empty line is dropped. */
function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let atFieldStart = true;
  const endField = () => {
    if (row.length >= MAX_COLS) throw new Error(`more than ${MAX_COLS} columns`);
    row.push(field);
    field = '';
    atFieldStart = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    if (rows.length > MAX_ROWS) throw new Error(`more than ${MAX_ROWS} rows`);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && atFieldStart) { inQuotes = true; atFieldStart = false; continue; }
    if (ch === delimiter) { endField(); continue; }
    if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); continue; }
    if (ch === '\n') { endRow(); continue; }
    field += ch;
    atFieldStart = false;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

function readCsv(buf) {
  const text = decode(buf);
  const delimiter = detectDelimiter(text);
  return { delimiter, rows: parseCsv(text, delimiter) };
}

module.exports = { decode, detectDelimiter, parseCsv, readCsv, MAX_ROWS, MAX_COLS };
