import { useState } from 'react'
import { useStore } from '../../store'
import { Plus, X } from 'lucide-react'
import ProjectForm from './ProjectForm'

export default function ProjectSwitcher({ onClose }) {
  const [showProjectForm, setShowProjectForm] = useState(false)
  const { projects, setActiveProject } = useStore()

  const handleSelectProject = (id) => {
    setActiveProject(id)
    onClose()
  }

  if (showProjectForm) {
    return (
      <>
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={onClose}
        />
        <ProjectForm
          project={null}
          onClose={() => {
            setShowProjectForm(false)
            onClose()
          }}
        />
      </>
    )
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />
      <div className="fixed top-16 left-60 bg-surface-2 rounded-lg shadow-lg border border-border z-50 w-80 max-h-96 overflow-y-auto">
        <div className="p-3 border-b border-border sticky top-0 bg-surface-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-text-primary">Projects</p>
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="space-y-1 p-2">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => handleSelectProject(project.id)}
              className="w-full text-left px-3 py-2 hover:bg-surface-3 rounded transition-colors"
            >
              <p className="text-sm font-medium text-text-primary">
                {project.name}
              </p>
              <p className="text-xs text-text-secondary">
                {project.cardCount || 0} cards
              </p>
            </button>
          ))}
        </div>

        <div className="p-2 border-t border-border">
          <button
            onClick={() => setShowProjectForm(true)}
            className="w-full flex items-center gap-2 px-3 py-2 bg-surface-3 hover:bg-surface-4 rounded transition-colors text-text-primary text-sm font-medium"
          >
            <Plus size={16} />
            New Project
          </button>
        </div>
      </div>
    </>
  )
}
