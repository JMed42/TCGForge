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
- Startup order: `app.whenReady` → `await initDatabase(userData)` → `registerIpcHandlers` → `registerCardDesignerIpc` → `createWindow`. If DB init fails, the app quits.

## Data layer (`electron/database.js`)

- sql.js loads the whole file `{userData}/tcgforge.db` into memory at startup.
- `userData` is pinned to `{appData}/TCGForge` in `main.js`, so dev and packaged builds share it. An explicit `--user-data-dir` overrides this. On first launch, `electron/legacyData.js` copies (never moves) `tcg-studio.db` and `projects/` from the old `tcg-studio` / `TCG Studio` folders.
- Helpers: `queryAll`, `queryOne`, and `run`. **`run` exports and rewrites the entire DB file on every write** (`saveDatabase`). Bulk operations such as `bulkDeleteCards`, `deleteProject` and `importProject` loop `run`, so they rewrite the file once per row. That's fine at current sizes, but it's a scaling hazard.
- Schema is created with `CREATE TABLE IF NOT EXISTS` in `initDatabase`. **There are no migrations or `user_version`.** Any column change needs a migration mechanism first (Phase 1).
- There are no foreign keys; cascades are done by hand (`deleteProject`, recursive `deleteDocument`).

### Schema

| Table | Columns (beyond id / created_at / updated_at) |
|---|---|
| `projects` | `name`, `description`, `card_schema` TEXT (JSON array) |
| `cards` | `project_id`, `name`, `type`, `set_name`, `rarity`, `cost`, `power`, `toughness`, `rules_text`, `flavor_text`, `tags` (comma string), `custom_fields` TEXT (JSON object), `notes`, `image_path` |
| `documents` | `project_id`, `parent_id` (self-tree), `title`, `type` (`folder`/`document`/`rule`), `content` (HTML), `sort_order` |

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

## Card Designer module (Phase 0)

```
electron/cardDesigner/
  bind.js         {{field}} substitution — regex + null-prototype lookup, no eval
  fit.js          pure fit math (cover/contain/stretch/tile, 9-point align)
  textLayout.js   wrap / shrink / clip measurement
  fonts.js        registerFont from template assets/fonts, fallback to sans-serif
  render.js       renderCard(card, template, {dpi, templateDir}) → node-canvas
  exporters.js    PNG / JPEG / PDF (pdfkit)
  templates.js    template JSON files on disk
  ipc.js          registerCardDesignerIpc(ipcMain, deps)
  fixtures/       sample templates for the spike
src/components/CardDesigner/   Designer view (template picker, preview, JSON panel)
scripts/card-designer-spike.mjs   headless render/fit/export check
```

- Rendering happens **only in the main process** with node-canvas. The on-screen preview is an `<img>` of the PNG data URL returned by `renderCard`, so preview and export go through the same code.
- Templates live on disk at `{userData}/projects/{projectId}/templates/{name}.json`, with `assets/` and `assets/fonts/` beside them. There is no DB table yet; that's Phase 1.
- Coordinates are pixels at `template.meta.dpi`. Output scale is `outputDpi / meta.dpi`.
- The preview renders at `96 × zoom × devicePixelRatio` dpi and is shown at natural device-pixel size. That makes it pixel-identical to an export at the same DPI; this was verified in the Phase 0 gate.
- **Memory:** node-canvas frees native surfaces in N-API finalizers, which only run when the event loop turns. Any loop that renders many cards must `await yieldToEventLoop()` between cards, or memory grows about 3 MB per 300-dpi card until the loop ends.
- `electron/database.js` exports `queryCards(projectId, filters)` and `getCard(id)`. The designer's batch export uses the same filtered list as the Card Database view.
- Dev tooling: `node --expose-gc scripts/card-designer-spike.mjs --out <dir>` runs the headless render checks. `node scripts/card-designer-seed.cjs <dir>` followed by `electron . --user-data-dir=<dir>` gives a throwaway profile with sample data.

## Known defects / gaps (pre-existing, not fixed in Phase 0)

1. `ProjectSettings.jsx` and `ProjectForm.jsx` read `project.cardSchema`, but the DB returns `card_schema` (a JSON string). The schema editor always shows the default value or `{}`.
2. `CardEditor.jsx` spreads `editingCard.custom_fields`, which is a JSON string, into form state, producing keys `0,1,2…`.
3. `CardEditor.jsx` reads and writes `set`, but the DB column is `set_name`, so set names never round-trip.
4. Sidebar "Export Project" calls `exportProject` and discards the JSON; there's no save dialog.
5. **`CardTable.jsx:304` crashes the whole app** (blank window) when any card has tags. It calls `card.tags.slice(0, 2).map`, but the DB stores `tags` as a comma string. `CardFilters.jsx` also treats `tags` as an array, while `getCards` does `tags LIKE %…%`.
6. `CardFilters.jsx` reads `card.set` for the set dropdown; the column is `set_name`.
7. `index.css` scrollbar rules reference `--color-surface-*` CSS variables that are never defined.
8. There's no test runner, linter or git repository.
