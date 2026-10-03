import { useStore } from '../../store'
import TopBar from '../Layout/TopBar'
import SymbolsTab from './SymbolsTab'
import KeywordsTab from './KeywordsTab'
import VariablesTab from './VariablesTab'
import FontsTab from './FontsTab'

const TABS = [
  ['symbols', 'Symbols', 'Icons you type in card text as {code}'],
  ['keywords', 'Keywords', 'Keywords with reminder text, linked to your rules'],
  ['variables', 'Variables', 'Values used on many cards, like {{HAND_SIZE}}'],
  ['fonts', 'Fonts', 'The project\'s font files'],
]

// The Library (spec: "Shared building blocks"): symbols, keywords, global variables and fonts.
export default function LibraryView() {
  const tab = useStore((s) => s.libraryTab)
  const loaded = useStore((s) => s.library !== null)
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopBar title="Library">
        <div className="flex rounded-lg bg-surface-2 p-0.5" role="tablist">
          {TABS.map(([id, label, title]) => (
            <button
              key={id}
              role="tab"
              data-testid={`library-tab-${id}`}
              title={title}
              aria-selected={tab === id}
              onClick={() => useStore.getState().setLibraryTab(id)}
              className={`px-3 py-1 rounded-md text-sm ${tab === id ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </TopBar>
      <p className="px-6 py-2 border-b border-border text-xs text-text-muted" data-testid="library-intro">
        Building blocks for your cards: symbols you type as <code className="text-text-secondary">{'{fire}'}</code>, keywords that add their reminder
        text, and values like <code className="text-text-secondary">{'{{HAND_SIZE}}'}</code> that you change once for every card.
      </p>
      <div className="flex-1 min-h-0 overflow-hidden">
        {!loaded ? <p className="p-6 text-sm text-text-muted">Loading…</p> : (
          <>
            {tab === 'symbols' && <SymbolsTab />}
            {tab === 'keywords' && <KeywordsTab />}
            {tab === 'variables' && <VariablesTab />}
            {tab === 'fonts' && <FontsTab />}
          </>
        )}
      </div>
    </div>
  )
}
