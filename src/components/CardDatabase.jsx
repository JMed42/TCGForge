import { useEffect, useRef, useState } from 'react';
import { Plus, PanelRightOpen, FileSpreadsheet } from 'lucide-react';
import { useStore } from '../store';
import TopBar from './Layout/TopBar';
import { CardTable, CardFilters, CardEditor, CardBulkActions } from './Cards';
import CardPreviewPane from './Cards/CardPreviewPane';
import TemplateRulesDialog from './Cards/TemplateRulesDialog';

const PANE_KEY = 'tcgforge.cardsPreview';

function loadPane() {
  try {
    const v = JSON.parse(localStorage.getItem(PANE_KEY) || 'null');
    if (v && typeof v.width === 'number') return { open: v.open !== false, width: Math.min(900, Math.max(260, v.width)) };
  } catch { /* storage unavailable */ }
  return { open: true, width: 380 };
}

// Cards screen (spec: table left, live render of the selected card right).
export default function CardDatabase() {
  const cardCount = useStore((s) => s.cards.length);
  const editingCard = useStore((s) => s.editingCard);
  const selectedCount = useStore((s) => s.selectedCardIds.length);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const [pane, setPane] = useState(loadPane);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const drag = useRef(null);

  useEffect(() => {
    const s = useStore.getState();
    s.loadTemplates();
    s.loadTemplateRules();
    s.loadMissingArt?.();
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <TopBar title={`Cards (${cardCount})`}>
        <button
          data-testid="open-import"
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 rounded-lg transition-all text-text-secondary text-sm font-medium"
        >
          <FileSpreadsheet size={16} />
          Import…
        </button>
        {!pane.open && (
          <button
            onClick={() => setPane((p) => ({ ...p, open: true }))}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 rounded-lg text-text-secondary text-sm"
            title="Show preview"
          >
            <PanelRightOpen size={16} /> Preview
          </button>
        )}
        <button
          onClick={() => useStore.getState().setEditingCard({})}
          className="flex items-center gap-2 px-3 py-1.5 bg-accent hover:brightness-110 rounded-lg transition-all text-white text-sm font-medium"
        >
          <Plus size={16} />
          New Card
        </button>
      </TopBar>

      <CardFilters />

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">
          <CardTable />
        </div>
        {pane.open && (
          <>
            <div onPointerDown={onResizeStart} className="w-1 cursor-col-resize bg-border hover:bg-accent/60" title="Drag to resize" />
            <div style={{ width: pane.width }} className="flex-shrink-0 min-h-0">
              <CardPreviewPane onClose={() => setPane((p) => ({ ...p, open: false }))} onOpenRules={() => setRulesOpen(true)} />
            </div>
          </>
        )}
      </div>

      {selectedCount > 0 && <CardBulkActions />}
      {editingCard !== null && <CardEditor />}
      {rulesOpen && <TemplateRulesDialog onClose={() => setRulesOpen(false)} />}
    </div>
  );
}
