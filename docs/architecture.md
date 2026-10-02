# TCGForge — Architecture

(Formerly TCG Studio.)

Snapshot of the codebase as of Card Designer Phase 2 (2026-10), built against the original
6-phase spec in docs/card-designer-spec.md. Describes what the code actually does.

## Stack

| Layer | Tech | Notes |
|---|---|---|
| Shell | Electron 33 | `electron/main.js`, CommonJS |
| UI | React 18, JSX; designer engine in TypeScript | `src/`, bundled by Vite 6. TypeScript is type-check only (`npm run typecheck`); Node runs `.ts` tests directly |
| State | Zustand 5 | one global store, `src/store.js` |
| Styling | Tailwind 3 | custom dark tokens in `tailwind.config.js` |
| Rich text | TipTap 2 | Rules & GDD editor |
| Database | **sql.js** (SQLite compiled to WASM) | the spec names better-sqlite3; sql.js was already in use |
| Icons | lucide-react | |
| Card rendering | React DOM (`CardRender`), Electron `capturePage` / `printToPDF` | one renderer for the editor and every export |
| Validation | zod 4 | template schema v1 |

## Process layout

```
┌──────────────── main process (Node) ────────────────┐
│ electron/main.js         window, app lifecycle      │
│ electron/database.js     sql.js DB + IPC handlers   │
│ electron/cardDesigner/   templates, exports, art,   │
│                          .tcgtemplate + IPC         │
│ electron/renderWindow.js hidden export window       │
│ electron/assets.js       tcg-asset:// + file watch  │
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
  - Append new migrations; never edit a shipped one. Current: v1 `templates` table; v2 one-time import of Phase 0 template files; v3 template schema v1 (pixel templates converted, originals kept in `legacy_content`, `version` column).
- Foreign keys are off (sql.js default). Cascades are done by hand: `deleteProject` removes cards, documents and templates, and `deleteDocument` is recursive.

### Schema

| Table | Columns (beyond id / created_at / updated_at) |
|---|---|
| `projects` | `name`, `description`, `card_schema` TEXT (JSON array) |
| `cards` | `project_id`, `name`, `type`, `set_name`, `rarity`, `cost`, `power`, `toughness`, `rules_text`, `flavor_text`, `tags` (comma string), `custom_fields` TEXT (JSON object), `notes`, `image_path` |
| `documents` | `project_id`, `parent_id` (self-tree), `title`, `type` (`folder`/`document`/`rule`), `content` (HTML), `sort_order` |
| `templates` | `project_id`, `name`, `content` TEXT (schema v1 JSON), `version` (bumps on save), `legacy_content` (pre-v3 JSON) |

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

Built against docs/card-designer-spec.md (the original 6-phase spec). Phase 2 (Template Designer) is complete, along with the Phase 1 foundations it needs: schema v1, the DOM renderer, `{{ }}` bindings, `visibleIf`, and `tcg-asset://` with file watching.

```
src/designer/                      engine (TypeScript)
  schema/types.ts, schema.ts       template schema v1 types + zod validator
  expr/expr.ts, scope.ts           sandboxed expression language; card -> scope
  layout/frame.ts, tree.ts         anchored frames (mm or %), layer tree helpers
  render/CardRender.tsx            THE renderer (editor + every export)
  render/RenderHost.tsx            #render route used by the hidden export window
  render/fitText.ts, markup.ts, assetUrl.ts, useProjectFonts.ts
  editor/ops.ts, geometry.ts       pure template edits and mm geometry
src/designerSlice.js               editor state (draft, history, selection, guard, assets)
src/components/CardDesigner/
  DesignerView.jsx                 layout, toolbar (undo/redo/discard/save, exports)
  DesignerCanvas.jsx               zoom/pan, guides, select/drag/resize/snap, align, group
  LayersPanel.jsx                  layer tree (drag & drop, hide, lock, rename, add)
  PropertiesPanel.jsx              frame anchors/units, style, bindings, template size
  BindingInput.jsx                 binding picker with live preview
  TemplatePicker.jsx, TemplateJsonPanel.jsx, ExportControls.jsx,
  PrintSheetsDialog.jsx, UnsavedChangesDialog.jsx, editor/fields.jsx, editor/history.js
electron/
  renderWindow.js                  hidden offscreen window: capturePage (PNG/JPEG), printToPDF
  assets.js                        tcg-asset:// protocol, path guard, fs.watch
  migrations.js                    v1-v3
  cardDesigner/ipc.js              template CRUD, exports, sheets, art, .tcgtemplate
  cardDesigner/sheets.js           print-sheet layout (mm) and pages
  cardDesigner/tcgtemplate.js      .tcgtemplate build / parse / install
  cardDesigner/convertLegacyTemplate.js  pixel templates -> schema v1
  cardDesigner/art.js, projectFonts.js, pngDpi.js, templates.js
```

**Rendering**
- `CardRender` draws a template as absolutely positioned HTML in a fixed box measured in mm (`pxPerMm`). Frames resolve against the trim box or their group; stacks use flex layout.
  - Supported: `text`, `richText` (`**bold**`, `*italic*`), `image`, `shape` (SVG, centred stroke), `group`, `stack`, `visibleIf`, `{{ }}` bindings.
  - `iconRepeat` is outlined until Phase 4, and `{shortcode}` symbols render as typed until Phase 4.
- Text fits by measuring the real layout: shrink in 0.25 pt steps down to `fit.minPt` (default 6 pt), then tighten leading, then hide or flag overflow. The full fit engine and `fit_cache` are Phase 3.
- `onReady` fires once fonts are loaded, every `<img>` has settled and two frames have painted. Exports wait for it.
- **Exports** render in a hidden offscreen window (`electron/renderWindow.js`) at the requested dpi.
  - PNG via `capturePage`, with a pHYs DPI chunk. Corners are transparent unless bleed is included.
  - JPEG is composited on white.
  - Single-card PDF and print sheets go through an HTML imposition page and `printToPDF`, so text stays vector.
- **Parity:** the editor keeps the card on whole pixels. At the same px/mm it matches an export pixel for pixel, except tiled backgrounds, where GPU and software resampling differ very slightly.
- 63 × 88 mm with 3 mm bleed at 300 dpi = 815 × 1110 px, as the spec states.

**Templates, expressions, assets**
- Schema v1 (spec, "Template schema"), validated with zod before saving or importing. The main process also does a structural check.
  - Frames: two of left/right/width and two of top/bottom/height, in mm or `"N%"`.
  - Extensions are marked "ext" in `schema/types.ts`.
- Expressions: a hand-written tokenizer, Pratt parser and evaluator with a function whitelist. There's no eval, Function, property access or assignment, and there are limits on length, depth and steps. `{{expr}}` interpolates; `visibleIf` / `count` are bare.
- Assets live on disk under `{userData}/projects/{id}/`:
  - `assets/{art,frames,icons,fonts}`
  - Phase 0 template assets under `templates/assets`
- Assets are served as `tcg-asset://p/{id}/{path}`, and the path guard refuses anything outside the project.
- `fs.watch` reports changes, and the editor bumps `?v=` so a replaced file shows immediately. Fonts in `assets/fonts` register as FontFaces by filename (`Cinzel-Bold.ttf` = family Cinzel, weight 700).
- `.tcgtemplate`: the template plus the files it references (literal paths, matches of templated paths, fonts by family). Import is checked (paths, types, hashes), never overwrites (it renames on clash and rewrites references), and is zod-validated before anything is written.

**Editor model**
- The editor edits a `draft`; nothing reaches the DB until Save, which bumps `templates.version`.
  - `edit(mutator, {key})` is one undo step, with same-key edits within 500 ms merged.
  - A drag is `beginGesture()` then `editLive()`, so one undo step.
- `dirty` compares the draft with the last saved JSON.
- Paint order is array order (first = bottom). Containers paint their children in order.
- Moving, resizing, grouping, ungrouping and moving between containers keep each layer's position and anchoring (`frameFromRect`). Changing the card size reflows through the frames.
- `guardUnsaved(proceed)` wraps template switch, create and import, project switch, and window close.

**Print sheets**
- The layout uses the card's physical size, a 6.35 mm margin and the bleed, in whichever orientation fits more cards.
- For 63×88 mm cards: Letter fits 9 without bleed and 6 with 3 mm; A4 fits 9 and 8. Crop marks extend the trim lines into the margin.

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
5. The native file dialogs (card art, exports, print sheets, .tcgtemplate) couldn't be driven by automation. The code behind them is tested through the dialog-free IPC variants.
6. Template images and fonts are added by putting files in `{project}/assets/…` (they appear immediately); there is no upload button yet. Export Project doesn't include templates or art yet.
7. Not built yet from the spec's Phase 1 ("Phase 1b"): `template_rules`, the Cards-screen preview pane, CSV/XLSX import, the `assets` table, `cards.template_override_id`.
8. Tiled backgrounds can differ very slightly between the editor (GPU) and exports (software raster) at non-integer scales; everything else matches pixel for pixel.
