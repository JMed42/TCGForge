# TCGForge — Architecture

(Formerly TCG Studio.)

Snapshot of the codebase as of Card Designer Phase 3 (fit engine), after Phase 2, Phase 1b and review round 1 (2026-10),
built against the original 6-phase spec in docs/card-designer-spec.md. Describes what the code actually does.

## Stack

| Layer | Tech | Notes |
|---|---|---|
| Shell | Electron 33 | `electron/main.js`, CommonJS |
| UI | React 18, JSX; designer engine in TypeScript | `src/`, bundled by Vite 6. TypeScript is type-check only (`npm run typecheck`); Node runs `.ts` tests directly |
| State | Zustand 5 | one global store, `src/store.js` |
| Styling | Tailwind 3 | custom dark tokens in `tailwind.config.js` |
| Rich text | TipTap 2 | Game Docs editor |
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
│ electron/assetIndex.js   assets table, missing art  │
│ electron/import/         CSV/XLSX card import + IPC │
│ electron/cardModel.js    card types & fields + IPC  │
│ electron/fitCache.js     fit results (fit_cache)    │
│ electron/library.js      symbols, keywords, vars    │
│ electron/clipboard.js    clipboard text and images  │
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
- Startup order: `app.whenReady` → legacy-data copy → `await initDatabase(userData)` (runs migrations) → asset protocol, asset index and file watcher → `registerIpcHandlers` → `registerCardDesignerIpc` → `registerImportIpc` → `createWindow`. If DB init fails, the app quits.
- Closing the window goes through an unsaved-changes guard. Once the renderer has registered its listener (`closeGuardReady`), `close` is intercepted, the renderer is asked (`app-close-requested`), and it calls `confirmClose`. The guard is dropped on reload or if the renderer dies, so a broken page can't block closing.

## Data layer (`electron/database.js`)

- sql.js loads the whole file `{userData}/tcgforge.db` into memory at startup.
- `userData` is pinned to `{appData}/TCGForge` in `main.js`, so dev and packaged builds share it. An explicit `--user-data-dir` overrides this. On first launch, `electron/legacyData.js` copies (never moves) `tcg-studio.db` and `projects/` from the old `tcg-studio` / `TCG Studio` folders.
- Helpers: `queryAll`, `queryOne`, and `run`. **`run` exports and rewrites the entire DB file on every write** (`saveDatabase`). `deleteProject` and `importProject` still loop `run` for cards and documents, so they rewrite the file once per row. That's fine at current sizes, but it's a scaling hazard. Fit results are batched for this reason (at most one write every 2 s).
- The base schema (version 0) is created with `CREATE TABLE IF NOT EXISTS` in `initDatabase`. Later changes are **migrations** in `electron/migrations.js`, tracked with `PRAGMA user_version`.
  - Pending steps run in one transaction, and a failure rolls back and stops startup.
  - Before the first change, the file is copied to `tcgforge.db.bak-v{N}`.
  - Append new migrations; never edit a shipped one. Current: v1 `templates` table; v2 one-time import of Phase 0 template files; v3 template schema v1 (pixel templates converted, originals kept in `legacy_content`, `version` column); v4 `template_rules`, `assets`, `cards.template_override_id`; v5 `card_fields`, `card_types`, `cards.card_type_id` (every project gets a "Card" type with the standard fields plus the custom keys its cards hold); v6 `fit_cache`; v7 `symbols`, `keywords`, `variables`, `projects.settings`, `cards.reminders`.
- Multi-statement writes (rule lists, imports, asset index updates, model changes, bulk card edits, deletes) go through `inTransaction(fn)`: one transaction, one save. `exec(sql)` runs a statement without saving, for use inside it.
- Foreign keys are off (sql.js default). Cascades are done by hand: `deleteProject` removes cards, documents, templates, rules, asset rows, fit results and the library (symbols, keywords, variables); `deleteCard` / `bulkDeleteCards` remove the cards' fit results in the same transaction; `deleteTemplate` removes its rules and clears card overrides and type defaults that point at it; `deleteDocument` is recursive and clears keywords' `rule_ref` to the deleted documents.

### Schema

| Table | Columns (beyond id / created_at / updated_at) |
|---|---|
| `projects` | `name`, `description`, `card_schema` TEXT (JSON array) |
| `cards` | `project_id`, `name`, `type`, `set_name`, `rarity`, `cost`, `power`, `toughness`, `rules_text`, `flavor_text`, `tags` (comma string), `custom_fields` TEXT (JSON object), `notes`, `image_path` |
| `documents` | `project_id`, `parent_id` (self-tree), `title`, `type` (`folder`/`document`/`rule`), `content` (HTML), `sort_order` |
| `templates` | `project_id`, `name`, `content` TEXT (schema v1 JSON), `version` (bumps on save), `legacy_content` (pre-v3 JSON) |
| `template_rules` | `project_id`, `priority` (0 first), `condition_expr` (bare expression; empty = always), `template_id` |
| `assets` | `project_id`, `rel_path` (unique per project), `kind` (art/icon/font/frame/other), `sha256`, `width`, `height`, `size`, `mtime` |
| `card_fields` | `project_id`, `key` (unique per project), `label`, `kind` (text/longText/number/choice/yesNo/image/tags), `options` (JSON), `default_value`, `help` |
| `card_types` | `project_id`, `name` (unique per project), `color`, `sort_order`, `template_id` (the type's default template), `field_keys` (ordered JSON list) |
| `fit_cache` | `card_id` (primary key), `project_id`, `template_id`, `template_version`, `data_hash` (hash of every fit input), `results_json` (fit result per text layer), `computed_at`. Computed data: not exported, rebuilt when missing |
| `symbols` | `project_id`, `shortcode` (unique per project), `rel_path` (image under `assets/`, usually `assets/icons`), `scale` (× the text size), `baseline_offset` (em) |
| `keywords` | `project_id`, `name` (unique per project, any case), `params_json` (`[{ name, kind: number\|word }]`), `reminder_template` (template language), `rule_ref` (a Game Docs rule entry, nullable) |
| `variables` | `project_id`, `key` (UPPER_CASE, unique per project), `value`, `description` |

`cards` also has `template_override_id` (v4, nullable): a card's own template choice, which beats everything; `card_type_id` (v5): every card has one type; and `reminders` (v7): null = the project/set default, 1 = show, 0 = hide keyword reminder text. Card queries join the type in as `card_type` (name) and `card_type_template_id`. `projects.settings` (v7) is JSON: `{ reminders: { show, sets: { "<set name>": true|false } } }`.

All stat-like card fields (`cost`, `power`, `toughness`) are TEXT. JSON columns come back to the renderer as **strings**, and nothing parses them centrally.

## IPC convention

- One `ipcMain.handle('<camelName>', (_, ...args) => …)` per operation, mirrored 1:1 in `preload.js` as `name: (...a) => ipcRenderer.invoke('name', ...a)`.
- Handlers return plain rows or objects. Errors propagate as rejected promises.
- Arguments are positional (`updateCard(id, data)`), and update handlers whitelist columns.

## Renderer

- **Navigation:** there's no router. `App.jsx` shows `ProjectSelector` until `activeProjectId` is set, then `Sidebar` plus a view chosen by the `activeView` string (`cards` | `types` | `designer` | `library` | `rules` (Game Docs) | `settings`). `LibraryProvider` wraps the open project, so every `CardRender` in the window gets the project library.
- **Store (`src/store.js`):** a single `create((set, get) => …)`. The pattern for async actions is:
  - call `window.api?.x?.(…)` inside try/catch and `console.error` on failure
  - after any mutation, reload the whole list (`loadCards`, `loadDocuments`)
  - keep filters in the store; `setCardFilters` triggers a reload
- **Components:** feature folders `src/components/<Feature>/` with an `index.js` barrel. Top-level view components (`CardDatabase.jsx`, `RulesWorkspace.jsx`) sit directly in `src/components/`. Older components read the store with `useStore()` destructuring (they re-render on every store change); `App.jsx`, the Cards screen and the Designer panels use selectors (`useShallow` for several fields), because the fit check updates the store often.
- **Styling:** Tailwind utility classes only, using the tokens `surface-0..4`, `accent`, `text-primary/secondary/muted`, `border`, and `success/warning/danger`. Shared component classes are in `src/index.css`. Icons are lucide at size 16–20.
- **Code style:** most files use no semicolons and single quotes. `Cards/*`, `CardDatabase.jsx` and parts of `electron/` use semicolons.

## Card Designer module

Built against docs/card-designer-spec.md (the original 6-phase spec). Phase 1 (renderer and live preview, including "Phase 1b": Cards preview, template rules, CSV/XLSX import, assets index), Phase 2 (Template Designer), Phase 3 (fit engine) and Phase 4 (symbols, keywords, variables) are complete, plus review round 1: card types and fields (the project's own data model), a Cards tab with a form and a Database tab for batch edits, clipboard art, and clearer naming (Game Docs, Template assignment).

```
src/designer/                      engine (TypeScript)
  schema/types.ts, schema.ts       template schema v1 types + zod validator
  expr/expr.ts, scope.ts           sandboxed expression language; card -> scope
  layout/frame.ts, tree.ts         anchored frames (mm or %), layer tree helpers
  render/CardRender.tsx            THE renderer (editor + every export)
  render/RenderHost.tsx            #render route used by the hidden export window
  render/fitText.ts, markup.ts, assetUrl.ts, useProjectFonts.ts
  editor/ops.ts, geometry.ts       pure template edits and mm geometry
  rules/resolveTemplate.ts         override -> exceptions -> card type template -> default
  model/renameField.ts             rename a field key in every binding (token-aware)
  fit/inputs.ts, hash.ts           the fit-check key: hash of every fit input; 300-dpi scale
  fit/summary.ts, bindings.ts      statuses, hardness order, Fit filter, wording; fields per text layer
  library/library.ts               library rows -> what the renderer uses; signature; reminders on/off
  library/keywords.ts              keyword matchers, reminder text insertion
  library/variables.ts             {{KEY}} in card text; variable key shape
  library/iconRepeat.ts            icon positions (gap, squeeze, reverse), count clamp
  library/LibraryContext.ts        React context every CardRender reads (empty by default)
src/cardModel/model.js             helpers over the card model (fields of a type, labels, kinds)
src/librarySlice.js                library rows, Library tab and focus, save/delete/rename actions
src/components/Library/
  LibraryView.jsx, LibraryProvider.jsx  Library screen (tabs); compiles the store's rows for renders
  SymbolsTab.jsx, KeywordsTab.jsx, VariablesTab.jsx, FontsTab.jsx
  whereUsed.js, WhereUsedDialog.jsx  where a symbol/keyword/variable is used; rename rewrites
src/cardModelSlice.js              card types & fields state; key rename with template rewrites
src/fitSlice.js                    fit cache, file signatures, progress, live and Designer results
src/designerSlice.js               editor state (draft, history, selection, guard, assets)
src/cardsSlice.js                  Cards screen state (tab, active card, liveEdit, batch writes, undo, rules, missing art)
src/components/CardDatabase.jsx    Cards screen: Cards tab (list + form) or Database tab (grid), live preview right
src/components/CardTypes/          Card Types screen: types, field library, field editor, dialogs
src/components/Fit/
  FitRunner.jsx, fitQueue.js       background fit check (hidden, idle batches) + direct requests
  LiveFitProbe.jsx, DesignerFitProbe.jsx  the card being edited; the Designer's draft on its sample
  fitKey.js, templates.js          a card's template + input hash; parsed template rows
  FitStatus.jsx, useFit.js         Fit cell, list badge, budget line, progress; per-card hooks
src/components/Cards/
  CardList.jsx, CardForm.jsx       Cards tab: list by type; the card's type fields, auto-saved
  CardTable.jsx                    Database grid (ranges, copy/paste, fill-down, columns from the model)
  CardBulkActions.jsx, CardFilters.jsx  batch edits for checked rows; filters on any field
  grid/cardFields.js, liveTiming.js  cell get/set, cell history; edit-to-paint timing
  grid/gridOps.js, columns.js      TSV, ranges, paste/fill/clear plans, filters; model columns
  CardArtField.jsx                 image field: Choose / Paste / drop
  CardPreviewPane.jsx              live CardRender of the active card + fit/warnings + Paste art
  TemplateAssignmentDialog.jsx     type templates and exceptions with live counts
  ImportDialog.jsx                 file -> mapping -> plan + live render -> import
  MissingArtBanner.jsx             missing-art report and filter
src/components/CardDesigner/
  DesignerView.jsx                 layout, toolbar (undo/redo/discard/save, exports)
  DesignerCanvas.jsx               zoom/pan, guides, select/drag/resize/snap, align, group
  LayersPanel.jsx                  layer tree (drag & drop, hide, lock, rename, add)
  PropertiesPanel.jsx              frame anchors/units, style, bindings, template size, fit readout
  WorstCase.jsx                    worst-case button: rank sample cards by the selected text
  BindingInput.jsx                 binding picker with live preview
  TemplatePicker.jsx, TemplateJsonPanel.jsx, ExportControls.jsx,
  PrintSheetsDialog.jsx, UnsavedChangesDialog.jsx, editor/fields.jsx, editor/history.js
electron/
  renderWindow.js                  hidden offscreen window: capturePage (PNG/JPEG), printToPDF
  assets.js                        tcg-asset:// protocol, path guard, fs.watch
  migrations.js                    v1-v7
  library.js                       symbols, keywords, variables, reminder settings: validation, one-transaction rename
  cardModel.js                     card types & fields: validation, starters, rename, import changes
  fitCache.js                      fit_cache rows: list, batched save, clear (Re-check all)
  clipboard.js                     clipboard text and images (bitmap or copied file)
  assetIndex.js, imageSize.js      assets table (scan + watcher), image header sizes, missing art
  import/csv.js, xlsx.js           CSV (RFC 4180, encodings) and .xlsx (zip + XML) readers, no deps
  import/cardImport.js, ipc.js     mapping onto the model, create/update/skip plan, new types/fields, IPC
  cardDesigner/ipc.js              template CRUD, exports, sheets, art, .tcgtemplate
  cardDesigner/sheets.js           print-sheet layout (mm) and pages
  cardDesigner/tcgtemplate.js      .tcgtemplate build / parse / install
  cardDesigner/convertLegacyTemplate.js  pixel templates -> schema v1
  cardDesigner/art.js, projectFonts.js, pngDpi.js, templates.js
```

**Rendering**
- `CardRender` draws a template as absolutely positioned HTML in a fixed box measured in mm (`pxPerMm`). Frames resolve against the trim box or their group; stacks use flex layout.
  - Supported: `text`, `richText` (`**bold**`, `*italic*`), `image`, `shape` (SVG, centred stroke), `group`, `stack`, `iconRepeat`, `visibleIf`, `{{ }}` bindings, `{shortcode}` symbols and keyword reminder text (see **Library** below).
- Text fits by measuring the real layout (see **Fit engine** below).
- `onReady` fires once fonts are loaded, every `<img>` has settled and two frames have painted. Exports wait for it. `measureOnly` + `onFits` (fit checks) skip loading images whose size is set by their frame and report as soon as layout is done, and again only when a result, the template or the card changes.
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
- `dirty` compares the draft with the last saved template as key-order-independent JSON (`stableStringify`): the saved copy comes back from zod with its keys in schema order.
- Paint order is array order (first = bottom). Containers paint their children in order.
- Moving, resizing, grouping, ungrouping and moving between containers keep each layer's position and anchoring (`frameFromRect`). Changing the card size reflows through the frames.
- `guardUnsaved(proceed)` wraps template switch, create and import, project switch, and window close.

**Card types and fields**
- A project has a field library (`card_fields`) and card types (`card_types`) that list the fields they use, in order, plus a default template. "Name" is implicit and always first. Templates only draw the data; the binding picker lists the library by label.
- Storage doesn't move: standard fields (type line, set, rarity, cost, power, toughness, card text, flavor, tags, notes, art) are card columns; every other field lives in `custom_fields` JSON (Yes/No as booleans). Keys are identifiers so templates can bind `{{key}}`; `card_type` is in the expression scope.
- Removing a field from a type keeps the values (the form shows them under "Other stored values"). Deleting a library field is only allowed when no type uses it, and can purge the values. Deleting a type moves its cards. The last type can't be deleted.
- Renaming a custom key moves card values and rewrites bindings in every template and exception: the renderer computes the rewrites with the tokenizer (`renameIdentifier`, identifiers only), the main process applies values, types, templates and rules in one transaction.
- New projects start from "Blank" (Name, Cost, Card text, Art) or "Classic TCG" (the standard fields).

**Cards tab (one card at a time)**
- A list grouped by type, a form with the card's type fields (an input per kind), and the live preview. Typing renders live; each field saves itself 500 ms after typing stops, on blur, or when the card changes; Undo/Redo share the grid's history.

**Database tab (live loop and batch edits)**
- Columns come from the model: one type's fields when filtered to a type; otherwise a Card type column plus every field, with cells a card's type doesn't use greyed and skipped.
- Shift+arrows / Shift+click / drag select a range. Ctrl+C writes TSV; Ctrl+V parses Excel/Sheets TSV (quoted cells, CRLF), one value fills a larger selection; Ctrl+D fills down; Delete clears. The bulk bar sets a field or changes the type for checked rows. Every batch is one `bulkUpdateCards` transaction and one undo step.
- Filters (search across every field, card type, one field condition, fit, missing art) run in the renderer; exports get the exact list (`cardIds`). The Fit filter reads saved results, not what is being typed, so a row doesn't vanish mid-edit.
- The read-only Fit column (after Name) shows each card's hardest text layer by the field it shows; paste, fill-down and clear skip it, copy gives its text, and it sorts hardest first.

**Clipboard art**
- `pasteImageFromClipboard` saves a bitmap (browser, image editor, Snipping Tool) or a copied image file (Explorer `FileNameW`) into `assets/art` (card art), `assets/images` (template frames) or `assets/icons` (Library symbols), deduplicated by hash. Used by image fields, the preview's Paste art, Ctrl+V on art cells, Designer image layers and the symbol editor.

**Cards screen (live loop)**
- The grid keeps a cell cursor (arrows, Tab, Enter, Home/End). Enter, F2, double-click or typing opens an in-place editor; Enter/Tab/blur commit, Esc cancels, Delete clears, Ctrl+Z/Ctrl+Y undo and redo committed cell edits.
- While typing, the value lives in `store.liveEdit` and the preview renders `applyLive(card, liveEdit)` with no database round-trip. Commit writes one field through `updateCard` and swaps the row in place (no list reload).
- Edit-to-paint time is measured from the input event's timestamp to the first task after the frame that shows it (`grid/liveTiming.js`); measured p50 ≈ 10 ms, p95 ≈ 16 ms on the longest card. The preview also lists each text layer that shrank or overflows.
- Components subscribe with selectors, so a keystroke re-renders the preview, not the whole grid.

**Fit engine (Phase 3)**
- Every text layer has a policy: a starting size (`style.sizePt`, capped by `fit.maxPt`), a minimum (`fit.minPt`, default 6 pt) and strategies (`shrink`, `tightenLeading`, `hide`), applied in the spec's order: shrink in 0.25 pt steps to the minimum, tighten the line height in 0.05 steps to 1.0, hide, else flag overflow (`fitText`).
- Text with a size of its own (a frame, or a set height in a stack) fits itself. Text that sizes to its content inside a stack is fitted by the stack (`fitStack`, run by `StackView` against the DOM): layers give way by `priority`, the highest number first, and equal priorities shrink together; after each hide the rest start again from full size; what is still cut off at the stack's end is flagged with how much. A stack's `fitOrder: 'hideFirst'` hides before shrinking (the spec's open question; default shrink first).
- Each result: status (fits / shrunk / hidden / overflow), size and line height used, starting and minimum size, `fill` (space needed at the starting size ÷ space available), overflow in mm and lines (or `wide`), spare lines.
- **Measured one way:** every status the app reports (Fit column, filter, badges, budget lines, Designer readout and worst case) comes from a measure-only `CardRender` in a hidden area of the app window at 300 dpi, with the project's fonts loaded.
- **The cache key** (`fit/inputs.ts`, `components/Fit/fitKey.js`) hashes the card's scope (what the template sees, including `card_type`), the template it resolves to and that template's saved content, the project font files whose family the template uses (sha256 from the assets index), the project's image files only if the template lets an image size itself inside a stack, the library signature (symbols with their image sizes, keywords, variables, reminder settings), the card's own reminder choice, and the fit engine and browser versions. A change to any of them changes the hash, so nothing has to invalidate the cache.
- **Background check** (`FitRunner`, mounted while a project is open): cards whose hash has no cached result are measured a few at a time in idle callbacks (the active card first; the batch size adapts to stay near 12 ms). Results go to `store.fitCache` at once and to `fit_cache` at most every 2 s and at the end. `openProject` loads templates, exceptions, file signatures and the cache, so it runs on any screen. Requests from the Designer (`fitQueue.js`) go first.
- **Live budget** (`LiveFitProbe`, on the Cards screen): measures the active card with `liveEdit` applied on each keystroke into `store.liveFit`; the form's budget lines, the cell editor, the preview's fit lines and the active card's Fit cell read it. When nothing is being typed its result is also the card's cache entry.
- **Designer** (`DesignerFitProbe`): the draft on the sample card, 150 ms after the last edit, into `store.designerFit` (outlines for overflowing / hidden text, the Properties readout). Worst case measures the draft on the sample cards through the fit queue (or uses the cache when the template is saved and current) and ranks by `compareHardness`: overflowing most, then hidden, then shrunk furthest below its size, then fullest.
- Exports still measure at their own scale. Gate check (66 cards, 391 text layers): exports at 300 and 600 dpi agree with the cache on every layer; at 96 and 150 dpi, 2 layers came out one 0.25 pt step larger (7.5 vs 7.25 pt). Print sheets lay out at 96 dpi.

**Library (Phase 4): symbols, keywords, variables**
- One library per project (`electron/library.js`, IPC `getLibrary`, `saveSymbol`, `saveKeyword`, `saveVariable`, `deleteLibraryItem`, `saveLibrarySettings`, `renameLibraryItem`). The store loads it on project open and after any asset change; `LibraryProvider` compiles it (`compileLibrary`) into a `LibraryContext` value. Export jobs (`card`, `pages`) carry the library rows, and `RenderHost` provides the same context, so the editor, the preview, fit checks and every export draw it the same way.
- **Symbols:** a shortcode plus an image path (PNG/JPEG/GIF/SVG; SVGs are checked as documents, at most 2 MB). `parseRichText` / `parseSymbols` turn known `{code}` into a symbol run: an inline `<img>` with an explicit em width and height (`scale`, the image's aspect from the assets index or the file header) and `vertical-align` from `baseline_offset`, so layout never waits for the image. Measure-only renders use an empty box of the same size. An unknown `{code}` stays as typed with a warning; `\{` writes a brace; `{{` is never a symbol.
- **Keywords:** compiled to Unicode, case-insensitive, whole-word regexes (never inside `{…}`); parameters follow the name (`number`: digits or a single capital letter; `word`). `applyKeywords` runs on a text layer's interpolated text when the layer has `keywords: true` (new Rich Text layers; off on older layers until switched on) and reminders are on for the card. It inserts the reminder, interpolated with the parameters in scope, as `*(…)*` after the first occurrence's punctuation and closing `**`/`*`. A keyword already followed by `(` keeps the reminder written on the card. Longer names win (`Burn Bright` before `Burn`). Template errors become render warnings.
- **Reminders on or off:** the card's `reminders` (1/0), else the project setting for the card's Set (`set_name`), else the project default (`remindersOn`).
- **Variables:** UPPER_CASE keys, so they never clash with field keys. `cardScope(card, variables)` puts them in scope (templates, `visibleIf`, `count`) and replaces `{{KEY}}` inside card values once, without nesting; an unknown key stays as typed with a warning. Template-assignment exceptions don't see them yet.
- **Icon repeat:** `count` (bare expression, clamped to 0–50), `icon` (a shortcode, may use `{{ }}`), `direction` (ltr/rtl/ttb/btt), `gapMm` (default 0.5). Icons are as big as the frame's short side; when N don't fit, the gap shrinks (overlapping if needed).
- **Where used and rename** (`components/Library/whereUsed.js`): cards (every text value, custom fields included), templates (text and icon repeaters for symbols; token-aware `renameFieldInTemplate` for variables), exceptions (variables) and Game Docs documents (listed with Open, never rewritten). The renderer computes the rewrites; `renameLibraryItem` applies the item change, card patches, template contents and exception conditions in one transaction. Keyword renames keep each match's case.
- **Game Docs:** a keyword links to a rule entry (`rule_ref`); the rule entry shows its keywords as chips that open them in the Library.

**Template assignment** (template_rules are shown as "exceptions")
- `resolveTemplate` (TypeScript, in the renderer) picks the card's own choice → the first exception in priority order whose condition is true → the card type's template → the project default (lowest template id). Conditions use the same sandboxed evaluator as bindings; an error counts as false and is reported.
- The Designer's sample cards default to the cards the open template draws.
- The main process has no TS engine, so exports with `templateId: 'auto'` ask the hidden render window to resolve (`RenderService.resolveTemplates`, a `resolve` job in `RenderHost`).
- Print sheets by rules group cards by card size; each group gets its own layout and pages, and each page carries its own paper size (named CSS `@page` rules), so orientations can differ within one PDF.

**Import (CSV/XLSX)**
- Read in the main process. CSV: quoted fields, embedded newlines, `,`/`;`/tab detection, UTF-8/UTF-16 BOMs and a Windows-1252 fallback. XLSX: a small zip reader (stored/deflate, size and entry caps, no zip64 or encryption) and an XML scanner (shared/inline/rich strings, numbers, booleans, cached formula values, date number formats → ISO dates).
- Headers map onto the model: a "Card Type" column (or a "Type" column whose values are type names), library fields by label or key, standard aliases whose field is in the library, else a new field named after the header. New cards get the chosen type; type names that don't exist can create types; mapped fields are added to the types whose cards get values. The plan marks each row create / update (same name, case-insensitive) / skip (no name, duplicate in file, unknown type). Blank cells are left alone unless "Blank cells clear fields" is on.
- The file is held under a one-time token; preview never writes; commit is one transaction.

**Assets index**
- `assets` rows mirror image and font files under `assets/` and `templates/assets/`. A project is scanned the first time it is asked for, then the watcher re-indexes single paths. An unchanged size + mtime keeps the stored hash.
- `getMissingArt` lists cards whose non-empty `image_path` doesn't resolve and template image layers whose literal `src` doesn't. The Cards screen shows it as a banner with a filter.

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
2. `projects.card_schema` (the old JSON field list) is no longer used; the card model replaced it. The column is left in place.
3. `index.css` scrollbar rules reference `--color-surface-*` CSS variables that are never defined.
4. There's no linter. Tests use Node's built-in runner: `npm test`.
5. The native file dialogs (card art, exports, print sheets, .tcgtemplate) couldn't be driven by automation. The code behind them is tested through the dialog-free IPC variants. The import dialog uses a file input (path via `webUtils.getPathForFile`), which automation can drive.
6. Fonts are added by putting files in `{project}/assets/fonts` (they appear immediately). Template images can be pasted or chosen on an image layer. Export Project includes the card model but not templates or art yet.
7. Import limits: .xls (pre-2007) isn't read; formulas use the value Excel cached; workbooks in the 1904 date system get dates 4 years early; 20,000 rows, 500 columns and 50 MB per file.
8. Tiled backgrounds can differ very slightly between the editor (GPU) and exports (software raster) at non-integer scales; everything else matches pixel for pixel.
9. Pasting more rows than the grid has doesn't create cards; it reports the rows that didn't fit.
10. Fit results are measured at 300 dpi. On borderline cards, renders at screen scale and the 96-dpi print-sheet layout can come out one 0.25 pt step different (2 of 391 text layers in the Phase 3 gate).
11. The Database grid renders every row: opening it with 300 cards takes about 0.6 s (the Fit column adds 70–100 ms of that). Virtualising the rows would remove it.
12. Installing or removing a system font doesn't change any fit-check input; "Re-check all" measures every card again.
13. Any library change (a symbol, keyword, variable or reminder setting) re-checks every card in the project, because the library signature is one fit input (66 cards in about 1 s in the Phase 4 gate). Per-item tracking could narrow it if large sets need it.
14. Variables don't work in template-assignment exceptions yet; `.tcgtemplate` files don't carry the symbols a template uses.
15. An image pasted as a bitmap through the Windows clipboard can lose its transparency (many programs put no alpha channel on the clipboard). Symbols with transparency are best added as a file (Choose file, drop, or the icons folder).
