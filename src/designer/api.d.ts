// The parts of the preload bridge (electron/preload.js) the TypeScript designer code calls.

export interface ProjectFont {
  family: string
  weight: number
  style: 'normal' | 'italic'
  relPath: string
}

declare global {
  interface Window {
    api: {
      listProjectFonts(projectId: number): Promise<ProjectFont[]>
      onAssetChanged(cb: (change: { projectId: number; relPath: string }) => void): () => void
      onRenderJob(cb: (job: any) => void): () => void
      renderHostReady(): Promise<void>
      renderDone(payload: unknown): Promise<void>
      [key: string]: any
    }
  }
}
