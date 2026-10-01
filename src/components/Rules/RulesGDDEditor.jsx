import React from 'react';
import DocumentTree from './DocumentTree';
import RulesEditor from './RulesEditor';

export default function RulesGDDEditor() {
  return (
    <div className="flex w-full h-full bg-surface-0">
      <DocumentTree />
      <RulesEditor />
    </div>
  );
}
