import React, { useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { useStore } from '../../store';
import { allFieldsInOrder } from '../../cardModel/model';
import { cellKey } from './grid/cardFields';
import { makeApplicable } from './grid/columns';
import { parseCellValue } from './grid/gridOps';

const control = 'px-2 py-1.5 bg-surface-3 border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent';

// Batch edits for the checked rows: set one field to a value, change the card type, or delete.
// Each is one save and one undo step.
export default function CardBulkActions() {
  const selectedCardIds = useStore((s) => s.selectedCardIds);
  const cards = useStore((s) => s.cards);
  const model = useStore((s) => s.cardModel);
  const [mode, setMode] = useState(null); // 'field' | 'type' | 'delete'
  const [fieldKey, setFieldKey] = useState('');
  const [value, setValue] = useState('');
  const [typeId, setTypeId] = useState('');
  const [note, setNote] = useState(null);
  const fields = useMemo(() => allFieldsInOrder(model).filter((f) => f.kind !== 'image'), [model]);
  const field = fields.find((f) => f.key === fieldKey);
  const s = useStore.getState();

  if (selectedCardIds.length === 0) return null;
  const selected = cards.filter((c) => selectedCardIds.includes(c.id));

  const applyField = async () => {
    if (!field) return;
    const column = { key: cellKey(field.key), fieldKey: field.key === 'name' ? null : field.key, label: field.label, kind: field.kind, options: field.options || [] };
    const parsed = parseCellValue(column, value, model.types);
    if ('skip' in parsed) { setNote(parsed.skip); return; }
    const applicable = makeApplicable(model);
    const targets = selected.filter((c) => applicable(c, column));
    const n = await s.commitChanges(targets.map((c) => ({ cardId: c.id, key: column.key, value: parsed.value })));
    const skipped = selected.length - targets.length;
    setNote(`${field.label} set on ${n} card(s)${skipped ? `; ${skipped} skipped (their type doesn't use it)` : ''}.`);
    setMode(null);
  };

  const applyType = async () => {
    if (!typeId) return;
    const n = await s.commitChanges(selected.map((c) => ({ cardId: c.id, key: 'card_type_id', value: String(typeId) })));
    const t = model.types.find((x) => x.id === Number(typeId));
    setNote(`${n} card(s) are now ${t?.name}. Values of fields the new type doesn't use are kept.`);
    setMode(null);
  };

  return (
    <div className="fixed bottom-6 left-6 right-6 max-w-4xl mx-auto z-30" data-testid="bulk-bar">
      <div className="bg-surface-2 border border-border rounded-lg shadow-lg p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-text-primary font-medium mr-2">{selectedCardIds.length} card{selectedCardIds.length !== 1 ? 's' : ''} selected</span>
          <button data-testid="bulk-set-field" onClick={() => { setMode(mode === 'field' ? null : 'field'); setNote(null); }} className={`px-3 py-1.5 rounded text-sm ${mode === 'field' ? 'bg-accent text-white' : 'bg-surface-3 text-text-primary hover:bg-surface-4'}`}>Set field…</button>
          <button data-testid="bulk-change-type" onClick={() => { setMode(mode === 'type' ? null : 'type'); setNote(null); }} className={`px-3 py-1.5 rounded text-sm ${mode === 'type' ? 'bg-accent text-white' : 'bg-surface-3 text-text-primary hover:bg-surface-4'}`}>Change type…</button>
          <button onClick={() => setMode(mode === 'delete' ? null : 'delete')} className="px-3 py-1.5 bg-red-600/20 text-red-500 hover:bg-red-600/30 rounded text-sm flex items-center gap-1.5"><Trash2 size={15} /> Delete</button>
          <div className="flex-1" />
          <button onClick={() => s.clearCardSelection()} className="px-3 py-1.5 bg-surface-3 border border-border text-text-secondary hover:text-text-primary rounded text-sm flex items-center gap-1.5"><X size={15} /> Clear</button>
        </div>
        {mode === 'field' && (
          <div className="flex items-center gap-2 flex-wrap">
            <select data-testid="bulk-field" className={control} value={fieldKey} onChange={(e) => { setFieldKey(e.target.value); setValue(''); }}>
              <option value="">Field…</option>
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            {field?.kind === 'yesNo' ? (
              <select data-testid="bulk-value" className={control} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">No</option>
                <option value="true">Yes</option>
              </select>
            ) : field?.kind === 'choice' ? (
              <select data-testid="bulk-value" className={control} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">(empty)</option>
                {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input data-testid="bulk-value" className={`${control} w-56`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="New value (empty clears)" onKeyDown={(e) => e.key === 'Enter' && applyField()} />
            )}
            <button data-testid="bulk-apply" disabled={!field} onClick={applyField} className="px-3 py-1.5 bg-accent text-white rounded text-sm disabled:opacity-40">Apply to {selectedCardIds.length}</button>
          </div>
        )}
        {mode === 'type' && (
          <div className="flex items-center gap-2">
            <select data-testid="bulk-type" className={control} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Card type…</option>
              {model.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button data-testid="bulk-type-apply" disabled={!typeId} onClick={applyType} className="px-3 py-1.5 bg-accent text-white rounded text-sm disabled:opacity-40">Change {selectedCardIds.length}</button>
          </div>
        )}
        {mode === 'delete' && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-secondary">Delete {selectedCardIds.length} card(s)? This can't be undone.</span>
            <button onClick={async () => { await s.bulkDeleteCards(); setMode(null); }} className="px-3 py-1.5 bg-red-600 text-white rounded text-sm">Delete</button>
            <button onClick={() => setMode(null)} className="px-3 py-1.5 bg-surface-3 text-text-secondary rounded text-sm">Keep</button>
          </div>
        )}
        {note && <p className="text-xs text-text-secondary" data-testid="bulk-note">{note}</p>}
      </div>
    </div>
  );
}
