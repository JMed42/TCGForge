import { useEffect, useRef, useState } from 'react';
import { Plus, PanelRightOpen, FileSpreadsheet } from 'lucide-react';
import { useStore } from '../store';
import TopBar from './Layout/TopBar';
import { CardTable, CardFilters, CardBulkActions } from './Cards';
import CardPreviewPane from './Cards/CardPreviewPane';
import CardList from './Cards/CardList';
import CardForm from './Cards/CardForm';
import TemplateAssignmentDialog from './Cards/TemplateAssignmentDialog';
import ImportDialog from './Cards/ImportDialog';
import MissingArtBanner from './Cards/MissingArtBanner';

const PANE_KEY = 'tcgforge.cardsPreview';

function loadPane() {
  try {
    const v = JSON.parse(localStorage.getItem(PANE_KEY) || 'null');
    if (v && typeof v.width === 'number') return { open: v.open !== false, width: Math.min(900, Math.max(260, v.width)) };
  } catch { /* storage unavailable */ }
  return { open: true, width: 380 };
}

const TABS = [
  ['cards', 'Cards', 'Write one card at a time in a form'],
  ['database', 'Database', 'All cards in a grid, for batch edits'],
];

// Cards screen, two tabs over the same cards and the same live preview:
//   Cards: a list, the selected card's form (its type's fields), auto-saved.
//   Database: the spreadsheet grid for batch edits, filters, import and missing art.
export default function CardDatabase() {
  const cardCount = useStore((s) => s.cards.length);
  const selectedCount = useStore((s) => s.selectedCardIds.length);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const tab = useStore((s) => s.cardsTab);
  const [pane, setPane] = useState(loadPane);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [focusName, setFocusName] = useState(null); // id of a just-created card: focus its name
  const drag = useRef(null);

  useEffect(() => {
    const s = useStore.getState();
    s.loadCardModel();
    s.loadTemplates();
    s.loadTemplateRules();
    s.loadMissingArt();
  }, [activeProjectId]);

  useEffect(() => {
    try { localStorage.setItem(PANE_KEY, JSON.stringify(pane)); } catch { /* ignore */ }
  }, [pane]);

  const onResizeStart = (e) => {
    e.preventDefault();
    drag.current = { x: e.clientX, width: pane.width };
    const onMove = (ev) => {
      if (!drag.current) return;
      const width = Math.min(900, Math.max(260, drag.current.width + (drag.current.x - ev.clientX)));
      setPane((p) => ({ ...p, width }));
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const newCardInDatabase = async () => {
    const s = useStore.getState();
    const typeId = s.cardFilters.cardTypeId ? Number(s.cardFilters.cardTypeId) : s.cardModel.types[0]?.id;
    await s.createCardOfType(typeId);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <TopBar title={`Cards (${cardCount})`}>
        <div className="flex rounded-lg bg-surface-2 p-0.5 mr-2" role="tablist">
          {TABS.map(([id, label, title]) => (
            <button
              key={id}
              role="tab"
              data-testid={`tab-${id}`}
              title={title}
              aria-selected={tab === id}
              onClick={() => useStore.getState().setCardsTab(id)}
              className={`px-3 py-1 rounded-md text-sm ${tab === id ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'database' && (
          <button
            data-testid="open-import"
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 rounded-lg transition-all text-text-secondary text-sm font-medium"
          >
            <FileSpreadsheet size={16} />
            Import…
          </button>
        )}
        {!pane.open && (
          <button
            onClick={() => setPane((p) => ({ ...p, open: true }))}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 rounded-lg text-text-secondary text-sm"
            title="Show preview"
          >
            <PanelRightOpen size={16} /> Preview
          </button>
        )}
        {tab === 'database' && (
          <button
            onClick={newCardInDatabase}
            data-testid="new-card-db"
            className="flex items-center gap-2 px-3 py-1.5 bg-accent hover:brightness-110 rounded-lg transition-all text-white text-sm font-medium"
          >
            <Plus size={16} />
            New Card
          </button>
        )}
      </TopBar>

      {tab === 'database' && (
        <>
          <CardFilters />
          <MissingArtBanner />
        </>
      )}

      <div className="flex-1 flex min-h-0">
        {tab === 'cards' ? (
          <>
            <CardList onCreated={(id) => setFocusName(id)} />
            <CardForm focusName={focusName} />
          </>
        ) : (
          <div className="flex-1 min-w-0 flex flex-col">
            <CardTable />
          </div>
        )}
        {pane.open && (
          <>
            <div onPointerDown={onResizeStart} className="w-1 cursor-col-resize bg-border hover:bg-accent/60" title="Drag to resize" />
            <div style={{ width: pane.width }} className="flex-shrink-0 min-h-0">
              <CardPreviewPane onClose={() => setPane((p) => ({ ...p, open: false }))} onOpenRules={() => setRulesOpen(true)} />
            </div>
          </>
        )}
      </div>

      {tab === 'database' && selectedCount > 0 && <CardBulkActions />}
      {rulesOpen && <TemplateAssignmentDialog onClose={() => setRulesOpen(false)} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}
