import { useState } from 'react'
import { useStore } from '../../store'
import { X } from 'lucide-react'

export default function ProjectForm({ project, onClose }) {
  const { createProject, updateProject } = useStore()
  const [name, setName]               = useState(project?.name || '')
  const [description, setDescription] = useState(project?.description || '')
  const [schemaError, setSchemaError] = useState('') // "name is required"
  const [isSaving, setIsSaving]       = useState(false)
  const [starter, setStarter] = useState('blank')

  const handleSave = async () => {
    if (!name.trim()) {
      setSchemaError('Project name is required')
      return
    }

    setIsSaving(true)
    try {
      const data = {
        name: name.trim(),
        description: description.trim(),
        ...(project?.id ? {} : { starter }),
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

          {/* Starting card types (new projects) */}
          {!project && (
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-text-primary">Start with</span>
              {[
                ['blank', 'Blank', 'One card type with Name, Cost, Card text and Art. Add your own fields in Card Types.'],
                ['classic', 'Classic TCG fields', 'Type line, set, rarity, cost, power, toughness, card text, flavor text, tags, notes and art.'],
              ].map(([value, title, text]) => (
                <label key={value} className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${starter === value ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface-3'}`}>
                  <input type="radio" name="starter" value={value} checked={starter === value} onChange={() => setStarter(value)} className="mt-1 accent-accent" data-starter={value} />
                  <span>
                    <span className="block text-sm text-text-primary">{title}</span>
                    <span className="block text-xs text-text-muted">{text}</span>
                  </span>
                </label>
              ))}
              <p className="text-xs text-text-muted">You can rename types and add or remove fields at any time in Card Types.</p>
            </div>
          )}

          {/* Name-required error (shown outside advanced section) */}
          {schemaError && (
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
