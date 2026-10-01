# TCGForge — Architecture

(Formerly TCG Studio.)

Snapshot of the codebase as of the Card Designer Phase 0 spike (2026-09). Describes what the code
actually does, which in a few places differs from the README.

## Stack

| Layer | Tech | Notes |
|---|---|---|
| Shell | Electron 33 | `electron/main.js`, CommonJS |
| UI | React 18, plain JSX (no TypeScript) | `src/`, bundled by Vite 6 |
| State | Zustand 5 | one global store, `src/store.js` |
| Styling | Tailwind 3 | custom dark tokens in `tailwind.config.js` |
| Rich text | TipTap 2 | Rules & GDD editor |
| Database | **sql.js** (SQLite compiled to WASM) | *not* better-sqlite3, despite the README |
| Icons | lucide-react | |
| Card rendering | canvas 3 (node-canvas, N-API), pdfkit | added by the Card Designer module |

## Process layout

```
┌──────────────── main process (Node) ────────────────┐
│ electron/main.js         window, app lifecycle      │
│ electron/database.js     sql.js DB + IPC handlers   │
│ electron/cardDesigner/   template files, renderer,  │
│                          exporters + IPC handlers   │
└───────────────▲─────────────────────────────────────┘
                │ ipcRenderer.invoke / ipcMain.handle
┌───────────────┴── preload (electron/preload.js) ────┐
│ contextBridge.exposeInMainWorld('api', {...})       │
└───────────────▲─────────────────────────────────────┘
                │ window.api.*
┌───────────────┴── renderer (Vite / React) ──────────┐
│ src/main.jsx → App.jsx → views → components         │
│ src/store.js (Zustand) owns all window.api calls    │
└─────────────────────────────────────────────────────┘
```

- `contextIsolation: true`, `nodeIntegration: false`. The renderer has no Node access; everything goes through `window.api`.
- Dev: `npm run dev` runs Vite on :5173 and Electron (`wait-on` then `electron .`). DevTools auto-open in dev.
- Prod: `vite build` → `dist/`, loaded with `loadFile`. `electron-builder` packages `dist/**` and `electron/**`.
- Startup order: `app.whenReady` → legacy-data copy → `await initDatabase(userData)` (runs migrations) → `registerIpcHandlers` → `registerCardDesignerIpc` → `createWindow`. If DB init fails, the app quits.
- Closing the window goes through an unsaved-changes guard. Once the renderer has registered its listener (`closeGuardReady`), `close` is intercepted, the renderer is asked (`app-close-requested`), and it calls `confirmClose`. The guard is dropped on reload or if the renderer dies, so a broken page can't block closing.

## Data layer (`electron/database.js`)

- sql.js loads the whole file `{userData}/tcgforge.db` into memory at startup.
- `userData` is pinned to `{appData}/TCGForge` in `main.js`, so dev and packaged builds share it. An explicit `--user-data-dir` overrides this. On first launch, `electron/legacyData.js` copies (never moves) `tcg-studio.db` and `projects/` from the old `tcg-studio` / `TCG Studio` folders.
- Helpers: `queryAll`, `queryOne`, and `run`. **`run` exports and rewrites the entire DB file on every write** (`saveDatabase`). Bulk operations such as `bulkDeleteCards`, `deleteProject` and `importProject` loop `run`, so they rewrite the file once per row. That's fine at current sizes, but it's a scaling hazard.
- The base schema (version 0) is created with `CREATE TABLE IF NOT EXISTS` in `initDatabase`. Later changes are **migrations** in `electron/migrations.js`, tracked with `PRAGMA user_version`.
  - Pending steps run in one transaction, and a failure rolls back and stops startup.
  - Before the first change, the file is copied to `tcgforge.db.bak-v{N}`.
  - Append new migrations; never edit a shipped one. Current: v1 `templates` table; v2 one-time import of Phase 0 template files.
- Foreign keys are off (sql.js default). Cascades are done by hand: `deleteProject` removes cards, documents and templates, and `deleteDocument` is recursive.

### Schema

| Table | Columns (beyond id / created_at / updated_at) |
|---|---|
| `projects` | `name`, `description`, `card_schema` TEXT (JSON array) |
| `cards` | `project_id`, `name`, `type`, `set_name`, `rarity`, `cost`, `power`, `toughness`, `rules_text`, `flavor_text`, `tags` (comma string), `custom_fields` TEXT (JSON object), `notes`, `image_path` |
| `documents` | `project_id`, `parent_id` (self-tree), `title`, `type` (`folder`/`document`/`rule`), `content` (HTML), `sort_order` |
| `templates` | `project_id`, `name`, `content` TEXT (template JSON) |

All stat-like card fields (`cost`, `power`, `toughness`) are TEXT. JSON columns come back to the renderer as **strings**, and nothing parses them centrally.

## IPC convention

- One `ipcMain.handle('<camelName>', (_, ...args) => …)` per operation, mirrored 1:1 in `preload.js` as `name: (...a) => ipcRenderer.invoke('name', ...a)`.
- Handlers return plain rows or objects. Errors propagate as rejected promises.
- Arguments are positional (`updateCard(id, data)`), and update handlers whitelist columns.

## Renderer

- **Navigation:** there's no router. `App.jsx` shows `ProjectSelector` until `activeProjectId` is set, then `Sidebar` plus a view chosen by the `activeView` string (`cards` | `designer` | `rules` | `settings`).
- **Store (`src/store.js`):** a single `create((set, get) => …)`. The pattern for async actions is:
  - call `window.api?.x?.(…)` inside try/catch and `console.error` on failure
  - after any mutation, reload the whole list (`loadCards`, `loadDocuments`)
  - keep filters in the store; `setCardFilters` triggers a reload
- **Components:** feature folders `src/components/<Feature>/` with an `index.js` barrel. Top-level view components (`CardDatabase.jsx`, `RulesWorkspace.jsx`) sit directly in `src/components/`. Components read the store with `useStore()` destructuring.
- **Styling:** Tailwind utility classes only, using the tokens `surface-0..4`, `accent`, `text-primary/secondary/muted`, `border`, and `success/warning/danger`. Shared component classes are in `src/index.css`. Icons are lucide at size 16–20.
- **Code style:** most files use no semicolons and single quotes. `Cards/*`, `CardDatabase.jsx` and parts of `electron/` use semicolons.

## Card Designer module

```
electron/cardDesigner/
  bind.js         {{field}} substitution — regex + null-prototype lookup, no eval
  fit.js          pure fit math (cover/contain/stretch/tile, 9-point align)
  textLayout.js   wrap / shrink (binary search) / clip measurement
  fonts.js        registerFont from template assets/fonts, fallback to sans-serif
  render.js       renderCard(card, template, {dpi, templateDir, projectDir, bleedMm}) → node-canvas
  exporters.js    PNG / JPEG / PDF (pdfkit)
  sheets.js       print-and-play sheet layout + multi-page PDF
  art.js          card art import (copy into project) and thumbnails
  templates.js    on-disk folders, template validation, Phase 0 file reader
  ipc.js          registerCardDesignerIpc(ipcMain, deps)
  fixtures/       sample templates, cards and generated art
src/designerSlice.js                  editor state (draft, history, preview, guard), composed into the store
src/components/CardDesigner/
  DesignerView.jsx    layout, toolbar (undo/redo/discard/save, exports), keyboard shortcuts
  CardStage.jsx       rendered card + select/move/resize/snap overlay
  LayerPanel.jsx      layer list: select, rename, hide, lock, reorder, add, duplicate, delete
  LayerInspector.jsx  properties of the selected layer, or template settings
  TemplateJsonPanel.jsx  advanced JSON tab (Apply = one undo step)
  ExportControls.jsx, PrintSheetsDialog.jsx, UnsavedChangesDialog.jsx, TemplatePicker.jsx
  editor/             pure helpers: templateOps, history, geometry; form fields
src/components/Cards/CardArtField.jsx  art picker in the card editor
scripts/   card-designer-spike.mjs (headless checks), card-designer-seed.cjs (throwaway profile)
test/      node --test suites (npm test)
```

**Rendering**
- Rendering happens only in the main process, with node-canvas. The on-screen card is an `<img>` of the PNG returned by `renderCard`, so preview and export go through the same code.
- Coordinates are pixels at `template.meta.dpi`, and output scale is `outputDpi / meta.dpi`. The preview renders at `96 × zoom × devicePixelRatio` dpi and is shown at its natural device-pixel size. It is pixel-identical to an export at the same dpi, including for unsaved drafts (verified at both gates).
- Shrink-to-fit stops at 6 pt physical (`6 × dpi / 72` template px) unless a layer sets `minFontSize`.
- Decoded images are cached across renders, keyed by path + mtime + size, with an LRU bounded by entry count and total pixels.
- **Memory:** node-canvas frees native surfaces in N-API finalizers, which only run when the event loop turns. Any loop rendering many cards must `await yieldToEventLoop()` between cards.

**Templates and assets**
- Template JSON lives in the `templates` table and is addressed by numeric id.
- Files stay on disk under `{userData}/projects/{id}/`:
  - `templates/` is the asset root (`assets/…`, `assets/fonts/…`)
  - `art/` holds card art copied in by the card editor
- Relative paths resolve against `templates/`, then the project folder. Cards store art as `art/<name>-<hash>.<ext>`.
- Template JSON is validated (meta size and dpi, 8000 px cap) before it's rendered or saved. Output dpi is clamped to 24–1200.

**Editor model**
- The editor works on a `draft` object; nothing reaches the DB until Save.
- Every edit is a pure function over the draft (`editor/templateOps.js`):
  - `edit(mutator, {key})` adds one undo step; same-key edits within 500 ms merge.
  - A drag is `beginGesture()` at the first movement, then `editLive()` for each move, so the whole drag is one undo step.
- `dirty` compares the draft with the last saved JSON, so undoing back to it is clean.
- Previews render the draft through IPC (`renderCard(..., {draft})`), throttled: one render in flight, the latest request queued, at least 100 ms apart.
- Exports and print sheets also use the draft.
- Paint order is `zIndex` (ties: array order). Reordering renumbers it 10, 20, 30… and keeps the array in paint order.
- `guardUnsaved(proceed)` wraps every action that would drop a dirty draft (template switch or create, project switch, window close).

**Print sheets**
- The layout uses the card's physical size, a 6.35 mm margin and the bleed, in whichever orientation fits more cards.
- For 63×88 mm cards: Letter fits 9 without bleed and 6 with 3 mm; A4 fits 9 and 8.
- Output is one multi-page PDF of 300 dpi JPEGs at exact size, with crop marks in the margin and each card embedded once.

## Card data shape (DB vs UI)

The DB stores `tags` as one comma-separated TEXT value and `custom_fields` / `card_schema` as JSON text. The UI works with an array and objects:

- **Reads:** `src/utils/cardData.js` converts rows as they enter the store (`toUiCard`, `toUiProject`, which adds `cardSchema`).
- **Writes:** `normalizeCardData` in `electron/database.js` converts back on create, update and import. Without it, sql.js would store an array as a zero-filled BLOB.
- **Tag filter:** `queryCards` matches whole tags, case-insensitively, and requires all of them.
- The set column is `set_name` everywhere in the UI. The `cardFilters.set` key maps to it in `queryCards`.

## Running the app

- `StartTCGForge.cmd`: double-click launcher. It installs dependencies on first run, then `npm start` (Vite and Electron together, no DevTools). Closing the app window stops Vite and closes the console.
- `npm run dev`: development mode with DevTools.

## Known defects / gaps

1. Sidebar "Export Project" calls `exportProject` and discards the JSON; there's no save dialog.
2. The card editor's custom-fields section never renders: its schema lookup is stubbed to `[]`. Existing `custom_fields` values are preserved on save.
3. `index.css` scrollbar rules reference `--color-surface-*` CSS variables that are never defined.
4. There's no linter. Tests use Node's built-in runner: `npm test`.
5. The native file dialogs (card art, single and batch export, print sheets) couldn't be driven by automation. The code paths behind them are tested through the dialog-free IPC variants.
6. Template image and font upload isn't built yet: asset paths are typed. Export Project doesn't include templates or art yet.
