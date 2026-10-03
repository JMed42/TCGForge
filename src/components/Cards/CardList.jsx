import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus, Search } from 'lucide-react'
import { useStore } from '../../store'

// The Cards tab's list: cards grouped by type, searchable, with "New card" by type.
export default function CardList({ onCreated }) {
  const cards = useStore((s) => s.cards)
  const types = useStore((s) => s.cardModel.types)
  const activeCardId = useStore((s) => s.activeCardId)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const listRef = useRef(null)

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const match = (c) => !q || c.name.toLowerCase().includes(q)
    return types
      .filter((t) => !typeFilter || t.id === Number(typeFilter))
      .map((t) => ({ type: t, cards: cards.filter((c) => c.card_type_id === t.id && match(c)).sort((a, b) => a.name.localeCompare(b.name)) }))
      .filter((g) => g.cards.length || (!q && typeFilter))
  }, [cards, types, search, typeFilter])
  const flat = useMemo(() => groups.flatMap((g) => g.cards), [groups])

  // Nothing selected (first visit, or the card was deleted): select the first card.
  useEffect(() => {
    if (flat.length && !cards.some((c) => c.id === activeCardId)) useStore.getState().setActiveCard(flat[0].id)
  }, [flat, cards, activeCardId])

  const create = async (typeId) => {
    setMenuOpen(false)
    const id = await useStore.getState().createCardOfType(typeId)
    if (id) onCreated?.(id)
  }

  const onKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = flat.findIndex((c) => c.id === activeCardId)
    const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) {
      useStore.getState().setActiveCard(next.id)
      listRef.current?.querySelector(`[data-list-card="${next.id}"]`)?.scrollIntoView({ block: 'nearest' })
    }
  }

  return (
    <aside className="w-64 flex-shrink-0 border-r border-border flex flex-col bg-surface-1 min-h-0" data-testid="card-list">
      <div className="p-3 space-y-2 border-b border-border">
        <div className="relative">
          <button
            data-testid="new-card"
            onClick={() => (types.length > 1 ? setMenuOpen((o) => !o) : create(types[0]?.id))}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-accent hover:brightness-110 rounded-lg text-white text-sm font-medium"
          >
            <Plus size={15} /> New card {types.length > 1 && <ChevronDown size={14} />}
          </button>
          {menuOpen && (
            <div className="absolute z-20 mt-1 w-full bg-surface-2 border border-border rounded-lg shadow-xl py-1" onMouseLeave={() => setMenuOpen(false)}>
              {types.map((t) => (
                <button key={t.id} data-new-card-type={t.name} onClick={() => create(t.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-3 hover:text-text-primary">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} /> {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input data-testid="card-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search cards…"
            className="w-full pl-8 pr-2 py-1.5 bg-surface-2 border border-border rounded text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent" />
        </div>
        {types.length > 1 && (
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full px-2 py-1 bg-surface-2 border border-border rounded text-xs text-text-primary">
            <option value="">All types</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>
      <div ref={listRef} tabIndex={0} onKeyDown={onKeyDown} className="flex-1 overflow-auto py-1 focus:outline-none">
        {groups.map((g) => (
          <div key={g.type.id} className="mb-1">
            <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-text-muted">
              <span className="w-2 h-2 rounded-full" style={{ background: g.type.color }} /> {g.type.name} <span className="ml-auto">{g.cards.length}</span>
            </div>
            {g.cards.map((c) => (
              <button
                key={c.id}
                data-list-card={c.id}
                onClick={() => useStore.getState().setActiveCard(c.id)}
                className={`w-full text-left px-3 py-1.5 text-sm truncate ${c.id === activeCardId ? 'bg-accent/15 text-text-primary' : 'text-text-secondary hover:bg-surface-2'}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        ))}
        {!flat.length && <p className="px-3 py-4 text-xs text-text-muted">{cards.length ? 'No cards match.' : 'No cards yet.'}</p>}
      </div>
    </aside>
  )
}
