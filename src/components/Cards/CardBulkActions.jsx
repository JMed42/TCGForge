import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { useStore } from '../../store';

export default function CardBulkActions() {
  const { selectedCardIds, bulkDeleteCards, clearCardSelection } = useStore();
  const [showConfirm, setShowConfirm] = useState(false);

  if (selectedCardIds.length === 0) {
    return null;
  }

  const handleDeleteClick = () => {
    setShowConfirm(true);
  };

  const handleConfirmDelete = () => {
    bulkDeleteCards();
    clearCardSelection();
    setShowConfirm(false);
  };

  return (
    <>
      <div className="fixed bottom-6 left-6 right-6 max-w-3xl mx-auto animate-in slide-in-from-bottom-4 duration-300">
        <div className="bg-surface-2 border border-border rounded-lg shadow-lg p-4 flex items-center justify-between">
          <div className="text-text-primary font-medium">
            {selectedCardIds.length} card{selectedCardIds.length !== 1 ? 's' : ''} selected
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleDeleteClick}
              className="px-4 py-2 bg-red-600/20 text-red-500 hover:bg-red-600/30 rounded transition-colors flex items-center gap-2"
            >
              <Trash2 size={18} />
              Delete Selected
            </button>

            <button
              onClick={clearCardSelection}
              className="px-4 py-2 bg-surface-3 border border-border text-text-secondary hover:text-text-primary hover:bg-surface-4 rounded transition-colors flex items-center gap-2"
            >
              <X size={18} />
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200"
          onClick={() => setShowConfirm(false)}
        >
          <div
            className="bg-surface-1 rounded-lg shadow-xl p-6 max-w-sm border border-border animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              Delete {selectedCardIds.length} Card{selectedCardIds.length !== 1 ? 's' : ''}?
            </h3>
            <p className="text-text-secondary mb-6">
              This action cannot be undone. All selected cards will be permanently deleted.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 bg-surface-2 border border-border text-text-primary hover:bg-surface-3 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded transition-colors"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}