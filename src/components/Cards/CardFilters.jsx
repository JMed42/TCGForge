import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useStore } from '../../store';

const RARITY_OPTIONS = ['Common', 'Uncommon', 'Rare', 'Mythic', 'Legendary'];
const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'Type' },
  { value: 'set', label: 'Set' },
  { value: 'cost', label: 'Cost' },
  { value: 'created', label: 'Created' },
];

export default function CardFilters() {
  const { cards, cardFilters, setCardFilters } = useStore();
  const [tagInput, setTagInput] = useState('');

  // Get unique values from cards for dropdowns
  const uniqueTypes = useMemo(() => {
    const types = new Set(cards.map((c) => c.type).filter(Boolean));
    return Array.from(types).sort();
  }, [cards]);

  const uniqueSets = useMemo(() => {
    const sets = new Set(cards.map((c) => c.set_name).filter(Boolean));
    return Array.from(sets).sort();
  }, [cards]);

  const handleSearchChange = (e) => {
    setCardFilters({
      ...cardFilters,
      search: e.target.value,
    });
  };

  const handleTypeChange = (e) => {
    setCardFilters({
      ...cardFilters,
      type: e.target.value || null,
    });
  };

  const handleSetChange = (e) => {
    setCardFilters({
      ...cardFilters,
      set: e.target.value || null,
    });
  };

  const handleRarityChange = (e) => {
    setCardFilters({
      ...cardFilters,
      rarity: e.target.value || null,
    });
  };

  const handleAddTag = (tag) => {
    const trimmedTag = tag.trim();
    if (trimmedTag) {
      const newTags = [...(cardFilters.tags || [])];
      if (!newTags.includes(trimmedTag)) {
        newTags.push(trimmedTag);
        setCardFilters({
          ...cardFilters,
          tags: newTags,
        });
      }
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    const newTags = (cardFilters.tags || []).filter((t) => t !== tagToRemove);
    setCardFilters({
      ...cardFilters,
      tags: newTags,
    });
  };

  const handleTagInputKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag(tagInput);
      setTagInput('');
    }
  };

  const handleSortChange = (e) => {
    setCardFilters({
      ...cardFilters,
      sortBy: e.target.value,
    });
  };

  const handleClearFilters = () => {
    setCardFilters({
      search: '',
      type: null,
      set: null,
      rarity: null,
      tags: [],
      sortBy: 'name',
    });
    setTagInput('');
  };

  const hasActiveFilters =
    cardFilters.search ||
    cardFilters.type ||
    cardFilters.set ||
    cardFilters.rarity ||
    (cardFilters.tags && cardFilters.tags.length > 0);

  return (
    <div className="bg-surface-0 border-b border-border p-4 space-y-4">
      <div className="flex flex-wrap gap-3">
        {/* Search */}
        <div className="flex-1 min-w-[240px]">
          <div className="relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted"
            />
            <input
              type="text"
              placeholder="Search cards..."
              value={cardFilters.search || ''}
              onChange={handleSearchChange}
              className="w-full pl-10 pr-4 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>

        {/* Type */}
        <div className="min-w-[180px]">
          <select
            value={cardFilters.type || ''}
            onChange={handleTypeChange}
            className="w-full px-4 py-2 bg-surface-2 border border-border rounded text-text-primary focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%237c6ef0'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z' clip-rule='evenodd'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.5rem center',
              backgroundSize: '1.5em 1.5em',
              paddingRight: '2.5rem',
            }}
          >
            <option value="">All Types</option>
            {uniqueTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        {/* Set */}
        <div className="min-w-[180px]">
          <select
            value={cardFilters.set || ''}
            onChange={handleSetChange}
            className="w-full px-4 py-2 bg-surface-2 border border-border rounded text-text-primary focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%237c6ef0'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z' clip-rule='evenodd'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.5rem center',
              backgroundSize: '1.5em 1.5em',
              paddingRight: '2.5rem',
            }}
          >
            <option value="">All Sets</option>
            {uniqueSets.map((set) => (
              <option key={set} value={set}>
                {set}
              </option>
            ))}
          </select>
        </div>

        {/* Rarity */}
        <div className="min-w-[180px]">
          <select
            value={cardFilters.rarity || ''}
            onChange={handleRarityChange}
            className="w-full px-4 py-2 bg-surface-2 border border-border rounded text-text-primary focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%237c6ef0'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z' clip-rule='evenodd'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.5rem center',
              backgroundSize: '1.5em 1.5em',
              paddingRight: '2.5rem',
            }}
          >
            <option value="">All Rarities</option>
            {RARITY_OPTIONS.map((rarity) => (
              <option key={rarity} value={rarity}>
                {rarity}
              </option>
            ))}
          </select>
        </div>

        {/* Sort */}
        <div className="min-w-[140px]">
          <select
            value={cardFilters.sortBy || 'name'}
            onChange={handleSortChange}
            className="w-full px-4 py-2 bg-surface-2 border border-border rounded text-text-primary focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%237c6ef0'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z' clip-rule='evenodd'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.5rem center',
              backgroundSize: '1.5em 1.5em',
              paddingRight: '2.5rem',
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                Sort: {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={handleClearFilters}
            className="px-4 py-2 bg-surface-2 border border-border rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors flex items-center gap-2"
            title="Clear all filters"
          >
            <X size={18} />
            Clear
          </button>
        )}
      </div>

      {/* Tags Section */}
      <div className="flex flex-wrap gap-3 items-start">
        <div className="flex-1 min-w-[240px]">
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Add tags (comma or Enter to add)..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagInputKeyDown}
              className="w-full px-4 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
            />
            {cardFilters.tags && cardFilters.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {cardFilters.tags.map((tag) => (
                  <div
                    key={tag}
                    className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/20 text-accent text-sm"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-accent/70 transition-colors"
                      type="button"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}