import { useMemo } from 'react'
import { useStore } from '../../store'
import { LibraryContext } from '../../designer/library/LibraryContext.ts'
import { compileLibrary } from '../../designer/library/library.ts'

// The open project's library for every CardRender in the app window: the Designer canvas, the
// preview, the fit checks and their probes.
export default function LibraryProvider({ children }) {
  const rows = useStore((s) => s.library)
  const lib = useMemo(() => compileLibrary(rows), [rows])
  return <LibraryContext.Provider value={lib}>{children}</LibraryContext.Provider>
}
