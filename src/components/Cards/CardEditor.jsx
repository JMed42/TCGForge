import React, { useState, useMemo, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useStore } from '../../store';
import CardArtField from './CardArtField';

const RARITY_OPTIONS = ['Common', 'Uncommon', 'Rare', 'Mythic', 'Legendary'];

export default function CardEditor() {
  const {
    editingCard,
    setEditingCard,
    cards,
    createCard,
    updateCard,
    deleteCard,
    activeProjectId,
  } = useStore();

  const [formData, setFormData] = useState({});
  const [tagInput, setTagInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Initialize form with editing card data
  useEffect(() => {
    if (editingCard) {
      setFormData({
        name: editingCard.name || '',
        type: editingCard.type || '',
        set_name: editingCard.set_name || '',
        rarity: editingCard.rarity || '',
        cost: editingCard.cost || '',
        power: editingCard.power || '',
        toughness: editingCard.toughness || '',
        rules_text: editingCard.rules_text || '',
        flavor_text: editingCard.flavor_text || '',
        tags: editingCard.tags || [],
        notes: editingCard.notes || '',
        image_path: editingCard.image_path || '',
        custom_fields: editingCard.custom_fields || {},
      });
      setTagInput('');
    }
  }, [editingCard]);

  // Get unique suggestions for inputs
  const typeSuggestions = useMemo(() => {
    const types = new Set(cards.map((c) => c.type).filter(Boolean));
    return Array.from(types).sort();
  }, [cards]);

  const setSuggestions = useMemo(() => {
    const sets = new Set(cards.map((c) => c.set_name).filter(Boolean));
    return Array.from(sets).sort();
  }, [cards]);

  // Get custom fields from project schema if available
  const customFields = useMemo(() => {
    return [];
  }, [activeProjectId]);

  const isNewCard = !editingCard?.id;

  const handleChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleAddTag = (tag) => {
    const trimmedTag = tag.trim();
    if (trimmedTag && !formData.tags.includes(trimmedTag)) {
      setFormData((prev) => ({
        ...prev,
        tags: [...prev.tags, trimmedTag],
      }));
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tagToRemove),
    }));
  };

  const handleTagInputKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag(tagInput);
      setTagInput('');
    }
  };

  const handleSave = () => {
    if (!formData.name?.trim()) {
      alert('Card name is required');
      return;
    }

    const cardData = {
      ...formData,
      tags: formData.tags,
    };

    if (isNewCard) {
      createCard(cardData);
    } else {
      updateCard(editingCard.id, cardData);
    }

    setEditingCard(null);
  };

  const handleDelete = () => {
    if (editingCard?.id) {
      deleteCard(editingCard.id);
      setEditingCard(null);
    }
  };

  const handleCancel = () => {
    setEditingCard(null);
  };

  if (!editingCard) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 transition-opacity"
      onClick={handleCancel}
      style={{ pointerEvents: editingCard ? 'auto' : 'none' }}
    >
      <div
        className="fixed right-0 top-0 bottom-0 w-[500px] bg-surface-1 border-l border-border shadow-xl transform transition-transform"
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: editingCard ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="text-xl font-semibold text-text-primary">
              {isNewCard ? 'Create Card' : 'Edit Card'}
            </h2>
            <button
              onClick={handleCancel}
              className="p-1 hover:bg-surface-2 rounded transition-colors text-text-muted hover:text-text-primary"
            >
              <X size={24} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* Art */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Art
              </h3>
              <CardArtField
                projectId={activeProjectId}
                value={formData.image_path || ''}
                onChange={(path) => handleChange('image_path', path)}
              />
            </div>

            {/* Basic Info Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Basic Info
              </h3>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="Card name"
                  className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Type
                </label>
                <div className="relative">
                  <input
                    type="text"
                    list="type-suggestions"
                    value={formData.type || ''}
                    onChange={(e) => handleChange('type', e.target.value)}
                    placeholder="e.g. Creature, Sorcery"
                    className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                  />
                  <datalist id="type-suggestions">
                    {typeSuggestions.map((type) => (
                      <option key={type} value={type} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Set
                </label>
                <div className="relative">
                  <input
                    type="text"
                    list="set-suggestions"
                    value={formData.set_name || ''}
                    onChange={(e) => handleChange('set_name', e.target.value)}
                    placeholder="e.g. Alpha, Beta"
                    className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                  />
                  <datalist id="set-suggestions">
                    {setSuggestions.map((set) => (
                      <option key={set} value={set} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Rarity
                </label>
                <select
                  value={formData.rarity || ''}
                  onChange={(e) => handleChange('rarity', e.target.value)}
                  className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%237c6ef0'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z' clip-rule='evenodd'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '1.5em 1.5em',
                    paddingRight: '2.5rem',
                  }}
                >
                  <option value="">Select rarity</option>
                  {RARITY_OPTIONS.map((rarity) => (
                    <option key={rarity} value={rarity}>
                      {rarity}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Stats Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Stats
              </h3>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Cost
                  </label>
                  <input
                    type="text"
                    value={formData.cost || ''}
                    onChange={(e) => handleChange('cost', e.target.value)}
                    placeholder="e.g. 3, 2RR"
                    className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Power
                  </label>
                  <input
                    type="text"
                    value={formData.power || ''}
                    onChange={(e) => handleChange('power', e.target.value)}
                    placeholder="e.g. 3"
                    className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Toughness
                  </label>
                  <input
                    type="text"
                    value={formData.toughness || ''}
                    onChange={(e) => handleChange('toughness', e.target.value)}
                    placeholder="e.g. 4"
                    className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* Text Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Text
              </h3>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Rules Text
                </label>
                <textarea
                  value={formData.rules_text || ''}
                  onChange={(e) => handleChange('rules_text', e.target.value)}
                  placeholder="Enter card abilities..."
                  rows="4"
                  className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Flavor Text
                </label>
                <textarea
                  value={formData.flavor_text || ''}
                  onChange={(e) => handleChange('flavor_text', e.target.value)}
                  placeholder="Enter flavor text..."
                  rows="2"
                  className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors italic"
                />
              </div>
            </div>

            {/* Organization Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Organization
              </h3>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Tags
                </label>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagInputKeyDown}
                  placeholder="Add tags (Enter or comma to add)"
                  className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors mb-2"
                />
                {formData.tags && formData.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {formData.tags.map((tag) => (
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

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Notes
                </label>
                <textarea
                  value={formData.notes || ''}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  placeholder="Internal notes..."
                  rows="3"
                  className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                />
              </div>
            </div>

            {/* Custom Fields Section */}
            {customFields.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wide">
                  Custom Fields
                </h3>
                {customFields.map((field) => (
                  <div key={field.name}>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      {field.label}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea
                        value={formData[field.name] || ''}
                        onChange={(e) => handleChange(field.name, e.target.value)}
                        placeholder={field.placeholder}
                        rows="3"
                        className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                      />
                    ) : field.type === 'select' ? (
                      <select
                        value={formData[field.name] || ''}
                        onChange={(e) => handleChange(field.name, e.target.value)}
                        className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
                      >
                        <option value="">Select {field.label}</option>
                        {field.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type}
                        value={formData[field.name] || ''}
                        onChange={(e) => handleChange(field.name, e.target.value)}
                        placeholder={field.placeholder}
                        className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border bg-surface-0 flex gap-3 justify-between">
            <div>
              {!isNewCard && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-2 bg-red-600/20 text-red-500 hover:bg-red-600/30 rounded transition-colors flex items-center gap-2"
                >
                  <Trash2 size={18} />
                  Delete
                </button>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                className="px-4 py-2 bg-surface-2 border border-border text-text-primary hover:bg-surface-3 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-accent text-white hover:bg-accent/90 rounded transition-colors"
              >
                Save Card
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="bg-surface-1 rounded-lg shadow-xl p-6 max-w-sm border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              Delete Card?
            </h3>
            <p className="text-text-secondary mb-6">
              This action cannot be undone. Are you sure you want to delete{' '}
              <strong>{formData.name}</strong>?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 bg-surface-2 border border-border text-text-primary hover:bg-surface-3 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}