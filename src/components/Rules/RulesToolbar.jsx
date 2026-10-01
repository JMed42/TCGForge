import React from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Table,
  Link,
} from 'lucide-react';

export default function RulesToolbar({ editor }) {
  if (!editor) return null;

  const ButtonGroup = ({ children }) => (
    <div className="flex items-center gap-1">{children}</div>
  );

  const ToolButton = ({ icon: Icon, onClick, isActive, title, size = 16 }) => (
    <button
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      title={title}
      className={`p-2 rounded transition-colors ${
        isActive
          ? 'bg-accent text-white'
          : 'bg-surface-3 text-text-primary hover:bg-surface-4'
      }`}
    >
      <Icon size={size} />
    </button>
  );

  const Separator = () => <div className="w-px h-6 bg-border mx-1" />;

  return (
    <div className="flex items-center gap-0.5 p-2 bg-surface-2 border-b border-border flex-wrap">
      {/* Text formatting */}
      <ButtonGroup>
        <ToolButton
          icon={Bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title="Bold (Ctrl+B)"
        />
        <ToolButton
          icon={Italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="Italic (Ctrl+I)"
        />
        <ToolButton
          icon={Underline}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive('underline')}
          title="Underline (Ctrl+U)"
        />
        <ToolButton
          icon={Strikethrough}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive('strike')}
          title="Strikethrough"
        />
        <ToolButton
          icon={Highlighter}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          isActive={editor.isActive('highlight')}
          title="Highlight"
        />
        <ToolButton
          icon={Code}
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive('code')}
          title="Code"
        />
      </ButtonGroup>

      <Separator />

      {/* Headings */}
      <ButtonGroup>
        <ToolButton
          icon={Heading1}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive('heading', { level: 1 })}
          title="Heading 1"
        />
        <ToolButton
          icon={Heading2}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
          title="Heading 2"
        />
        <ToolButton
          icon={Heading3}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editor.isActive('heading', { level: 3 })}
          title="Heading 3"
        />
      </ButtonGroup>

      <Separator />

      {/* Lists & quotes */}
      <ButtonGroup>
        <ToolButton
          icon={List}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title="Bullet List"
        />
        <ToolButton
          icon={ListOrdered}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          title="Ordered List"
        />
        <ToolButton
          icon={Quote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
          title="Blockquote"
        />
      </ButtonGroup>

      <Separator />

      {/* Table */}
      <ButtonGroup>
        <ToolButton
          icon={Table}
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
          isActive={editor.isActive('table')}
          title="Insert Table"
        />
      </ButtonGroup>

      <Separator />

      {/* Link */}
      <ButtonGroup>
        <ToolButton
          icon={Link}
          onClick={() => {
            const url = window.prompt('Enter URL:');
            if (url) {
              editor.chain().focus().toggleLink({ href: url }).run();
            }
          }}
          isActive={editor.isActive('link')}
          title="Insert Link"
        />
      </ButtonGroup>
    </div>
  );
}
