import { useEffect } from 'react'
import { useStore } from './store'
import Sidebar from './components/Layout/Sidebar'
import ProjectSelector from './components/Projects/ProjectSelector'
import CardDatabase from './components/CardDatabase'
import RulesWorkspace from './components/RulesWorkspace'
import ProjectSettings from './components/ProjectSettings'
import { DesignerView } from './components/CardDesigner'
import UnsavedChangesDialog from './components/CardDesigner/UnsavedChangesDialog'

export default function App() {
  const { activeProjectId, activeView, loadProjects } = useStore()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // A file under the project changed on disk: bump its ?v= so every render reloads it.
  useEffect(() => window.api?.onAssetChanged?.((c) => {
    const s = useStore.getState()
    s.bumpAsset(c.projectId, c.relPath)
    if (c.projectId === s.activeProjectId) s.assetsChanged?.()
  }), [])

  if (!activeProjectId) {
    return (
      <>
        <ProjectSelector />
        <UnsavedChangesDialog />
      </>
    )
  }

  return (
    <div className="flex h-screen bg-surface-0">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeView === 'cards' && <CardDatabase />}
        {activeView === 'designer' && <DesignerView />}
        {activeView === 'rules' && <RulesWorkspace />}
        {activeView === 'settings' && <ProjectSettings />}
      </div>
      <UnsavedChangesDialog />
    </div>
  )
}
