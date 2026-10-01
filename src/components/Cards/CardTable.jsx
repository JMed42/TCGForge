import React, { useState, useMemo } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Pencil,
  Copy,
  Trash2,
  MoreHorizontal,
} from 'lucide-react';
import { useStore } from '../../store';

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

export default function CardTable() {
  const {
    cards,
    selectedCardIds,
    cardFilters,
    setEditingCard,
    deleteCard,
    bulkDeleteCards,
    duplicateCard,
    toggleCardSelection,
    selectAllCards,
    clearCardSelection,
  } = useStore();

  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });
  const [hoveredRowId, setHoveredRowId] = useState(null);

  // Filter cards
  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      if (cardFilters.search) {
        const searchLower = cardFilters.search.toLowerCase();
        const matchesSearch =
          card.name?.toLowerCase().includes(searchLower) ||
          card.rules_text?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      if (cardFilters.type && card.type !== cardFilters.type) return false;
      if (cardFilters.set && card.set_name !== cardFilters.set) return false;
      if (cardFilters.rarity && card.rarity !== cardFilters.rarity) return false;

      if (cardFilters.tags && cardFilters.tags.length > 0) {
        const cardTags = card.tags || [];
        const hasAllTags = cardFilters.tags.every((tag) =>
          cardTags.some((ct) => ct.toLowerCase() === tag.toLowerCase())
        );
        if (!hasAllTags) return false;
      }

      return true;
    });
  }, [cards, cardFilters]);

  // Sort cards
  const sortedCards = useMemo(() => {
    const sorted = [...filteredCards].sort((a, b) => {
      let aValue = a[sortConfig.key];
      let bValue = b[sortConfig.key];

      // Handle missing values
      if (aValue === null || aValue === undefined) aValue = '';
      if (bValue === null || bValue === undefined) bValue = '';

      // Numeric sort for cost
      if (sortConfig.key === 'cost') {
        aValue = parseInt(aValue) || 0;
        bValue = parseInt(bValue) || 0;
      }

      // String comparison
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      }

      // Numeric comparison
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [filteredCards, sortConfig]);

  const handleSort = (key) => {
    if (sortConfig.key === key) {
      setSortConfig({
        key,
        direction: sortConfig.direction === 'asc' ? 'desc' : 'asc',
      });
    } else {
      setSortConfig({ key, direction: 'asc' });
    }
  };

  const handleSelectAll = () => {
    if (selectedCardIds.length === sortedCards.length) {
      clearCardSelection();
    } else {
      selectAllCards();
    }
  };

  const handleEdit = (card) => {
    setEditingCard(card);
  };

  const handleDuplicate = (card) => {
    duplicateCard(card.id);
  };

  const handleDelete = (cardId) => {
    if (window.confirm('Are you sure you want to delete this card?')) {
      deleteCard(cardId);
    }
  };

  const SortHeader = ({ label, sortKey }) => {
    const isActive = sortConfig.key === sortKey;
    const isAsc = sortConfig.direction === 'asc';

    return (
      <button
        onClick={() => handleSort(sortKey)}
        className="flex items-center gap-2 hover:text-accent transition-colors"
      >
        {label}
        {isActive && (
          isAsc ? (
            <ChevronUp size={16} className="text-accent" />
          ) : (
            <ChevronDown size={16} className="text-accent" />
          )
        )}
      </button>
    );
  };

  if (sortedCards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">📦</div>
          <h3 className="text-xl font-semibold text-text-primary mb-2">
            No cards yet
          </h3>
          <p className="text-text-muted mb-6">
            Create your first card to get started.
          </p>
          <button
            onClick={() => setEditingCard({})}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent/90 transition-colors"
          >
            Create Card
          </button>
        </div>
      </div>
    );
  }

  const allSelected = selectedCardIds.length === sortedCards.length;
  const someSelected = selectedCardIds.length > 0 && selectedCardIds.length < sortedCards.length;

  return (
    <div className="flex flex-col h-full bg-surface-0">
      <div className="flex-1 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface-1 sticky top-0">
              <th className="w-12 px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(input) => {
                    if (input) {
                      input.indeterminate = someSelected;
                    }
                  }}
                  onChange={handleSelectAll}
                  className="w-4 h-4 cursor-pointer accent-accent"
                />
              </th>
              <th className="px-4 py-3 text-left">
                <SortHeader label="Name" sortKey="name" />
              </th>
              <th className="px-4 py-3 text-left">
                <SortHeader label="Type" sortKey="type" />
              </th>
              <th className="px-4 py-3 text-left">
                <SortHeader label="Set" sortKey="set_name" />
              </th>
              <th className="px-4 py-3 text-left">
                <SortHeader label="Rarity" sortKey="rarity" />
              </th>
              <th className="px-4 py-3 text-left">
                <SortHeader label="Cost" sortKey="cost" />
              </th>
              <th className="px-4 py-3 text-left">P/T</th>
              <th className="px-4 py-3 text-left">Tags</th>
              <th className="w-20 px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedCards.map((card) => {
              const isSelected = selectedCardIds.includes(card.id);
              const isHovered = hoveredRowId === card.id;

              return (
                <tr
                  key={card.id}
                  className={`border-b border-border transition-colors ${
                    isSelected ? 'bg-accent/10' : 'hover:bg-surface-2'
                  }`}
                  onMouseEnter={() => setHoveredRowId(card.id)}
                  onMouseLeave={() => setHoveredRowId(null)}
                >
                  <td className="w-12 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleCardSelection(card.id)}
                      className="w-4 h-4 cursor-pointer accent-accent"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleEdit(card)}
                      className="font-semibold text-text-primary hover:text-accent transition-colors text-left"
                    >
                      {card.name || 'Unnamed Card'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {card.type && (
                      <span
                        className={`inline-block px-2 py-1 rounded text-sm font-medium ${getTypeColor(
                          card.type
                        )}`}
                      >
                        {card.type}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {card.set_name || '—'}
                  </td>
                  <td className="px-4 py-3">
                    {card.rarity && (
                      <span
                        className={`inline-block px-2 py-1 rounded text-sm font-medium ${getRarityColor(
                          card.rarity
                        )}`}
                      >
                        {card.rarity}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {card.cost && (
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent text-white text-sm font-bold">
                        {card.cost}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {card.power || card.toughness ? (
                      <span>
                        {card.power}/{card.toughness}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {card.tags && card.tags.length > 0 ? (
                        card.tags.slice(0, 2).map((tag, idx) => (
                          <span
                            key={idx}
                            className="inline-block px-2 py-0.5 rounded-full text-xs bg-accent/20 text-accent"
                          >
                            {tag}
                          </span>
                        ))
                      ) : null}
                      {card.tags && card.tags.length > 2 && (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs text-text-muted">
                          +{card.tags.length - 2}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="w-20 px-4 py-3 text-right">
                    <div
                      className={`flex gap-1 justify-end transition-opacity ${
                        isHovered ? 'opacity-100' : 'opacity-0'
                      }`}
                    >
                      <button
                        onClick={() => handleEdit(card)}
                        className="p-1.5 hover:bg-surface-3 rounded transition-colors text-text-secondary hover:text-accent"
                        title="Edit"
                      >
                        <Pencil size={18} />
                      </button>
                      <button
                        onClick={() => handleDuplicate(card)}
                        className="p-1.5 hover:bg-surface-3 rounded transition-colors text-text-secondary hover:text-accent"
                        title="Duplicate"
                      >
                        <Copy size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(card.id)}
                        className="p-1.5 hover:bg-surface-3 rounded transition-colors text-text-secondary hover:text-red-500"
                        title="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 border-t border-border bg-surface-1 text-text-muted text-sm">
        Showing {sortedCards.length} card{sortedCards.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}