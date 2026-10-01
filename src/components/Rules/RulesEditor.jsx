import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { useStore } from '../../store';
import RulesToolbar from './RulesToolbar';
import { Clock, FileText } from 'lucide-react';

export default function RulesEditor() {
  const {
    documents,
    activeDocumentId,
    updateDocument,
    setActiveDocument,
  } = useStore();

  const [titleEditMode, setTitleEditMode] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [category, setCategory] = useState('Core Rules');
  const [relatedRules, setRelatedRules] = useState([]);
  const [showRelatedRulesDropdown, setShowRelatedRulesDropdown] = useState(false);
  const saveTimeoutRef = useRef(null);

  const activeDoc = documents.find((doc) => doc.id === activeDocumentId);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight.configure({ multicolor: true }),
      Underline,
      Link.configure({
        openOnClick: true,
      }),
      Placeholder.configure({
        placeholder: 'Start typing your document content...',
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: activeDoc?.content || '',
    onUpdate: ({ editor }) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        if (activeDocumentId) {
          updateDocument(activeDocumentId, {
            content: editor.getHTML(),
          });
        }
      }, 800);
    },
  });

  // Update editor content when active document changes
  useEffect(() => {
    if (editor && activeDoc) {
      editor.commands.setContent(activeDoc.content || '');
      setEditingTitle(activeDoc.title);
      setCategory('Core Rules');
      setRelatedRules([]);
    }
  }, [activeDoc?.id, editor]);

  if (!activeDoc) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-surface-0 text-center">
        <FileText size={48} className="text-text-muted mb-4 opacity-50" />
        <p className="text-text-muted text-lg mb-2">No document selected</p>
        <p className="text-text-muted text-sm">
          Select a document from the sidebar or create a new one to get started
        </p>
      </div>
    );
  }

  const handleSaveTitle = () => {
    if (editingTitle.trim() && editingTitle !== activeDoc.title) {
      updateDocument(activeDocumentId, {
        title: editingTitle.trim(),
      });
    }
    setTitleEditMode(false);
  };

  const generateRuleId = () => {
    return `RULE-${editingTitle
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]/g, '')}`;
  };

  const rulesInProject = documents.filter(
    (doc) =>
      doc.project_id === activeDoc.project_id &&
      doc.type === 'rule' &&
      doc.id !== activeDocumentId
  );

  const isRule = activeDoc.type === 'rule';

  return (
    <div className="flex-1 flex flex-col bg-surface-0 overflow-hidden">
      {/* Title Bar */}
      <div className="border-b border-border bg-surface-1 p-4">
        <div className="flex items-center gap-3 mb-2">
          {titleEditMode ? (
            <input
              autoFocus
              type="text"
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveTitle();
                }
                if (e.key === 'Escape') {
                  setTitleEditMode(false);
                }
              }}
              onBlur={handleSaveTitle}
              className="flex-1 text-2xl font-bold bg-surface-2 text-text-primary px-3 py-2 rounded border border-border focus:outline-none focus:border-accent"
            />
          ) : (
            <h1
              onClick={() => setTitleEditMode(true)}
              className="flex-1 text-2xl font-bold text-text-primary cursor-pointer hover:text-accent transition-colors"
            >
              {editingTitle}
            </h1>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-1 rounded bg-surface-2 text-accent">
              {activeDoc.type.toUpperCase()}
            </span>
          </div>
        </div>

        {activeDoc.updated_at && (
          <div className="flex items-center gap-1 text-text-muted text-xs">
            <Clock size={12} />
            <span>
              Updated{' '}
              {new Date(activeDoc.updated_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        )}
      </div>

      {/* Rule-specific controls */}
      {isRule && (
        <div className="border-b border-border bg-surface-1 px-4 py-3 space-y-3">
          {/* Rule ID */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-text-secondary w-20">
              Rule ID:
            </label>
            <input
              type="text"
              value={generateRuleId()}
              readOnly
              className="flex-1 text-sm px-2 py-1 rounded bg-surface-2 text-text-primary border border-border cursor-not-allowed"
            />
          </div>

          {/* Category */}
          <div className="flex items-center gap-2">
            <label htmlFor="category" className="text-xs font-semibold text-text-secondary w-20">
              Category:
            </label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="flex-1 text-sm px-2 py-1 rounded bg-surface-2 text-text-primary border border-border hover:border-border-hover focus:outline-none focus:border-accent"
            >
              <option>Core Rules</option>
              <option>Combat</option>
              <option>Movement</option>
              <option>Card Types</option>
              <option>Keywords</option>
              <option>Setup</option>
              <option>Victory Conditions</option>
              <option>Custom</option>
            </select>
          </div>

          {/* Related Rules */}
          <div className="flex items-start gap-2">
            <label className="text-xs font-semibold text-text-secondary w-20 mt-1">
              Related Rules:
            </label>
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap gap-1">
                {relatedRules.map((ruleId) => {
                  const rule = documents.find((doc) => doc.id === ruleId);
                  return (
                    <div
                      key={ruleId}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-accent/10 text-accent text-xs rounded group"
                    >
                      <span>{rule?.title || 'Unknown Rule'}</span>
                      <button
                        onClick={() =>
                          setRelatedRules((prev) => prev.filter((id) => id !== ruleId))
                        }
                        className="ml-0.5 hover:text-accent/70"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="relative">
                <button
                  onClick={() => setShowRelatedRulesDropdown(!showRelatedRulesDropdown)}
                  className="text-xs px-2 py-1 rounded bg-surface-2 text-text-primary hover:bg-surface-3 border border-border"
                >
                  + Add Related Rule
                </button>

                {showRelatedRulesDropdown && (
                  <div className="absolute top-full left-0 mt-1 w-48 bg-surface-2 border border-border rounded shadow-lg z-20 max-h-40 overflow-y-auto">
                    {rulesInProject.length === 0 ? (
                      <div className="p-2 text-text-muted text-xs">
                        No other rules available
                      </div>
                    ) : (
                      rulesInProject
                        .filter((rule) => !relatedRules.includes(rule.id))
                        .map((rule) => (
                          <button
                            key={rule.id}
                            onClick={() => {
                              setRelatedRules((prev) => [...prev, rule.id]);
                              setShowRelatedRulesDropdown(false);
                            }}
                            className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-surface-3 text-xs"
                          >
                            {rule.title}
                          </button>
                        ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <RulesToolbar editor={editor} />

      {/* Editor */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <EditorContent
            editor={editor}
            className="h-full prose prose-invert max-w-none px-6 py-4 text-text-primary focus:outline-none
              prose-headings:text-text-primary prose-headings:font-semibold
              prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
              prose-a:text-accent prose-a:no-underline hover:prose-a:underline
              prose-strong:text-text-primary prose-strong:font-semibold
              prose-em:text-text-primary prose-em:italic
              prose-code:bg-surface-2 prose-code:text-accent prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
              prose-pre:bg-surface-2 prose-pre:border prose-pre:border-border prose-pre:rounded
              prose-blockquote:border-l-2 prose-blockquote:border-accent prose-blockquote:text-text-secondary prose-blockquote:italic
              prose-ul:text-text-primary prose-ol:text-text-primary
              prose-li:text-text-primary
              prose-table:border-collapse prose-table:border prose-table:border-border
              prose-th:bg-surface-2 prose-th:text-text-primary prose-th:font-semibold prose-th:border prose-th:border-border prose-th:p-2
              prose-td:border prose-td:border-border prose-td:p-2"
          />
        </div>
      </div>
    </div>
  );
}
