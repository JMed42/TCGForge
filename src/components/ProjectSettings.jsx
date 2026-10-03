import { useState } from 'react'
import { useStore } from '../store'
import { Trash2, Download, Upload } from 'lucide-react'

export default function ProjectSettings() {
  const {
    projects,
    activeProjectId,
    updateProject,
    deleteProject,
    setActiveProject,
  } = useStore()

  const project = projects.find((p) => p.id === activeProjectId)

  const [editName, setEditName] = useState(project?.name || '')
  const [editDescription, setEditDescription] = useState(
    project?.description || ''
  )
  const [editSchema, setEditSchema] = useState(
    JSON.stringify(project?.cardSchema || {}, null, 2)
  )
  const [schemaError, setSchemaError] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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

  const handleSaveChanges = async () => {
    if (!editName.trim()) {
      setSchemaError('Project name is required')
      return
    }

    if (!validateSchema(editSchema)) {
      return
    }

    try {
      await updateProject(activeProjectId, {
        name: editName.trim(),
        description: editDescription.trim(),
        cardSchema: JSON.parse(editSchema),
      })
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to save changes:', error)
    }
  }

  const handleDeleteProject = async () => {
    try {
      await deleteProject(activeProjectId)
      setShowDeleteConfirm(false)
    } catch (error) {
      console.error('Failed to delete project:', error)
    }
  }

  const handleExportAsJSON = () => {
    try {
      const data = JSON.stringify(project, null, 2)
      const blob = new Blob([data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${project?.name || 'project'}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to export project:', error)
    }
  }

  const handleImportFromJSON = async () => {
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = async (e) => {
        const file = e.target.files?.[0]
        if (!file) return

        const text = await file.text()
        const data = JSON.parse(text)

        await updateProject(activeProjectId, {
          name: data.name || editName,
          description: data.description || editDescription,
          cardSchema: data.cardSchema || JSON.parse(editSchema),
        })
      }
      input.click()
    } catch (error) {
      console.error('Failed to import project:', error)
      setSchemaError('Invalid JSON file')
    }
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-text-secondary">No project selected</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-surface-0">
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {/* Project Info Section */}
        <div className="bg-surface-1 rounded-xl p-6 border border-border">
          <h2 className="text-2xl font-bold text-text-primary mb-6">
            Project Settings
          </h2>

          {!isEditing ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-text-muted uppercase">
                  Project Name
                </p>
                <p className="text-lg font-semibold text-text-primary">
                  {editName}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-text-muted uppercase">
                  Description
                </p>
                <p className="text-text-secondary">
                  {editDescription || 'No description'}
                </p>
              </div>
              <button
                onClick={() => setIsEditing(true)}
                className="mt-4 px-4 py-2 bg-accent hover:brightness-110 rounded-lg text-white font-medium transition-all"
              >
                Edit Project
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">
                  Project Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-4 py-2 bg-surface-3 border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">
                  Description
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2 bg-surface-3 border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent resize-none"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setIsEditing(false)
                    setSchemaError('')
                  }}
                  className="px-4 py-2 bg-surface-3 hover:bg-surface-4 rounded-lg text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveChanges}
                  className="px-4 py-2 bg-accent hover:brightness-110 rounded-lg text-white font-medium transition-all"
                >
                  Save Changes
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Card types and fields live on their own screen now */}
        <div className="bg-surface-1 rounded-xl p-6 border border-border">
          <h3 className="text-lg font-bold text-text-primary mb-2">Card types and fields</h3>
          <p className="text-sm text-text-secondary mb-4">
            The fields your cards have (cost, ATK, effect…) are set per card type on the Card Types screen.
          </p>
          <button
            onClick={() => useStore.getState().setActiveView('types')}
            className="px-4 py-2 bg-accent hover:brightness-110 rounded-lg text-white font-medium transition-all"
          >
            Open Card Types
          </button>
        </div>

        {/* Import/Export Section */}
        <div className="bg-surface-1 rounded-xl p-6 border border-border">
          <h3 className="text-lg font-bold text-text-primary mb-4">
            Import & Export
          </h3>
          <div className="flex gap-3">
            <button
              onClick={handleExportAsJSON}
              className="flex items-center gap-2 px-4 py-2 bg-surface-2 hover:bg-surface-3 rounded-lg text-text-primary transition-colors"
            >
              <Download size={18} />
              Export as JSON
            </button>
            <button
              onClick={handleImportFromJSON}
              className="flex items-center gap-2 px-4 py-2 bg-surface-2 hover:bg-surface-3 rounded-lg text-text-primary transition-colors"
            >
              <Upload size={18} />
              Import from JSON
            </button>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-surface-1 rounded-xl p-6 border border-red-900 border-opacity-30">
          <h3 className="text-lg font-bold text-red-500 mb-4">Danger Zone</h3>
          <p className="text-text-secondary mb-4">
            Deleting a project is permanent and cannot be undone.
          </p>

          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:brightness-110 rounded-lg text-white font-medium transition-all"
            >
              <Trash2 size={18} />
              Delete Project
            </button>
          ) : (
            <div className="space-y-4">
              <p className="text-text-primary">
                Are you sure you want to delete "{project.name}"? This action
                cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 bg-surface-3 hover:bg-surface-4 rounded-lg text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteProject}
                  className="px-4 py-2 bg-red-500 hover:brightness-110 rounded-lg text-white font-medium transition-all"
                >
                  Yes, Delete Project
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
