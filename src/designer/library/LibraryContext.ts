// The library every CardRender reads (src/designer/library/library.ts). The app window provides
// the open project's library from the store; the export window provides the one sent with each
// job. Without a provider, renders have no symbols, keywords or variables.

import { createContext, useContext } from 'react'
import { EMPTY_LIBRARY } from './library.ts'
import type { RenderLibrary } from './library.ts'

export const LibraryContext = createContext<RenderLibrary>(EMPTY_LIBRARY)
export const useLibrary = () => useContext(LibraryContext)
