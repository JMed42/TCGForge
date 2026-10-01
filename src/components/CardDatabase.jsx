import { useStore } from '../store';
import TopBar from './Layout/TopBar';
import { CardTable } from './Cards';
import { CardFilters } from './Cards';
import { CardEditor } from './Cards';
import { CardBulkActions } from './Cards';
import { Plus } from 'lucide-react';

export default function CardDatabase() {
  const {
    cards,
    editingCard,
    setEditingCard,
    selectedCardIds,
  } = useStore();

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <TopBar title={`Cards (${cards.length})`}>
        <button
          onClick={() => setEditingCard({})}
          className="flex items-center gap-2 px-3 py-1.5 bg-accent hover:brightness-110 rounded-lg transition-all text-white text-sm font-medium"
        >
          <Plus size={16} />
          New Card
        </button>
      </TopBar>

      <CardFilters />
      <CardTable />

      {selectedCardIds.length > 0 && <CardBulkActions />}
      {editingCard !== null && <CardEditor />}
    </div>
  );
}
