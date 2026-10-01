import { useState } from 'react'
import { useStore } from '../../store'
import { X, ChevronDown, ChevronRight, Settings2 } from 'lucide-react'

const DEFAULT_CARD_SCHEMA = {
  fields: [
    { name: 'name',        type: 'text',     label: 'Card Name',    required: true },
    { name: 'element',     type: 'select',   label: 'Element',      options: ['Fire', 'Water', 'Earth', 'Air', 'Light', 'Dark'] },
    { name: 'class',       type: 'select',   label: 'Class',        options: ['Warrior', 'Mage', 'Rogue', 'Paladin'] },
    { name: 'cost',        type: 'number',   label: 'Mana Cost' },
    { name: 'power',       type: 'number',   label: 'Attack Power' },
    { name: 'health',      type: 'number',   label: 'Health' },
    { name: 'description', type: 'textarea', label: 'Description' },
    { name: 'rarity',      type: 'select',   label: 'Rarity',       options: ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'] },
  ],
}

export default function ProjectForm({ project, onClose }) {
  const { createProject, updateProject } = useStore()
  const [name, setName]               = useState(project?.name || '')
  const [description, setDescription] = useState(project?.description || '')
  const [cardSchema, setCardSchema]   = useState(
    JSON.stringify(project?.cardSchema || DEFAULT_CARD_SCHEMA, null, 2)
  )
  const [schemaError, setSchemaError] = useState('')
  const [isSaving, setIsSaving]       = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const validateSchema = (schemaStr) => {
    try {
      JSON.parse(schemaStr)
      setSchemaError('')
      return true
    } catch (error) {
      setSchemaError(`Invalid JSON: ${error.message}`)
      return false
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setSchemaError('Project name is required')
      return
    }
    if (!validateSchema(cardSchema)) return

    setIsSaving(true)
    try {
      const data = {
        name: name.trim(),
        description: description.trim(),
        cardSchema: JSON.parse(cardSchema),
      }
      if (project?.id) {
        await updateProject(project.id, data)
      } else {
        await createProject(data)
      }
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div className="bg-surface-2 rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-surface-2 z-10">
          <h2 className="text-xl font-bold text-text-primary">
            {project ? 'Edit Project' : 'New Project'}
          </h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <X size={22} />
          </button>
        </div>

        {/* Form */}
        <div className="p-6 space-y-5">

          {/* Name */}
          <div>
            <label className="block text-sm font-semibold text-text-primary mb-1.5">
              Project Name <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="e.g. Stormbound, Hearthfall, Runewar…"
              autoFocus
              className="w-full px-4 py-2.5 bg-surface-3 border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-text-primary mb-1.5">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short summary of your game…"
              rows={3}
              className="w-full px-4 py-2.5 bg-surface-3 border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent resize-none transition-colors"
            />
          </div>

          {/* Advanced: Card Schema */}
          <div className="border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-4 py-3 bg-surface-3 hover:bg-surface-4 transition-colors text-left"
            >
              <div className="flex items-center gap-2 text-text-secondary">
                <Settings2 size={15} />
                <span className="text-sm font-medium">Advanced — Card Schema</span>
              </div>
              {showAdvanced
                ? <ChevronDown size={16} className="text-text-muted" />
                : <ChevronRight size={16} className="text-text-muted" />
              }
            </button>

            {showAdvanced && (
              <div className="p-4 bg-surface-1 border-t border-border space-y-3">
                <p className="text-xs text-text-secondary leading-relaxed">
                  JSON definition of custom fields for cards in this project. The default schema works for most games — only edit this if you need fields beyond the built-in ones (name, type, set, cost, power, toughness, etc.).
                </p>
                <textarea
                  value={cardSchema}
                  onChange={(e) => {
                    setCardSchema(e.target.value)
                    validateSchema(e.target.value)
                  }}
                  className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-text-primary font-mono text-xs focus:outline-none focus:border-accent resize-none leading-relaxed"
                  rows={10}
                  spellCheck={false}
                />
                {schemaError && (
                  <p className="text-xs text-danger">{schemaError}</p>
                )}
              </div>
            )}
          </div>

          {/* Name-required error (shown outside advanced section) */}
          {schemaError && schemaError === 'Project name is required' && (
            <p className="text-xs text-danger -mt-2">{schemaError}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-surface-3 hover:bg-surface-4 rounded-lg text-text-primary text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 bg-accent hover:brightness-110 rounded-lg text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving…' : project ? 'Save Changes' : 'Create Project'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
