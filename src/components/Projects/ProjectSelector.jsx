import { useState } from 'react'
import { useStore } from '../../store'
import { Plus, Layers } from 'lucide-react'
import ProjectForm from './ProjectForm'

export default function ProjectSelector() {
  const [showProjectForm, setShowProjectForm] = useState(false)
  const { projects, setActiveProject } = useStore()

  return (
    <div className="flex items-center justify-center w-full h-screen bg-surface-0">
      <div className="max-w-6xl w-full px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Layers size={40} className="text-accent" />
            <h1 className="text-4xl font-bold text-text-primary">TCG Studio</h1>
          </div>
          <p className="text-text-secondary text-lg">
            Select a project or create a new one
          </p>
        </div>

        {/* Projects Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => setActiveProject(project.id)}
              className="bg-surface-2 hover:bg-surface-3 rounded-xl p-6 text-left transition-colors border border-border hover:border-accent"
            >
              <h3 className="text-lg font-semibold text-text-primary mb-2">
                {project.name}
              </h3>
              <p className="text-text-secondary text-sm mb-4">
                {project.description}
              </p>
              <p className="text-text-muted text-xs">
                {project.cardCount || 0} cards
              </p>
            </button>
          ))}

          {/* Create New Project Card */}
          <button
            onClick={() => setShowProjectForm(true)}
            className="bg-surface-2 hover:bg-surface-3 rounded-xl p-6 border-2 border-dashed border-border hover:border-accent transition-colors flex flex-col items-center justify-center min-h-32"
          >
            <Plus size={32} className="text-text-secondary mb-2" />
            <p className="text-text-primary font-semibold">Create New Project</p>
          </button>
        </div>
      </div>

      {/* Project Form Modal */}
      {showProjectForm && (
        <ProjectForm
          project={null}
          onClose={() => setShowProjectForm(false)}
        />
      )}
    </div>
  )
}
