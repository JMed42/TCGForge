import React, { useMemo, useState } from 'react';
import {
  FileText,
  FolderPlus,
  FolderOpen,
  FolderClosed,
  BookMarked,
  MoreVertical,
  Trash2,
  Pencil,
  FolderOpen as MoveIcon,
} from 'lucide-react';
import { useStore } from '../../store';

export default function DocumentTree() {
  const {
    documents,
    activeDocumentId,
    expandedFolders,
    setActiveDocument,
    createDocument,
    deleteDocument,
    moveDocument,
    toggleFolder,
    activeProjectId,
  } = useStore();

  const [renameId, setRenameId] = useState(null);
  const [renameName, setRenameName] = useState('');
  const [contextMenuId, setContextMenuId] = useState(null);
  const [contextMenuPos, setContextMenuPos] = useState(null);

  // Filter documents to only show those in the active project
  const projectDocuments = useMemo(
    () =>
      documents
        .filter((doc) => doc.project_id === activeProjectId)
        .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)),
    [documents, activeProjectId]
  );

  // Build tree: root documents (parent_id is null)
  const rootDocuments = useMemo(
    () => projectDocuments.filter((doc) => !doc.parent_id),
    [projectDocuments]
  );

  const getChildrenOf = (parentId) => {
    return projectDocuments
      .filter((doc) => doc.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
  };

  const handleNewDocument = () => {
    createDocument({
      title: 'Untitled Document',
      type: 'document',
      parentId: null,
    });
  };

  const handleNewFolder = () => {
    createDocument({
      title: 'New Folder',
      type: 'folder',
      parentId: null,
    });
  };

  const handleNewRule = () => {
    createDocument({
      title: 'Untitled Rule',
      type: 'rule',
      parentId: null,
    });
  };

  const handleContextMenu = (e, docId) => {
    e.preventDefault();
    setContextMenuId(docId);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleRename = (doc) => {
    setRenameId(doc.id);
    setRenameName(doc.title);
    setContextMenuId(null);
  };

  const handleRenameSubmit = (docId) => {
    if (renameName.trim()) {
      const { updateDocument } = useStore.getState();
      updateDocument(docId, { title: renameName.trim() });
    }
    setRenameId(null);
  };

  const handleDelete = (docId) => {
    if (window.confirm('Delete this item? This cannot be undone.')) {
      deleteDocument(docId);
      setContextMenuId(null);
    }
  };

  const handleMoveToFolder = (docId, targetFolderId) => {
    moveDocument(docId, targetFolderId);
    setContextMenuId(null);
  };

  return (
    <div className="w-[280px] bg-surface-1 border-r border-border flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h2 className="text-text-primary font-semibold text-sm mb-3">Documents</h2>
        <div className="flex gap-2">
          <button
            onClick={handleNewDocument}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-3 hover:bg-surface-4 text-text-primary text-xs rounded transition-colors"
            title="New Document"
          >
            <FileText size={14} />
            <span>Doc</span>
          </button>
          <button
            onClick={handleNewFolder}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-3 hover:bg-surface-4 text-text-primary text-xs rounded transition-colors"
            title="New Folder"
          >
            <FolderPlus size={14} />
            <span>Folder</span>
          </button>
          <button
            onClick={handleNewRule}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-3 hover:bg-surface-4 text-accent text-xs rounded transition-colors"
            title="New Rule"
          >
            <BookMarked size={14} />
            <span>Rule</span>
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {rootDocuments.length === 0 ? (
          <div className="p-4 text-text-muted text-xs text-center">
            No documents yet. Create one to get started.
          </div>
        ) : (
          <div className="py-1">
            {rootDocuments.map((doc) => (
              <TreeItem
                key={doc.id}
                doc={doc}
                depth={0}
                isActive={activeDocumentId === doc.id}
                isExpanded={expandedFolders.has(doc.id)}
                children={getChildrenOf(doc.id)}
                onSelect={setActiveDocument}
                onToggle={toggleFolder}
                onContextMenu={handleContextMenu}
                onRename={handleRename}
                onRenameSubmit={handleRenameSubmit}
                onDelete={handleDelete}
                onMoveTo={handleMoveToFolder}
                isRenaming={renameId === doc.id}
                renameName={renameName}
                setRenameName={setRenameName}
                contextMenuId={contextMenuId}
                contextMenuPos={contextMenuPos}
                projectDocuments={projectDocuments}
              />
            ))}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenuId && contextMenuPos && (
        <ContextMenu
          pos={contextMenuPos}
          docId={contextMenuId}
          doc={projectDocuments.find((d) => d.id === contextMenuId)}
          onRename={() => {
            const doc = projectDocuments.find((d) => d.id === contextMenuId);
            handleRename(doc);
          }}
          onDelete={() => handleDelete(contextMenuId)}
          onMoveTo={(targetId) => handleMoveToFolder(contextMenuId, targetId)}
          allFolders={projectDocuments.filter((d) => d.type === 'folder')}
          onClose={() => setContextMenuId(null)}
        />
      )}
    </div>
  );
}

function TreeItem({
  doc,
  depth,
  isActive,
  isExpanded,
  children,
  onSelect,
  onToggle,
  onContextMenu,
  onRename,
  onDelete,
  onMoveTo,
  isRenaming,
  renameName,
  setRenameName,
  contextMenuId,
  contextMenuPos,
  projectDocuments,
}) {
  const isFolder = doc.type === 'folder';
  const isRule = doc.type === 'rule';

  const getIcon = () => {
    if (isFolder) {
      return isExpanded ? (
        <FolderOpen size={16} className="text-text-secondary" />
      ) : (
        <FolderClosed size={16} className="text-text-secondary" />
      );
    }
    if (isRule) {
      return <BookMarked size={16} className="text-accent" />;
    }
    return <FileText size={16} className="text-text-secondary" />;
  };

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer group transition-colors ${
          isActive ? 'bg-surface-3 text-accent' : 'hover:bg-surface-2 text-text-primary'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          if (isFolder) {
            onToggle(doc.id);
          } else {
            onSelect(doc.id);
          }
        }}
        onContextMenu={(e) => onContextMenu(e, doc.id)}
      >
        {isFolder && (
          <div
            className="flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(doc.id);
            }}
          >
            {getIcon()}
          </div>
        )}
        {!isFolder && <div className="flex-shrink-0">{getIcon()}</div>}

        {isRenaming ? (
          <input
            autoFocus
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const { updateDocument } = useStore.getState();
                if (renameName.trim()) {
                  updateDocument(doc.id, { title: renameName.trim() });
                }
              }
              if (e.key === 'Escape') {
                const { updateDocument } = useStore.getState();
                updateDocument(doc.id, {});
              }
            }}
            onBlur={() => {
              const { updateDocument } = useStore.getState();
              if (renameName.trim()) {
                updateDocument(doc.id, { title: renameName.trim() });
              }
            }}
            className="flex-1 px-2 py-0.5 bg-surface-4 text-text-primary text-sm rounded border border-border focus:outline-none focus:border-accent"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 text-sm truncate">{doc.title}</span>
        )}

        <button
          className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 hover:bg-surface-3 rounded transition-all"
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(e, doc.id);
          }}
        >
          <MoreVertical size={14} className="text-text-muted" />
        </button>
      </div>

      {isFolder && isExpanded && children.length > 0 && (
        <div>
          {children.map((child) => {
            const { expandedFolders, activeDocumentId } = useStore.getState();
            const childChildren = projectDocuments.filter((d) => d.parent_id === child.id);
            return (
            <TreeItem
              key={child.id}
              doc={child}
              depth={depth + 1}
              isActive={activeDocumentId === child.id}
              isExpanded={expandedFolders.has(child.id)}
              children={childChildren}
              onSelect={onSelect}
              onToggle={onToggle}
              onContextMenu={onContextMenu}
              onRename={onRename}
              onDelete={onDelete}
              onMoveTo={onMoveTo}
              isRenaming={false}
              renameName=""
              setRenameName={setRenameName}
              contextMenuId={contextMenuId}
              contextMenuPos={contextMenuPos}
              projectDocuments={projectDocuments}
            />
          );
          })}
        </div>
      )}
    </div>
  );
}

function ContextMenu({
  pos,
  docId,
  doc,
  onRename,
  onDelete,
  onMoveTo,
  allFolders,
  onClose,
}) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed bg-surface-2 border border-border rounded shadow-lg z-50 py-1"
      style={{ top: `${pos.y}px`, left: `${pos.x}px` }}
    >
      <button
        onClick={() => {
          onRename();
          onClose();
        }}
        className="w-full px-4 py-2 text-left text-text-primary text-sm hover:bg-surface-3 flex items-center gap-2 transition-colors"
      >
        <Pencil size={14} />
        Rename
      </button>

      {allFolders.length > 0 && (
        <>
          <div className="border-t border-border my-1" />
          <div className="px-4 py-1 text-text-muted text-xs font-semibold">Move to:</div>
          {allFolders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => {
                onMoveTo(folder.id);
                onClose();
              }}
              className="w-full px-8 py-2 text-left text-text-primary text-sm hover:bg-surface-3 transition-colors"
            >
              {folder.title}
            </button>
          ))}
        </>
      )}

      <div className="border-t border-border my-1" />
      <button
        onClick={() => {
          onDelete();
          onClose();
        }}
        className="w-full px-4 py-2 text-left text-red-400 text-sm hover:bg-surface-3 flex items-center gap-2 transition-colors"
      >
        <Trash2 size={14} />
        Delete
      </button>
    </div>
  );
}
