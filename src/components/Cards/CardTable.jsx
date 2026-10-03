import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Pencil, Copy, Trash2, Columns3, Check } from 'lucide-react';
import { useStore } from '../../store';
import { getFieldRaw, getFieldValue } from './grid/cardFields';
import { markEdit } from './grid/liveTiming';
import { gridColumns, makeApplicable, useFilteredCards } from './grid/columns';
import { inRange, parseCellValue, parseTsv, planClear, planFillDown, planPaste, rangeOf, toTsv } from './grid/gridOps';
import { isNumeric } from '../../cardModel/model';
import { FitCell, FitProgress } from '../Fit/FitStatus';
import { plainFitOf, summaryOf, useLayerLabels } from '../Fit/useFit';
import { compareHardness, shortFit } from '../../designer/fit/summary.ts';

// The Database tab: every card in a spreadsheet grid, columns from the card types' fields.
//   Arrows / Tab / Enter move · Shift+arrows, Shift+click or drag select a range
//   Enter, F2, double-click or typing edits · Esc cancels · Space toggles Yes/No
//   Ctrl+C / Ctrl+V copy and paste (Excel, Sheets) · Ctrl+D fills down · Delete clears
//   Ctrl+Z / Ctrl+Y undo and redo; a paste or fill is one step
// Cells a card's type doesn't use are greyed and skipped.

const hiddenKey = (projectId) => `tcgforge.hiddenColumns.${projectId}`;
function loadHidden(projectId) {
  try { return new Set(JSON.parse(localStorage.getItem(hiddenKey(projectId)) || '[]')); } catch { return new Set(); }
}

function CellDisplay({ card, col, types, labels }) {
  if (col.kind === 'fit') return <FitCell cardId={card.id} labels={labels} />;
  if (col.kind === 'cardType') {
    const t = types.find((x) => x.id === card.card_type_id);
    return t ? <span className="inline-flex items-center gap-1.5 text-text-secondary"><span className="w-2 h-2 rounded-full" style={{ background: t.color }} />{t.name}</span> : <span className="text-text-muted">—</span>;
  }
  const raw = getFieldRaw(card, col.key);
  if (col.kind === 'yesNo') return raw === true ? <Check size={15} className="text-success" /> : <span className="text-text-muted">—</span>;
  const value = getFieldValue(card, col.key);
  if (!value) return <span className="text-text-muted">—</span>;
  if (col.key === 'name') return <span className="font-semibold text-text-primary">{value}</span>;
  if (col.kind === 'tags') {
    return <span className="flex gap-1 overflow-hidden">{(card.tags || []).map((tag) => <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-accent/20 text-accent whitespace-nowrap">{tag}</span>)}</span>;
  }
  if (col.kind === 'image') return <span className="text-text-muted text-xs font-mono" title={value}>{value.split('/').pop()}</span>;
  if (col.kind === 'number' && !isNumeric(value)) return <span className="text-amber-400" title="Not a number">{value}</span>;
  if (col.kind === 'choice' && col.options.length && !col.options.includes(value)) return <span className="text-amber-400" title="Not one of the options">{value}</span>;
  return <span className="text-text-secondary">{value.replace(/\s*\n\s*/g, ' ⏎ ')}</span>;
}

// In-place editor. Typing renders live in the preview (store.liveEdit); Enter / Tab / blur
// commit, Escape cancels. Choice and card-type cells suggest their options.
function CellEditor({ card, col, initial, onDone }) {
  const [value, setValue] = useState(initial);
  const ref = useRef(null);
  const done = useRef(false);
  const multiline = col.kind === 'longText';
  const listId = col.options.length ? `opts-${col.key}` : undefined;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && multiline) { el.style.height = 'auto'; el.style.height = `${Math.min(240, el.scrollHeight + 2)}px`; }
  }, [value, multiline]);

  const finish = (commit, move) => {
    if (done.current) return;
    done.current = true;
    onDone(commit ? value : null, move);
  };
  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); finish(false, null); }
    else if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); finish(true, e.shiftKey ? 'up' : 'down'); }
    else if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? 'left' : 'right'); }
  };
  const onChange = (e) => {
    markEdit(e.timeStamp);
    setValue(e.target.value);
    if (col.kind !== 'cardType') useStore.getState().setLiveEdit(card.id, col.key, e.target.value);
  };
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <>
      <Tag
        ref={ref}
        data-testid="cell-editor"
        rows={multiline ? 1 : undefined}
        list={listId}
        className="absolute left-0 top-0 z-20 w-full min-w-[160px] px-2 py-1.5 bg-surface-0 border-2 border-accent rounded text-sm text-text-primary focus:outline-none resize-none shadow-lg"
        value={value}
        spellCheck={false}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={() => finish(true, null)}
      />
      {listId && <datalist id={listId}>{col.options.map((o) => <option key={o} value={o} />)}</datalist>}
    </>
  );
}

export default function CardTable() {
  const cards = useStore((s) => s.cards);
  const model = useStore((s) => s.cardModel);
  const selectedCardIds = useStore((s) => s.selectedCardIds);
  const filters = useStore((s) => s.cardFilters);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeCardId = useStore((s) => s.activeCardId);
  const cellError = useStore((s) => s.cellError);
  const actions = useStore.getState();
  const filtered = useFilteredCards();
  const labels = useLayerLabels();

  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });
  // Sorting by Fit needs every card's results; otherwise the grid doesn't follow them.
  const fitCacheForSort = useStore((s) => (sortConfig.key === 'fit' ? s.fitCache : null));
  const [hidden, setHidden] = useState(() => loadHidden(activeProjectId));
  const [cursorKey, setCursorKey] = useState('name');
  const [anchor, setAnchor] = useState(null); // { cardId, key } other corner of the range
  const [editing, setEditing] = useState(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const gridRef = useRef(null);
  const dragging = useRef(false);

  useEffect(() => { setHidden(loadHidden(activeProjectId)); }, [activeProjectId]);

  const allColumns = useMemo(() => gridColumns(model, filters.cardTypeId), [model, filters.cardTypeId]);
  const columns = useMemo(() => allColumns.filter((c) => c.key === 'name' || !hidden.has(c.key)), [allColumns, hidden]);
  const applicable = useMemo(() => makeApplicable(model), [model]);
  const toggleColumn = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    setHidden(next);
    try { localStorage.setItem(hiddenKey(activeProjectId), JSON.stringify([...next])); } catch { /* ignore */ }
  };

  const rows = useMemo(() => {
    const col = allColumns.find((c) => c.key === sortConfig.key) || { key: 'name', kind: 'text' };
    const dir = sortConfig.direction === 'asc' ? 1 : -1;
    if (col.kind === 'fit') {
      // Hardest first when ascending (problems on top); cards not checked yet last.
      const fitOf = plainFitOf(fitCacheForSort);
      const worst = new Map(filtered.map((c) => [c.id, fitOf(c)?.worst?.result || null]));
      return [...filtered].sort((a, b) => {
        const x = worst.get(a.id);
        const y = worst.get(b.id);
        if (!x || !y) return (x ? -1 : y ? 1 : 0) || a.id - b.id;
        return compareHardness(y, x) * dir || a.id - b.id;
      });
    }
    const typeName = new Map(model.types.map((t) => [t.id, t.name]));
    const val = (c) => (col.kind === 'cardType' ? typeName.get(c.card_type_id) || '' : getFieldValue(c, col.key));
    return [...filtered].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (col.kind === 'number' || ['cost', 'power', 'toughness'].includes(col.key)) {
        const an = isNumeric(av); const bn = isNumeric(bv);
        if (an && bn) return (Number(av) - Number(bv)) * dir || a.id - b.id;
        if (an !== bn) return an ? -1 : 1; // text such as "X" after numbers
      }
      const x = av.toLowerCase(); const y = bv.toLowerCase();
      return x < y ? -dir : x > y ? dir : a.id - b.id;
    });
  }, [filtered, sortConfig, allColumns, model.types, fitCacheForSort]);

  // Cursor and range as indexes into the current rows and columns.
  const rowIndex = rows.findIndex((c) => c.id === activeCardId);
  const colIndex = Math.max(0, columns.findIndex((c) => c.key === cursorKey));
  const anchorRow = anchor ? rows.findIndex((c) => c.id === anchor.cardId) : -1;
  const anchorCol = anchor ? columns.findIndex((c) => c.key === anchor.key) : -1;
  const range = rowIndex >= 0 && anchorRow >= 0 && anchorCol >= 0
    ? rangeOf({ row: anchorRow, col: anchorCol }, { row: rowIndex, col: colIndex })
    : rowIndex >= 0 ? { r0: rowIndex, r1: rowIndex, c0: colIndex, c1: colIndex } : null;

  useEffect(() => {
    if (rowIndex < 0 && rows.length) actions.setActiveCard(rows[0].id);
  }, [rowIndex, rows, actions]);
  useEffect(() => {
    if (columns.length && !columns.some((c) => c.key === cursorKey)) setCursorKey(columns[0].key);
  }, [columns, cursorKey]);
  useEffect(() => {
    const el = gridRef.current?.querySelector(`[data-cell="${activeCardId}:${cursorKey}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeCardId, cursorKey]);

  const moveTo = useCallback((r, c, extend = false) => {
    if (!rows.length) return;
    const row = Math.max(0, Math.min(rows.length - 1, r));
    const col = Math.max(0, Math.min(columns.length - 1, c));
    if (extend) { if (!anchor) setAnchor({ cardId: rows[Math.max(0, rowIndex)].id, key: columns[colIndex].key }); }
    else setAnchor(null);
    actions.setActiveCard(rows[row].id);
    setCursorKey(columns[col].key);
  }, [rows, columns, actions, anchor, rowIndex, colIndex]);

  const move = (dir, extend = false) => {
    const r = Math.max(0, rowIndex);
    if (dir === 'up') moveTo(r - 1, colIndex, extend);
    else if (dir === 'down') moveTo(r + 1, colIndex, extend);
    else if (dir === 'left') moveTo(r, colIndex - 1, extend);
    else if (dir === 'right') moveTo(r, colIndex + 1, extend);
  };

  const say = (text) => { setMessage(text); };

  const startEdit = (initial) => {
    const card = rows[rowIndex];
    const col = columns[colIndex];
    if (!card || !col) return;
    if (col.readOnly) { say('Fit is worked out from the card and its template: edit the card\'s text, or the template\'s fit settings in the Designer.'); return; }
    if (!applicable(card, col)) { say(`${col.label} isn't used by ${card.card_type || 'this card type'}.`); return; }
    if (col.kind === 'yesNo') { actions.commitCell(card.id, col.key, getFieldRaw(card, col.key) !== true); return; }
    if (col.kind === 'image') { say('Paste an image here with Ctrl+V, or use the Cards tab to choose a file.'); return; }
    const current = col.kind === 'cardType' ? (model.types.find((t) => t.id === card.card_type_id)?.name || '') : getFieldValue(card, col.key);
    const value = initial ?? current;
    setEditing({ cardId: card.id, key: col.key, initial: value });
    if (initial !== undefined && col.kind !== 'cardType') { markEdit(performance.now()); actions.setLiveEdit(card.id, col.key, value); }
  };

  const onEditDone = (value, dir) => {
    const ed = editing;
    setEditing(null);
    if (value === null) actions.clearLiveEdit();
    else {
      const col = columns.find((c) => c.key === ed.key);
      const parsed = col ? parseCellValue(col, value, model.types) : { value };
      if ('skip' in parsed) { actions.clearLiveEdit(); say(parsed.skip); }
      else actions.commitCell(ed.cardId, ed.key, parsed.value);
    }
    if (dir) move(dir);
    requestAnimationFrame(() => gridRef.current?.focus());
  };

  const writeText = (text) => (window.api?.writeClipboardText ? window.api.writeClipboardText(text) : navigator.clipboard.writeText(text));

  const copy = async () => {
    if (!range) return;
    const out = [];
    for (let r = range.r0; r <= range.r1; r++) {
      const card = rows[r];
      const line = [];
      for (let c = range.c0; c <= range.c1; c++) {
        const col = columns[c];
        if (col.kind === 'fit') {
          const entry = useStore.getState().fitCache[card.id];
          const worst = summaryOf(entry, labels)?.worst;
          line.push(worst ? shortFit(worst) : '');
        } else if (!applicable(card, col)) line.push('');
        else if (col.kind === 'cardType') line.push(model.types.find((t) => t.id === card.card_type_id)?.name || '');
        else if (col.kind === 'yesNo') line.push(getFieldRaw(card, col.key) === true ? 'TRUE' : 'FALSE');
        else line.push(getFieldValue(card, col.key));
      }
      out.push(line);
    }
    await writeText(toTsv(out));
    say(`Copied ${(range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1)} cell(s).`);
  };

  const paste = async () => {
    if (!range) return;
    const clip = window.api?.readClipboard ? await window.api.readClipboard() : { text: await navigator.clipboard.readText(), hasImage: false };
    const col = columns[colIndex];
    const card = rows[rowIndex];
    if (clip.hasImage && col?.kind === 'image') {
      if (!applicable(card, col)) { say(`${col.label} isn't used by ${card.card_type}.`); return; }
      const res = await window.api.pasteImageFromClipboard(activeProjectId, { folder: 'art', name: card.name });
      if (res.empty) { say('No image on the clipboard.'); return; }
      await actions.commitCell(card.id, col.key, res.path);
      say(`Pasted art for ${card.name}.`);
      return;
    }
    const grid = parseTsv(clip.text);
    if (!grid.length) { say('The clipboard is empty.'); return; }
    const plan = planPaste({ grid, range, rows, columns, applicable, types: model.types });
    const n = plan.writes.length ? await actions.commitChanges(plan.writes) : 0;
    const parts = [`Pasted ${n} cell(s)`];
    if (plan.skipped) parts.push(`${plan.skipped} skipped (${plan.reasons.slice(0, 2).join('; ')})`);
    if (plan.overflowRows) parts.push(`${plan.overflowRows} row(s) didn't fit below the last card`);
    say(`${parts.join(' · ')}.`);
  };

  const fillDown = async () => {
    if (!range) return;
    const plan = planFillDown({ range, rows, columns, applicable, raw: getFieldRaw });
    const n = plan.writes.length ? await actions.commitChanges(plan.writes) : 0;
    say(`Filled ${n} cell(s)${plan.skipped ? `, ${plan.skipped} skipped` : ''}.`);
  };

  const clearRange = async () => {
    if (!range) return;
    const plan = planClear({ range, rows, columns, applicable });
    const n = plan.writes.length ? await actions.commitChanges(plan.writes) : 0;
    if (n > 1) say(`Cleared ${n} cells.`);
  };

  const undoRedo = async (redo) => {
    const entry = redo ? await actions.redoCellEdit() : await actions.undoCellEdit();
    if (entry) { setCursorKey(entry.key); setAnchor(null); }
  };

  const onKeyDown = (e) => {
    if (editing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'z') { e.preventDefault(); undoRedo(e.shiftKey); return; }
    if (ctrl && k === 'y') { e.preventDefault(); undoRedo(true); return; }
    if (ctrl && k === 'c') { e.preventDefault(); copy(); return; }
    if (ctrl && k === 'v') { e.preventDefault(); paste(); return; }
    if (ctrl && k === 'd') { e.preventDefault(); fillDown(); return; }
    if (ctrl && k === 'a') {
      e.preventDefault();
      if (rows.length) { setAnchor({ cardId: rows[0].id, key: columns[0].key }); actions.setActiveCard(rows[rows.length - 1].id); setCursorKey(columns[columns.length - 1].key); }
      return;
    }
    if (ctrl || e.altKey) return;
    const keys = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (keys[e.key]) { e.preventDefault(); move(keys[e.key], e.shiftKey); return; }
    if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? 'left' : 'right'); return; }
    if (e.key === 'Home') { e.preventDefault(); moveTo(rowIndex, 0, e.shiftKey); return; }
    if (e.key === 'End') { e.preventDefault(); moveTo(rowIndex, columns.length - 1, e.shiftKey); return; }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(); return; }
    if (e.key === ' ' && columns[colIndex]?.kind === 'yesNo') { e.preventDefault(); startEdit(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearRange(); return; }
    if (e.key === 'Escape') { setAnchor(null); setMessage(null); return; }
    if (e.key.length === 1) { e.preventDefault(); startEdit(e.key); }
  };

  const onCellMouseDown = (e, card, col) => {
    if (editing) return;
    e.preventDefault();
    if (e.shiftKey && rowIndex >= 0) {
      if (!anchor) setAnchor({ cardId: activeCardId, key: cursorKey });
    } else {
      setAnchor({ cardId: card.id, key: col.key });
      dragging.current = true;
    }
    actions.setActiveCard(card.id);
    setCursorKey(col.key);
    gridRef.current?.focus();
  };
  const onCellEnter = (card, col) => {
    if (!dragging.current) return;
    actions.setActiveCard(card.id);
    setCursorKey(col.key);
  };
  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const handleSort = (key) => setSortConfig((s) => (s.key === key ? { key, direction: s.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }));
  const handleDelete = (cardId) => { if (window.confirm('Delete this card?')) actions.deleteCardAndSelectNext(cardId); };

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 flex-1">
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">📦</div>
          <h3 className="text-xl font-semibold text-text-primary mb-2">{cards.length ? 'No cards match' : 'No cards yet'}</h3>
          <p className="text-text-muted mb-6">{cards.length ? 'Change the filters to see more cards.' : 'Create your first card, or import a spreadsheet.'}</p>
          {!cards.length && (
            <button onClick={() => { actions.setCardsTab('cards'); actions.createCardOfType(model.types[0]?.id); }} className="px-4 py-2 bg-accent text-white rounded hover:bg-accent/90 transition-colors">
              Create Card
            </button>
          )}
        </div>
      </div>
    );
  }

  const allSelected = selectedCardIds.length === rows.length;
  const someSelected = selectedCardIds.length > 0 && !allSelected;
  const multi = range && (range.r1 > range.r0 || range.c1 > range.c0);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-surface-0">
      <div ref={gridRef} tabIndex={0} data-testid="card-grid" onKeyDown={onKeyDown} className="flex-1 overflow-auto focus:outline-none select-none">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: 40 + 96 + columns.reduce((n, c) => n + c.width, 0), minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: 40 }} />
            {columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}
            <col style={{ width: 96 }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-surface-1 sticky top-0 z-10">
              <th className="px-3 py-2 text-left sticky left-0 z-20 bg-surface-1">
                <input type="checkbox" checked={allSelected} ref={(input) => { if (input) input.indeterminate = someSelected; }}
                  onChange={() => (allSelected ? actions.clearCardSelection() : useStore.setState({ selectedCardIds: rows.map((r) => r.id) }))}
                  className="w-4 h-4 cursor-pointer accent-accent" data-testid="select-all" />
              </th>
              {columns.map((c) => (
                <th key={c.key} className={`px-2 py-2 text-left font-medium text-text-secondary whitespace-nowrap overflow-hidden ${c.key === 'name' ? 'sticky left-[40px] z-20 bg-surface-1 border-r border-border' : ''}`} data-col={c.key}>
                  <button onClick={() => handleSort(c.key)} className="flex items-center gap-1 hover:text-accent transition-colors" title={c.fieldKey ? `{{${c.fieldKey}}}` : undefined}>
                    {c.label}
                    {sortConfig.key === c.key && (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-accent" /> : <ChevronDown size={14} className="text-accent" />)}
                  </button>
                </th>
              ))}
              <th className="px-2 py-2 text-right relative">
                <button data-testid="columns-menu" onClick={() => setColumnsOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-accent" title="Choose columns">
                  <Columns3 size={14} /> Columns
                </button>
                {columnsOpen && (
                  <div className="absolute right-2 top-full mt-1 z-30 w-56 max-h-80 overflow-auto bg-surface-1 border border-border rounded-lg shadow-xl p-2 text-left" onMouseLeave={() => setColumnsOpen(false)}>
                    {allColumns.filter((c) => c.key !== 'name').map((c) => (
                      <label key={c.key} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-2 text-xs text-text-primary cursor-pointer">
                        <input type="checkbox" data-col-toggle={c.key} checked={!hidden.has(c.key)} onChange={() => toggleColumn(c.key)} className="accent-accent" />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((card, r) => {
              const isSelected = selectedCardIds.includes(card.id);
              const isActiveRow = card.id === activeCardId;
              return (
                <tr key={card.id} data-card-row={card.id} className={`group border-b border-border ${isSelected ? 'bg-accent/10' : isActiveRow ? 'bg-surface-2/60' : 'hover:bg-surface-2/40'}`}>
                  <td className={`px-3 py-1.5 sticky left-0 z-[5] ${isActiveRow ? 'bg-surface-1' : 'bg-surface-0'}`}>
                    <input type="checkbox" checked={isSelected} onChange={() => actions.toggleCardSelection(card.id)} className="w-4 h-4 cursor-pointer accent-accent" data-select-card={card.id} />
                  </td>
                  {columns.map((col, c) => {
                    const ok = applicable(card, col);
                    const isCursor = isActiveRow && col.key === cursorKey;
                    const isEditing = editing && editing.cardId === card.id && editing.key === col.key;
                    const inSel = multi && inRange(range, r, c);
                    return (
                      <td
                        key={col.key}
                        data-cell={`${card.id}:${col.key}`}
                        data-na={ok ? undefined : '1'}
                        title={ok ? undefined : `${col.label} isn't used by ${card.card_type || 'this card type'}`}
                        className={`relative px-2 py-1.5 whitespace-nowrap text-ellipsis cursor-cell ${isEditing ? 'overflow-visible' : 'overflow-hidden'} ${col.key === 'name' ? `sticky left-[40px] z-[5] border-r border-border ${isActiveRow ? 'bg-surface-1' : 'bg-surface-0'}` : ''} ${!ok ? 'bg-surface-2/50' : ''} ${inSel ? 'bg-accent/15' : ''} ${isCursor ? 'outline outline-2 -outline-offset-2 outline-accent' : ''}`}
                        onMouseDown={(e) => onCellMouseDown(e, card, col)}
                        onMouseEnter={() => onCellEnter(card, col)}
                        onDoubleClick={() => { if (!editing) startEdit(); }}
                      >
                        {ok ? <CellDisplay card={card} col={col} types={model.types} labels={labels} /> : <span className="text-text-muted/50">·</span>}
                        {isEditing && <CellEditor card={card} col={col} initial={editing.initial} onDone={onEditDone} />}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { actions.setActiveCard(card.id); actions.setCardsTab('cards'); }} className="p-1 hover:bg-surface-3 rounded text-text-secondary hover:text-accent" title="Open in the card form" data-open-form={card.id}>
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => actions.duplicateCardAndSelect(card.id)} className="p-1 hover:bg-surface-3 rounded text-text-secondary hover:text-accent" title="Duplicate"><Copy size={15} /></button>
                      <button onClick={() => handleDelete(card.id)} className="p-1 hover:bg-surface-3 rounded text-text-secondary hover:text-red-500" title="Delete"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-border bg-surface-1 text-text-muted text-xs flex items-center gap-4">
        <span>Showing {rows.length} of {cards.length} card{cards.length !== 1 ? 's' : ''}</span>
        {message ? <span className="text-text-secondary" data-testid="grid-message">{message}</span> : (
          <span className="hidden lg:inline">Shift selects · Ctrl+C / Ctrl+V with Excel · Ctrl+D fills down · Ctrl+Z undo</span>
        )}
        {cellError && <span className="text-danger" data-testid="cell-error">{cellError}</span>}
        <span className="ml-auto"><FitProgress /></span>
      </div>
    </div>
  );
}
