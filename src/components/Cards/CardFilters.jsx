import { useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { useStore } from '../../store';
import { allFieldsInOrder } from '../../cardModel/model';

const control = 'px-2 py-1.5 bg-surface-2 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent';

// Database filters: text search across every field, card type, and one "field is / contains"
// condition. Applied in the renderer, so exports use exactly the cards on screen.
export default function CardFilters() {
  const filters = useStore((s) => s.cardFilters);
  const model = useStore((s) => s.cardModel);
  const set = (patch) => useStore.getState().setCardFilters(patch);
  const fields = useMemo(() => allFieldsInOrder(model).filter((f) => f.kind !== 'image'), [model]);
  const field = fields.find((f) => f.key === filters.fieldKey);
  const active = filters.search || filters.cardTypeId || filters.fieldKey;
  const needsValue = filters.fieldOp === 'contains' || filters.fieldOp === 'is';

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border" data-testid="card-filters">
      <div className="relative flex-1 min-w-[12rem] max-w-sm">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input data-testid="filter-search" value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Search all fields…" className={`${control} w-full pl-8`} />
      </div>
      <select data-testid="filter-type" value={filters.cardTypeId} onChange={(e) => set({ cardTypeId: e.target.value })} className={control}>
        <option value="">All card types</option>
        {model.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <select data-testid="filter-field" value={filters.fieldKey} onChange={(e) => set({ fieldKey: e.target.value, fieldValue: '' })} className={control}>
        <option value="">Filter by field…</option>
        {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>
      {filters.fieldKey && (
        <>
          <select data-testid="filter-op" value={filters.fieldOp} onChange={(e) => set({ fieldOp: e.target.value })} className={control}>
            <option value="contains">contains</option>
            <option value="is">is</option>
            <option value="empty">is empty</option>
            <option value="notEmpty">is not empty</option>
          </select>
          {needsValue && (field?.kind === 'choice' && filters.fieldOp === 'is' ? (
            <select data-testid="filter-value" value={filters.fieldValue} onChange={(e) => set({ fieldValue: e.target.value })} className={control}>
              <option value="">—</option>
              {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input data-testid="filter-value" value={filters.fieldValue} onChange={(e) => set({ fieldValue: e.target.value })} placeholder="value" className={`${control} w-36`} />
          ))}
        </>
      )}
      {active && (
        <button onClick={() => set({ search: '', cardTypeId: '', fieldKey: '', fieldOp: 'contains', fieldValue: '' })} className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-text-muted hover:text-text-primary">
          <X size={13} /> Clear filters
        </button>
      )}
    </div>
  );
}
