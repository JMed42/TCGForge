import { AlertTriangle, ArrowDown, Check, EyeOff, Loader2, RotateCcw } from 'lucide-react'
import { useStore } from '../../store'
import { describeFit, shortFit } from '../../designer/fit/summary.ts'
import { useCardFit } from './useFit'

// How fit results look everywhere: the Fit column, the list badges, the budget lines under the
// fields, the preview and the Designer.

const TONE = { overflow: 'text-danger', hidden: 'text-text-muted', shrunk: 'text-amber-400', fits: 'text-success' }
const ICON = { overflow: AlertTriangle, hidden: EyeOff, shrunk: ArrowDown, fits: Check }

export const fitTooltip = (summary) => summary.items.map((i) => `${i.label}: ${describeFit(i.result)}`).join('\n')

/** The Fit column cell: the hardest text layer, "+N" more with problems, a spinner while re-checking. */
export function FitCell({ cardId, labels }) {
  const { summary, stale } = useCardFit(cardId, labels)
  if (!summary) {
    return stale
      ? <span className="text-text-muted" title="Checking fit…" data-fit-status="pending">…</span>
      : <span className="text-text-muted" title="No template to check against" data-fit-status="none">—</span>
  }
  if (!summary.worst) return <span className="text-text-muted" title="No text on this card's template" data-fit-status="empty">—</span>
  const w = summary.worst
  const Icon = ICON[w.result.status]
  const more = summary.items.filter((i) => i.result.status !== 'fits').length - 1
  return (
    <span className={`inline-flex items-center gap-1 max-w-full ${TONE[w.result.status]}`} title={fitTooltip(summary)} data-fit-status={w.result.status}>
      <Icon size={13} className={`flex-shrink-0 ${stale ? 'opacity-50' : ''}`} />
      <span className={`truncate ${w.result.status === 'fits' ? 'text-text-muted' : ''} ${stale ? 'opacity-50' : ''}`}>{shortFit(w)}</span>
      {more > 0 && <span className="text-text-muted text-[10px]">+{more}</span>}
      {stale && <Loader2 size={11} className="flex-shrink-0 animate-spin text-text-muted" />}
    </span>
  )
}

/** A small badge for the card list: only when something doesn't fit as set. */
export function FitBadge({ cardId, labels }) {
  const { summary } = useCardFit(cardId, labels)
  const status = summary?.worst?.result.status
  if (!status || status === 'fits') return null
  const Icon = ICON[status]
  return (
    <span className={`flex-shrink-0 ${TONE[status]}`} title={fitTooltip(summary)} data-fit-badge={status}>
      <Icon size={12} />
    </span>
  )
}

/** A budget line: "Effect: fits at 8.5 pt · about 2 lines to spare". */
export function FitLine({ item, className = '' }) {
  const s = item.result.status
  const tone = s === 'overflow' ? 'text-danger' : s === 'shrunk' ? 'text-amber-400' : 'text-text-muted'
  return (
    <p className={`text-[11px] ${tone} ${className}`} data-fit-line={item.layerId} data-fit-status={s}>
      {s === 'overflow' ? '⚠ ' : ''}{item.label}: {describeFit(item.result)}
    </p>
  )
}

/** The background check's progress, with "Re-check all". */
export function FitProgress() {
  const { total, pending } = useStore((s) => s.fitProgress)
  const ready = useStore((s) => s.fitReady)
  if (!ready || !total) return null
  return (
    <span className="inline-flex items-center gap-2" data-testid="fit-progress">
      {pending > 0 ? (
        <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Checking fit… {total - pending} of {total}</span>
      ) : (
        <span>Fit checked for {total} card{total === 1 ? '' : 's'}</span>
      )}
      <button
        className="inline-flex items-center gap-1 text-text-muted hover:text-text-primary"
        title="Measure every card again (after installing or removing a system font)"
        data-testid="fit-recheck"
        onClick={() => useStore.getState().recheckAllFits()}
      >
        <RotateCcw size={11} /> Re-check all
      </button>
    </span>
  )
}
