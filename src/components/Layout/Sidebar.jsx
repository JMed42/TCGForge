import { useState } from 'react'
import { useStore } from '../../store'
import {
  Database,
  Layers,
  BookOpen,
  Shapes,
  Settings,
  Download,
  ChevronDown,
  Plus,
  Library,
} from 'lucide-react'
import ProjectSwitcher from '../Projects/ProjectSwitcher'

export default function Sidebar() {
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false)
  const {
    projects,
    activeProjectId,
    activeView,
    setActiveView,
  } = useStore()

  const currentProject = projects.find((p) => p.id === activeProjectId)

  const handleExport = async () => {
    try {
      await window.api?.exportProject?.(activeProjectId)
    } catch (error) {
      console.error('Failed to export project:', error)
    }
  }

  const navItems = [
    { icon: Database, label: 'Cards', view: 'cards' },
    { icon: Shapes, label: 'Card Types', view: 'types' },
    { icon: Layers, label: 'Designer', view: 'designer' },
    { icon: Library, label: 'Library', view: 'library' },
    { icon: BookOpen, label: 'Game Docs', view: 'rules' },
    { icon: Settings, label: 'Settings', view: 'settings' },
  ]

  return (
    <>
      <div className="w-60 bg-surface-1 border-r border-border flex flex-col h-screen">
        {/* Project Selector */}
        <div className="p-4 border-b border-border">
          <button
            onClick={() => setShowProjectSwitcher(true)}
            className="w-full flex items-center justify-between px-3 py-2 bg-surface-2 hover:bg-surface-3 rounded-lg transition-colors"
          >
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate">
                {currentProject?.name || 'No Project'}
              </p>
            </div>
            <ChevronDown size={16} className="text-text-secondary flex-shrink-0 ml-2" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => (
            <button
              key={item.view}
              onClick={() => setActiveView(item.view)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                activeView === item.view
                  ? 'bg-surface-3 text-accent'
                  : 'text-text-secondary hover:bg-surface-2'
              }`}
            >
              <item.icon size={20} />
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Export Button */}
        <div className="p-4 border-t border-border">
          <button
            onClick={handleExport}
            className="w-full flex items-center gap-3 px-3 py-2 bg-surface-2 hover:bg-surface-3 rounded-lg text-text-secondary hover:text-text-primary transition-colors"
          >
            <Download size={20} />
            <span className="text-sm font-medium">Export Project</span>
          </button>
        </div>
      </div>

      {/* Project Switcher Modal */}
      {showProjectSwitcher && (
        <ProjectSwitcher onClose={() => setShowProjectSwitcher(false)} />
      )}
    </>
  )
}
