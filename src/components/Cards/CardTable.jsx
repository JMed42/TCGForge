import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Pencil, Copy, Trash2, Columns3 } from 'lucide-react';
import { useStore } from '../../store';
import {
  columnsFor, customFieldNames, DEFAULT_VISIBLE, getFieldValue,
} from './grid/cardFields';
import { markEdit } from './grid/liveTiming';

// Spreadsheet-style card grid: a cell cursor moved with the keyboard, in-place editing that
// renders live in the preview pane (via store.liveEdit), and cell undo/redo.
//   Arrows / Tab / Enter move · Enter, F2, double-click or typing edits · Esc cancels
//   Delete clears · Ctrl+Z / Ctrl+Y undo and redo cell edits

const rarityColors = {
  Common: 'bg-gray-400 text-black',
  Uncommon: 'bg-emerald-500 text-white',
  Rare: 'bg-amber-400 text-black',
  Mythic: 'bg-orange-600 text-white',
  Legendary: 'bg-yellow-500 text-black',
};

const typeColors = {
  Creature: 'bg-red-600 text-white',
  Sorcery: 'bg-purple-600 text-white',
  Instant: 'bg-blue-600 text-white',
  Enchantment: 'bg-green-600 text-white',
  Land: 'bg-amber-700 text-white',
  Artifact: 'bg-gray-600 text-white',
  default: 'bg-slate-500 text-white',
};

const getTypeColor = (type) => typeColors[type] || typeColors.default;
const getRarityColor = (rarity) => rarityColors[rarity] || 'bg-gray-500 text-white';

const columnsStorageKey = (projectId) => `tcgforge.cardColumns.${projectId}`;

function loadVisible(projectId) {
  try {
    const raw = localStorage.getItem(columnsStorageKey(projectId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* storage unavailable */ }
  return DEFAULT_VISIBLE;
}

function CellDisplay({ card, col }) {
  const value = getFieldValue(card, col.key);
  if (!value) return <span className="text-text-muted">—</span>;
  if (col.key === 'type') return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getTypeColor(value)}`}>{value}</span>;
  if (col.key === 'rarity') return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getRarityColor(value)}`}>{value}</span>;
  if (col.key === 'name') return <span className="font-semibold text-text-primary">{value}</span>;
  if (col.key === 'tags') {
    return (
      <span className="flex gap-1 overflow-hidden">
        {card.tags.map((tag) => <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-accent/20 text-accent whitespace-nowrap">{tag}</span>)}
      </span>
    );
  }
  return <span className="text-text-secondary">{value.replace(/\s*\n\s*/g, ' ⏎ ')}</span>;
}

// The open editor. Typing goes to the store as liveEdit (the preview renders it at once);
// Enter / Tab / blur commit, Escape cancels.
function CellEditor({ card, col, initial, onDone }) {
  const [value, setValue] = useState(initial);
  const ref = useRef(null);
  const done = useRef(false);
  const multiline = Boolean(col.multiline);

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
    useStore.getState().setLiveEdit(card.id, col.key, e.target.value);
  };

  const Tag = multiline ? 'textarea' : 'input';
  return (
    <Tag
      ref={ref}
      data-testid="cell-editor"
      rows={multiline ? 1 : undefined}
      className="absolute left-0 top-0 z-20 w-full min-w-[160px] px-2 py-1.5 bg-surface-0 border-2 border-accent rounded text-sm text-text-primary focus:outline-none resize-none shadow-lg"
      value={value}
      spellCheck={false}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true, null)}
    />
  );
}

export default function CardTable() {
  const cards = useStore((s) => s.cards);
  const selectedCardIds = useStore((s) => s.selectedCardIds);
  const cardFilters = useStore((s) => s.cardFilters);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeCardId = useStore((s) => s.activeCardId);
  const cellError = useStore((s) => s.cellError);
  const missingArtOnly = useStore((s) => s.missingArtOnly);
  const missingArtIds = useStore((s) => s.missingArt?.cardIds);
  const cardSchema = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.cardSchema);
  const actions = useStore.getState();

  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });
  const [visible, setVisible] = useState(() => loadVisible(activeProjectId));
  const [cursorKey, setCursorKey] = useState('name');
  const [editing, setEditing] = useState(null); // { cardId, key, initial }
  const [columnsOpen, setColumnsOpen] = useState(false);
  const gridRef = useRef(null);

  useEffect(() => { setVisible(loadVisible(activeProjectId)); }, [activeProjectId]);

  const allColumns = useMemo(() => columnsFor(customFieldNames(cards, cardSchema)), [cards, cardSchema]);
  const columns = useMemo(() => allColumns.filter((c) => visible.includes(c.key)), [allColumns, visible]);

  const toggleColumn = (key) => {
    const next = visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key];
    if (!next.length) return;
    setVisible(next);
    try { localStorage.setItem(columnsStorageKey(activeProjectId), JSON.stringify(next)); } catch { /* ignore */ }
  };

  // Filter (the same client-side filter as before, plus the missing-art filter) and sort.
  const sortedCards = useMemo(() => {
    const missing = missingArtOnly && missingArtIds ? new Set(missingArtIds) : null;
    const filtered = cards.filter((card) => {
      if (missing && !missing.has(card.id)) return false;
      if (cardFilters.search) {
        const q = cardFilters.search.toLowerCase();
        if (!(card.name?.toLowerCase().includes(q) || card.rules_text?.toLowerCase().includes(q))) return false;
      }
      if (cardFilters.type && card.type !== cardFilters.type) return false;
      if (cardFilters.set && card.set_name !== cardFilters.set) return false;
      if (cardFilters.rarity && card.rarity !== cardFilters.rarity) return false;
      if (cardFilters.tags && cardFilters.tags.length > 0) {
        const cardTags = card.tags || [];
        if (!cardFilters.tags.every((tag) => cardTags.some((ct) => ct.toLowerCase() === tag.toLowerCase()))) return false;
      }
      return true;
    });
    const numeric = ['cost', 'power', 'toughness'].includes(sortConfig.key);
    const dir = sortConfig.direction === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      let av = getFieldValue(a, sortConfig.key);
      let bv = getFieldValue(b, sortConfig.key);
      if (numeric && av !== '' && bv !== '' && !Number.isNaN(Number(av)) && !Number.isNaN(Number(bv))) return (Number(av) - Number(bv)) * dir;
      av = av.toLowerCase(); bv = bv.toLowerCase();
      return av < bv ? -dir : av > bv ? dir : a.id - b.id;
    });
  }, [cards, cardFilters, sortConfig, missingArtOnly, missingArtIds]);

  // Keep a valid cursor: the active card (shared with the preview) and a visible column.
  const rowIndex = sortedCards.findIndex((c) => c.id === activeCardId);
  useEffect(() => {
    if (rowIndex < 0 && sortedCards.length) actions.setActiveCard(sortedCards[0].id);
  }, [rowIndex, sortedCards, actions]);
  const colIndex = Math.max(0, columns.findIndex((c) => c.key === cursorKey));
  useEffect(() => {
    if (columns.length && !columns.some((c) => c.key === cursorKey)) setCursorKey(columns[0].key);
  }, [columns, cursorKey]);

  useEffect(() => {
    const el = gridRef.current?.querySelector(`[data-cell="${activeCardId}:${cursorKey}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeCardId, cursorKey]);

  const moveTo = useCallback((r, c) => {
    if (!sortedCards.length) return;
    const row = Math.max(0, Math.min(sortedCards.length - 1, r));
    const col = Math.max(0, Math.min(columns.length - 1, c));
    actions.setActiveCard(sortedCards[row].id);
    setCursorKey(columns[col].key);
  }, [sortedCards, columns, actions]);

  const move = useCallback((dir) => {
    const r = Math.max(0, rowIndex);
    if (dir === 'up') moveTo(r - 1, colIndex);
    else if (dir === 'down') moveTo(r + 1, colIndex);
    else if (dir === 'left') moveTo(r, colIndex - 1);
    else if (dir === 'right') moveTo(r, colIndex + 1);
  }, [rowIndex, colIndex, moveTo]);

  const startEdit = (initial) => {
    const card = sortedCards[rowIndex];
    const col = columns[colIndex];
    if (!card || !col) return;
    const value = initial ?? getFieldValue(card, col.key);
    setEditing({ cardId: card.id, key: col.key, initial: value });
    if (initial !== undefined) { markEdit(performance.now()); actions.setLiveEdit(card.id, col.key, value); }
  };

  const onEditDone = (value, dir) => {
    const ed = editing;
    setEditing(null);
    if (value === null) actions.clearLiveEdit();
    else actions.commitCell(ed.cardId, ed.key, value);
    if (dir) move(dir);
    requestAnimationFrame(() => gridRef.current?.focus());
  };

  const undoRedo = async (redo) => {
    const entry = redo ? await actions.redoCellEdit() : await actions.undoCellEdit();
    if (entry) setCursorKey(entry.key);
  };

  const onKeyDown = (e) => {
    if (editing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undoRedo(e.shiftKey); return; }
    if (ctrl && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); undoRedo(true); return; }
    if (ctrl || e.altKey) return;
    const keys = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (keys[e.key]) { e.preventDefault(); move(keys[e.key]); return; }
    if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? 'left' : 'right'); return; }
    if (e.key === 'Home') { e.preventDefault(); moveTo(rowIndex, 0); return; }
    if (e.key === 'End') { e.preventDefault(); moveTo(rowIndex, columns.length - 1); return; }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const card = sortedCards[rowIndex];
      const col = columns[colIndex];
      if (card && col && col.key !== 'name') actions.commitCell(card.id, col.key, '');
      return;
    }
    if (e.key.length === 1) { e.preventDefault(); startEdit(e.key); }
  };

  const handleSort = (key) => {
    setSortConfig((s) => (s.key === key ? { key, direction: s.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }));
  };

  const handleDelete = (cardId) => {
    if (window.confirm('Are you sure you want to delete this card?')) actions.deleteCard(cardId);
  };

  if (sortedCards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 flex-1">
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">📦</div>
          <h3 className="text-xl font-semibold text-text-primary mb-2">{cards.length ? 'No cards match' : 'No cards yet'}</h3>
          <p className="text-text-muted mb-6">{cards.length ? 'Change the filters to see more cards.' : 'Create your first card, or import a spreadsheet.'}</p>
          {!cards.length && (
            <button onClick={() => { actions.setCardsTab('cards'); actions.createCardOfType(actions.cardModel.types[0]?.id) }} className="px-4 py-2 bg-accent text-white rounded hover:bg-accent/90 transition-colors">
              Create Card
            </button>
          )}
        </div>
      </div>
    );
  }

  const allSelected = selectedCardIds.length === sortedCards.length;
  const someSelected = selectedCardIds.length > 0 && !allSelected;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-surface-0">
      <div
        ref={gridRef}
        tabIndex={0}
        data-testid="card-grid"
        onKeyDown={onKeyDown}
        className="flex-1 overflow-auto focus:outline-none"
      >
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: 40 + 96 + columns.reduce((n, c) => n + c.width, 0), minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: 40 }} />
            {columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}
            <col style={{ width: 96 }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-surface-1 sticky top-0 z-10">
              <th className="px-3 py-2 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(input) => { if (input) input.indeterminate = someSelected; }}
                  onChange={() => (allSelected ? actions.clearCardSelection() : actions.selectAllCards())}
                  className="w-4 h-4 cursor-pointer accent-accent"
                />
              </th>
              {columns.map((c) => (
                <th key={c.key} className="px-2 py-2 text-left font-medium text-text-secondary whitespace-nowrap overflow-hidden">
                  <button onClick={() => handleSort(c.key)} className="flex items-center gap-1 hover:text-accent transition-colors">
                    {c.label}
                    {sortConfig.key === c.key && (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-accent" /> : <ChevronDown size={14} className="text-accent" />)}
                  </button>
                </th>
              ))}
              <th className="px-2 py-2 text-right relative">
                <button
                  data-testid="columns-menu"
                  onClick={() => setColumnsOpen((o) => !o)}
                  className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-accent"
                  title="Choose columns"
                >
                  <Columns3 size={14} /> Columns
                </button>
                {columnsOpen && (
                  <div className="absolute right-2 top-full mt-1 z-30 w-56 max-h-80 overflow-auto bg-surface-1 border border-border rounded-lg shadow-xl p-2 text-left" onMouseLeave={() => setColumnsOpen(false)}>
                    {allColumns.map((c) => (
                      <label key={c.key} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-2 text-xs text-text-primary cursor-pointer">
                        <input type="checkbox" data-col-toggle={c.key} checked={visible.includes(c.key)} onChange={() => toggleColumn(c.key)} className="accent-accent" />
                        {c.label}{c.custom && <span className="text-text-muted">(custom)</span>}
                      </label>
                    ))}
                  </div>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedCards.map((card) => {
              const isSelected = selectedCardIds.includes(card.id);
              const isActiveRow = card.id === activeCardId;
              return (
                <tr
                  key={card.id}
                  data-card-row={card.id}
                  className={`group border-b border-border ${isSelected ? 'bg-accent/10' : isActiveRow ? 'bg-surface-2/60' : 'hover:bg-surface-2/40'}`}
                >
                  <td className="px-3 py-1.5">
                    <input type="checkbox" checked={isSelected} onChange={() => actions.toggleCardSelection(card.id)} className="w-4 h-4 cursor-pointer accent-accent" />
                  </td>
                  {columns.map((col) => {
                    const isCursor = isActiveRow && col.key === cursorKey;
                    const isEditing = editing && editing.cardId === card.id && editing.key === col.key;
                    return (
                      <td
                        key={col.key}
                        data-cell={`${card.id}:${col.key}`}
                        className={`relative px-2 py-1.5 whitespace-nowrap text-ellipsis cursor-cell ${isEditing ? 'overflow-visible' : 'overflow-hidden'} ${isCursor ? 'outline outline-2 -outline-offset-2 outline-accent' : ''}`}
                        onMouseDown={(e) => {
                          if (editing) return;
                          e.preventDefault();
                          actions.setActiveCard(card.id);
                          setCursorKey(col.key);
                          gridRef.current?.focus();
                        }}
                        onDoubleClick={() => { if (!editing) setEditing({ cardId: card.id, key: col.key, initial: getFieldValue(card, col.key) }); }}
                      >
                        <CellDisplay card={card} col={col} />
                        {isEditing && <CellEditor card={card} col={col} initial={editing.initial} onDone={onEditDone} />}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { actions.setActiveCard(card.id); actions.setCardsTab('cards') }} className="p-1 hover:bg-surface-3 rounded text-text-secondary hover:text-accent" title="Open in the card form" data-open-form={card.id}>
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => actions.duplicateCard(card.id)} className="p-1 hover:bg-surface-3 rounded text-text-secondary hover:text-accent" title="Duplicate">
                        <Copy size={15} />
                      </button>
                      <button onClick={() => handleDelete(card.id)} className="p-1 hover:bg-surface-3 rounded text-text-secondary hover:text-red-500" title="Delete">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-border bg-surface-1 text-text-muted text-xs flex items-center gap-4">
        <span>Showing {sortedCards.length} card{sortedCards.length !== 1 ? 's' : ''}</span>
        <span className="hidden lg:inline">Arrows move · Enter or type to edit · Esc cancels · Ctrl+Z undo</span>
        {cellError && <span className="text-danger ml-auto" data-testid="cell-error">{cellError}</span>}
      </div>
    </div>
  );
}
