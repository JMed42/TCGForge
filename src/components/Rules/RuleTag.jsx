import React from 'react';
import { BookMarked } from 'lucide-react';

export default function RuleTag({ ruleId, title, onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-accent/10 text-accent rounded text-sm hover:bg-accent/20 transition-colors"
      title={`Rule: ${title}`}
    >
      <BookMarked size={12} />
      <span>{title}</span>
    </button>
  );
}
