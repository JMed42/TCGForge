# TCG Studio Card Designer — Design Spec

Sep 26, 2026 · @Jacob Medvick

## Vision

**Pitch:** one window where card data, card layout and print output stay in sync. Change a stat or a line of rules text and the finished card re-renders instantly, with a warning if it no longer fits.

**The problem today**

- Data lives in Sheets or Excel; layouts live in Component Studio 2, Tabletop Creator or Magic Set Editor. Every change is a round trip: edit sheet, re-upload or refresh, regenerate, then scan cards by eye.
- Fitting is guess-and-check. You learn rules text is too long only after rendering, one card at a time.
- Each tool is strong in one lane and weak in the others, so a real project ends up spread across several of them.

**Scope.** This is the Visual Card Designer module that TCG Studio V1 left for later. TCG Studio already has the card database (custom fields, tags, bulk ops) and the rules/GDD editor, so the designer renders data that already lives in the app instead of importing it.

**Design principles**

1. Data and design share a window. Every edit re-renders live.
2. The app tells you what doesn't fit. You never hunt for it.
3. One renderer. What the editor shows is exactly what exports.
4. Layouts survive card-size changes without re-placing every element.
5. Local-first: offline, plain files on disk, no subscription. Windows is the primary target.

## What we borrow from each tool

Each tool nails one part of the job. The designer takes the strongest idea from each and drops the friction.

| Tool | Borrow | Leave behind |
| --- | --- | --- |
| [Component Studio 2](https://component.studio/) | Row = card, column = attribute. Design once, regenerate every card. Export to PDF, The Game Crafter, or hi-res images. Large icon and font library. | Round-tripping through Google Sheets. Web-only. Data and layout live in different places. |
| [Tabletop Creator](https://tabletop-creator.com/) | Panel-based blueprints (image, text, icon, QR, rounded panels). Global tags that update the whole project at once. Double-sided components with instant flip. One-click print and [Tabletop Simulator export](https://steamcommunity.com/app/861590). | Changing card size means resizing every panel by hand, a [user complaint on its Steam hub](https://steamcommunity.com/app/861590). |
| [Magic Set Editor](https://magicseteditor.com/) | Click and type directly on the card, with auto text scaling. Text shortcuts for symbols. [Keywords with parameters and conditional reminder text](https://magicseteditor.sourceforge.net/node/877). Set stats, rarity tracking, auto numbering, [booster pack generator](https://mtg.fandom.com/wiki/Magic_Set_Editor). | Templates written as script files outside the app. Dated UI. Assumptions shaped around Magic: The Gathering. |

What none of them do well: tell you, across the whole set, which cards overflow or shrank below readable size, and let you fix it in place.

## Signature features

Seven features make this better than the tools it replaces. The first two are the core; build them before anything else.

### 1. The live loop

- Split view: card table on the left, live render of the selected card on the right. A cell edit re-renders in under 100 ms.
- Edit on the card: click a text element on the render and type. The change writes back to the bound field, MSE-style.
- Spreadsheet-grade table: arrow-key navigation, fill-down, multi-cell paste straight from Excel or Sheets, undo.
- Live fit budget while typing in a cell, e.g. "Rules text: fits at 8.5 pt" or "Overflow by 1 line".

### 2. The fit engine

- Every bound text element has a fit policy: max size, min size, then an overflow strategy.
- Strategy order: shrink font to min, tighten line height, hide lower-priority siblings (flavor text drops before rules text), then flag as overflow.
- Each card gets a result per element: **Fits**, **Shrunk to X pt**, or **Overflow**. It shows as a table column, a badge on thumbnails, and a filter ("cards that shrank below 7 pt").
- Worst-case preview: one click in the template editor jumps to the card with the longest content for the selected element. You design against the hardest card, not a sample.

### 3. Anchored, resizable layouts

- Elements position against anchors (edges, center, safe zone) in mm or percent, never raw pixels.
- Stack containers work like auto-layout: rules text grows and pushes flavor text down.
- Change the card size (poker to tarot) and the layout reflows. This fixes Tabletop Creator's resize-every-panel problem.
- Bleed, trim and safe-zone guides are first-class settings on each template.

### 4. Variants and conditional layers

- Template picked by rule, e.g. `type = "Unit"` uses the Unit frame.
- Any layer can carry a visibility condition, e.g. show the foil star when `rarity = "Mythic"`.
- Any property can bind to data through a small, sandboxed expression language: `{{cost}}`, `{{upper(name)}}`, `{{if(faction == "Ember", "#c0392b", "#555")}}`.

### 5. Symbols, keywords and global variables

- Symbol shortcodes: type `{fire}` or `{T}` in any text field and the icon renders inline, scaled to the line height.
- Keyword glossary: define `Burn X` once, with reminder text that uses the parameter and conditionals. Reminder text toggles per card or per set.
- Keywords link to their rule in TCG Studio's rules editor. Renaming a keyword lists every card and rule that uses it.
- Global variables: change `{{HAND_SIZE}}` once and every card updates.
- Icon repeater element: draws N copies of an icon from a number field, for cost or health pips.

### 6. Change-aware printing

- Every export is stamped as a print version. The app tracks which cards changed since the last print.
- "Print changed cards only" builds a sheet of just the reprints for your playtest deck.
- Per-card revision history with a side-by-side render diff.

### 7. Set tools

- Live stats: rarity distribution, cost curve, counts by type or faction.
- Auto collector numbering with sort rules.
- Pack simulator: define rarity slots, open a random pack in the gallery.
- Proxy mode: a plain draft template so you can print playtest cards before any art exists.

## Screens and workflow

Five screens cover the work. Cards and Template Designer are where most time goes.

| Screen | Purpose | Key interactions |
| --- | --- | --- |
| Cards (extends the existing DB view) | Edit card data with a live render beside it | Table left, preview right; fit-status column; click-to-edit on the render; paste from Excel |
| Template Designer | Build and tune card layouts | Canvas with bleed/trim/safe guides; layers panel; properties panel with a binding picker; sample-card switcher; worst-case button |
| Gallery | Review the set as a whole | Virtualized thumbnail grid; filter and sort; fit badges; flip to back; stats sidebar; pack simulator |
| Library | Shared building blocks | Symbols, keywords, global variables, fonts; watched art folder with a missing-art report |
| Export | Get cards out of the app | Saved profiles (print-and-play PDF, PNG set, Tabletop Simulator sheet, print-shop preset); "changed since" toggle; imposition preview |

**A typical balance pass**

1. Adjust costs and stats in the Cards table. The preview and fit column update as you type.
2. Filter to Overflow. Trim text directly on the render, or loosen the template's fit policy.
3. Skim the Gallery and glance at the cost curve.
4. Export "changed since last print" as a print-and-play PDF, print, and swap the new cards into the playtest deck.

**Getting existing data in.** A one-time CSV/XLSX import maps spreadsheet columns onto TCG Studio custom fields, with a preview before commit. Live Google Sheets sync is a later, optional phase.

## Architecture and key decisions

The designer stays on TCG Studio's existing stack: Electron, React 18, Vite, SQLite via better-sqlite3, Zustand and Tailwind. No new framework. The decision that matters most is the renderer.

| Decision | Choice | Why |
| --- | --- | --- |
| Card renderer | React DOM: absolutely positioned elements in a fixed-size container measured in mm | Rich text, inline icons, font loading and text measurement are native in the browser. Canvas would need its own text engine. |
| Editor handles | A drag/resize overlay (e.g. react-moveable) on top of the same DOM render | Editor and export share one renderer, so what you see is what prints. |
| Text fitting | Measure in a hidden DOM container; binary-search font size between min and max | Exact results with real fonts. Cache by hash of template version + card data + fonts. |
| Expressions | A sandboxed evaluator (e.g. expr-eval, or a tiny custom parser) | Safe bindings. Never `eval` or `new Function`. |
| Card text storage | Plain text with shortcodes and light markup (`*italic*`, `**bold**`, `{fire}`) | Pastes cleanly from spreadsheets, diffs cleanly, round-trips through CSV. TipTap stays in the rules editor. |
| PNG export | Hidden BrowserWindow + `webContents.capturePage` at a scale factor that hits 300 or 600 DPI | Same renderer as the editor. A 63 × 88 mm card with 3 mm bleed is about 815 × 1110 px at 300 DPI. |
| PDF export | An HTML imposition page (cards + crop marks on Letter or A4) sent to `webContents.printToPDF` | Text stays vector and crisp. Duplex backs mirror across the long edge. |
| Tabletop Simulator export | Grid sheet PNGs, up to 10 × 7 cards per sheet, plus a back image | Matches TTS custom-deck import. |
| Assets | Files in the project folder (`assets/art`, `assets/icons`, `assets/fonts`), watched with chokidar, served through a custom `tcg-asset://` protocol | Replacing an art file updates every render. No base64 blobs in the database. |
| Templates | JSON in SQLite, exportable as `.tcgtemplate` files | Reusable across your games; easy to version and share. |
| Undo/redo | Command stack built on Immer patches in the Zustand designer store | Cheap, reliable undo across canvas and data edits. |
| Performance | Virtualized gallery (TanStack Virtual); on-disk thumbnail cache keyed by render hash; batch export as a queued job with progress | A 300-card set stays smooth. |

## Data model additions

Ten new tables sit beside TCG Studio's existing projects, cards and custom fields. Claude Code should read the current schema first and match its naming and migration style.

| Table | Key columns | Notes |
| --- | --- | --- |
| `templates` | id, project\_id, name, width\_mm, height\_mm, bleed\_mm, safe\_mm, layout\_json, back\_template\_id, version | Layout JSON follows the schema below; version bumps on every save |
| `template_rules` | id, project\_id, priority, condition\_expr, template\_id | First matching rule picks a card's template |
| `symbols` | id, project\_id, shortcode, asset\_id, baseline\_offset | `{fire}` → icon |
| `keywords` | id, project\_id, name, params\_json, reminder\_template, rule\_ref | `rule_ref` points at a node in the rules editor |
| `variables` | id, project\_id, key, value | Global values like `HAND_SIZE` |
| `assets` | id, project\_id, rel\_path, kind, sha256, width, height | kind = art, icon, font or frame; files stay on disk |
| `card_revisions` | id, card\_id, data\_json, created\_at | Written on every card save; feeds history and diffs |
| `print_versions` | id, project\_id, label, created\_at, profile\_id, card\_hashes\_json | Snapshot of what was printed; powers "changed since" |
| `export_profiles` | id, project\_id, name, target, settings\_json | target = pdf, png, tts or shop |
| `fit_cache` | card\_id, template\_version, data\_hash, results\_json | Per-element fit results; rebuilt when inputs change |

The existing `cards` table gains one nullable column, `template_override_id`, for the rare card that breaks the rules.

## Template schema

A template is one JSON document: card size plus a tree of layers. This example is a unit card with a stat line that only shows on Units.

```json
{
  "schemaVersion": 1,
  "size": { "widthMm": 63, "heightMm": 88, "bleedMm": 3, "safeMm": 3 },
  "layers": [
    { "id": "frame", "type": "image",
      "frame": { "left": 0, "right": 0, "top": 0, "bottom": 0 },
      "src": "frames/{{lower(faction)}}.png" },

    { "id": "art", "type": "image",
      "frame": { "left": 4, "right": 4, "top": 10, "height": 38 },
      "src": "{{art}}", "objectFit": "cover", "placeholder": "proxy" },

    { "id": "name", "type": "text",
      "frame": { "left": 5, "right": 14, "top": 4, "height": 5 },
      "text": "{{name}}",
      "style": { "font": "Cinzel", "sizePt": 10, "weight": 700, "color": "#1b1b1b" },
      "fit": { "minPt": 7, "strategy": ["shrink"] } },

    { "id": "cost", "type": "iconRepeat",
      "frame": { "right": 4, "top": 3.5, "width": 10, "height": 6 },
      "count": "cost", "icon": "energy", "direction": "rtl" },

    { "id": "textBox", "type": "stack", "direction": "vertical", "gapMm": 1.5,
      "frame": { "left": 5, "right": 5, "bottom": 10, "height": 26 },
      "children": [
        { "id": "rules", "type": "richText", "text": "{{rules}}", "priority": 1,
          "style": { "font": "Crimson Pro", "sizePt": 8.5 },
          "fit": { "minPt": 6.5, "strategy": ["shrink", "tightenLeading"] } },
        { "id": "flavor", "type": "richText", "text": "*{{flavor}}*", "priority": 2,
          "visibleIf": "flavor != ''",
          "fit": { "strategy": ["hide"] } }
      ] },

    { "id": "stats", "type": "text", "visibleIf": "type == 'Unit'",
      "frame": { "right": 4, "bottom": 3, "width": 12, "height": 6 },
      "text": "{{power}}/{{health}}" }
  ]
}
```

**Rules the schema follows**

- `frame` holds offsets in mm (or `"50%"`) from the trim edges. Set any two of left/right/width and any two of top/bottom/height. Left + right means stretch, which is what lets layouts survive a size change.
- String properties are literals with `{{expression}}` interpolation. `visibleIf` and `count` are bare expressions.
- `{shortcode}` inside text renders a symbol; `icon` takes a shortcode name without braces.
- Inside a `stack`, overflow resolves by `priority`: the highest number yields first (flavor hides before rules shrink below min).
- Element types for v1: `text`, `richText`, `image`, `shape` (rect, rounded rect, ellipse), `iconRepeat`, `stack`, `group`. QR codes come later.

## Build plan

Seven phases, each shippable on its own. Phase 0 is a spike that proves the renderer before anything is built on it. Hand Claude Code one phase at a time; the checkboxes are its acceptance criteria.

### Phase 0 — Orient and spike

Goal: prove render, fit and export agree before committing to the approach.

- [ ] Read the TCG Studio codebase and schema; write `docs/architecture.md` summarizing it
- [ ] Render one card from hard-coded template JSON, with a rich-text field holding two inline symbols
- [ ] Shrink-to-fit works with a custom font
- [ ] Export that card as a 300 DPI PNG and a one-page PDF with crop marks
- [ ] Gate: the PNG and PDF match the on-screen render, including where text wrapped

### Phase 1 — Renderer and live preview

- [ ] Template schema v1 as TypeScript types with a zod validator
- [ ] Renderer supports `text`, `richText`, `image`, `shape`, `stack`, `group`, `{{ }}` bindings and `visibleIf`
- [ ] Cards screen gets a preview pane; a cell edit re-renders the selected card in under 100 ms
- [ ] `template_rules` pick each card's template
- [ ] Assets load through `tcg-asset://` and refresh when a file changes on disk
- [ ] CSV/XLSX import with column mapping and a preview before commit

### Phase 2 — Template Designer

- [ ] Canvas with zoom, pan, bleed/trim/safe guides and snapping
- [ ] Select, drag, resize, multi-select, align and distribute; layers panel with reorder, lock and hide
- [ ] Properties panel with a binding picker listing the project's fields
- [ ] Sample-card switcher that steps through real cards
- [ ] Undo/redo for every canvas action
- [ ] Changing card size reflows the layout according to frame constraints
- [ ] Templates export and import as `.tcgtemplate`

### Phase 3 — Fit engine

- [ ] Fit policy per text element, applied in the order from Signature features
- [ ] `fit_cache` fills in the background for the whole set and invalidates on any input change
- [ ] Fit-status column and filter in Cards
- [ ] Worst-case button in the Designer
- [ ] Live fit budget in the cell editor

### Phase 4 — Symbols, keywords and variables

- [ ] Library screen for symbols, keywords and variables
- [ ] `{shortcode}` renders inline, sized to the line and baseline-aligned
- [ ] Keywords with parameters and conditional reminder text; toggle per card and per set
- [ ] Keyword-to-rule links and a "where used" list on rename
- [ ] `iconRepeat` element

### Phase 5 — Export

- [ ] Profiles for PNG set, print-and-play PDF (Letter or A4, crop marks, bleed, duplex backs) and Tabletop Simulator sheets
- [ ] Batch export queue with progress and cancel
- [ ] Print versions recorded; "changed since" filter and "print changed only"

### Phase 6 — Gallery and set tools

- [ ] Virtualized gallery with thumbnail cache and fit badges
- [ ] Stats sidebar: rarity, cost curve, counts by type and faction
- [ ] Auto numbering rules
- [ ] Pack simulator
- [ ] Card revision history with side-by-side render diff

### Later, optional

- Two-way Google Sheets sync
- QR elements and per-faction card backs
- Opt-in AI helpers: placeholder art per card from its name and type, and a rules-text lint that flags inconsistent wording across the set

## Open questions

Six choices shape the first phases. The spec's current assumption is in brackets.

- [ ] Module inside TCG Studio, or a standalone app? \[module\]
- [ ] Which card sizes first? \[poker, 63 × 88 mm\]
- [ ] Home print-and-play only, or presets for a specific print shop such as The Game Crafter or MakePlayingCards? \[print-and-play first\]
- [ ] Cards only for v1, or tokens, tiles and boards too? \[cards only\]
- [ ] Has TCG Studio V1 changed since March, and does anything need fixing before building on it? \[build on V1 as scaffolded\]
- [ ] In a stack, hide flavor text before shrinking rules text, or shrink first? \[shrink to min, then hide\]

## Kickoff prompt for Claude Code

Save this spec in the repo as `docs/card-designer-spec.md`, open Claude Code in the TCG Studio folder, and paste the prompt below. It keeps the first session to Phase 0 so you can check the renderer before real building starts.

```text
Read docs/card-designer-spec.md. We're adding the Visual Card Designer module to TCG Studio.

Start in plan mode. Do Phase 0 only:
1. Read the codebase and SQLite schema, then write docs/architecture.md summarizing structure, data flow and conventions.
2. Build the render / fit / export spike described in Phase 0.

Constraints:
- Stay on the existing stack (Electron, React 18, Vite, better-sqlite3, Zustand, Tailwind). Ask before adding any dependency beyond those named in the spec.
- No eval or new Function anywhere. Expressions go through a sandboxed evaluator.
- Put new code in its own module folder that fits the existing structure.
- Don't create the new database tables yet; that's Phase 1.

Stop at the Phase 0 gate. Show me the exported PNG, the PDF, and a screenshot of the on-screen render side by side, and list anything in the spec that the codebase contradicts.
```

For each later phase: "Do Phase N from the spec. Tick off its checklist as you go, run the app, and stop when every box is checked."

## Sources

- [Component.Studio](https://component.studio/)
- [Tabletop Creator](https://tabletop-creator.com/)
- [Tabletop Creator Pro Steam community hub](https://steamcommunity.com/app/861590)
- [Magic Set Editor](https://magicseteditor.com/)
- [Magic Set Editor keyword guide](https://magicseteditor.sourceforge.net/node/877)
- [Magic Set Editor on MTG Wiki](https://mtg.fandom.com/wiki/Magic_Set_Editor)
