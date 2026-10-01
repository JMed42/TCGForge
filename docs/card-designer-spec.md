# Card Designer — Feature Specification
**TCG Studio · Visual Card Designer Module**
Version: 0.1 · Status: Draft · Owner: Jacob Remedvick

---

## Overview

The Card Designer is a visual, layer-based card layout editor built into TCG Studio. It lets a designer define a card template once per project, then automatically render every card in the database into that template for preview and export.

The feature ships in three phases. **This document covers Phase 0 only** — the render engine, the static preview, and file export. No interactive drag-and-drop editor is included in Phase 0; layout is defined via a JSON template file. The interactive designer (drag, resize, layer panel) is Phase 1.

---

## Phase 0 — Render Engine, Preview & Export

### Goal

Given a card record from the database and a JSON template file, produce a pixel-accurate card image. The output must be print-ready (300 dpi) and web-ready (96 dpi) from the same render path.

---

### P0.1 — Template Format

A template is a single JSON file stored per-project at:

```
{project-root}/templates/{template-name}.json
```

**Schema:**

```jsonc
{
  "meta": {
    "name": "Standard Card",          // display name
    "version": "1",
    "width": 744,                     // canvas width in px at 96 dpi (= 2.5 in)
    "height": 1039,                   // canvas height in px at 96 dpi (= 3.5 in)
    "dpi": 96                         // reference DPI for this file's coordinates
  },
  "background": {
    "color": "#1a1a2e",               // solid fill (used if no image)
    "image": "assets/bg-default.png", // optional; relative to template file
    "fit": "cover"                    // "cover" | "contain" | "stretch" | "tile"
  },
  "layers": [
    {
      "id": "card-art",
      "type": "image",                // "image" | "text" | "shape" | "icon"
      "source": "{{image_path}}",     // {{field}} = bind to card field
      "x": 0, "y": 120,
      "width": 744, "height": 520,
      "fit": "cover",                 // "cover" | "contain" | "stretch"
      "align": "center top",
      "cornerRadius": 0,
      "opacity": 1.0,
      "zIndex": 1
    },
    {
      "id": "card-name",
      "type": "text",
      "value": "{{name}}",
      "x": 40, "y": 660,
      "width": 664, "height": 60,
      "font": "Inter Bold",           // system font name or bundled font filename
      "fontSize": 36,
      "color": "#ffffff",
      "align": "left",               // horizontal: "left" | "center" | "right"
      "valign": "middle",            // vertical: "top" | "middle" | "bottom"
      "overflow": "shrink",          // "shrink" | "clip" | "wrap"
      "zIndex": 10
    },
    {
      "id": "cost-badge",
      "type": "shape",
      "shape": "circle",
      "x": 668, "y": 32,
      "width": 64, "height": 64,
      "fill": "#7c6ef0",
      "stroke": "#ffffff",
      "strokeWidth": 3,
      "zIndex": 12
    },
    {
      "id": "cost-text",
      "type": "text",
      "value": "{{cost}}",
      "x": 668, "y": 32,
      "width": 64, "height": 64,
      "font": "Inter Bold",
      "fontSize": 28,
      "color": "#ffffff",
      "align": "center",
      "valign": "middle",
      "zIndex": 13
    }
  ]
}
```

**Field binding:** any string value containing `{{field_name}}` is replaced at render time with the matching column from the card record. Supported fields: all columns in the `cards` table (`name`, `type`, `set_name`, `rarity`, `cost`, `power`, `toughness`, `rules_text`, `flavor_text`, `tags`, `image_path`) plus any top-level keys from `custom_fields` JSON.

**Unresolved bindings** (field doesn't exist on the card) render as an empty string for text layers and a transparent/placeholder rect for image layers.

---

### P0.2 — Render Requirements

| Requirement | Detail |
|---|---|
| **Renderer** | Electron main process using `canvas` npm package (node-canvas / libcairo). No browser canvas — rendering runs off-screen without a window. |
| **Coordinate space** | All x/y/width/height in the template JSON are in **96 dpi pixels**. The renderer scales up to the requested output DPI automatically. |
| **Print output** | 300 dpi → multiply all coordinates by 3.125 (300÷96). Output: 2325 × 3244 px. |
| **Web/preview output** | 96 dpi → 1:1 with template coordinates. Output: 744 × 1039 px. |
| **Layer order** | Layers are painted in ascending `zIndex` order. Ties: document order. |
| **Image fit modes** | `cover`: scale to fill, crop edges; `contain`: scale to fit, letterbox; `stretch`: distort to fill; `tile`: repeat at native size. |
| **Text overflow** | `shrink`: reduce font size until text fits (min 8pt); `clip`: hard clip at bounds; `wrap`: word-wrap within bounds. |
| **Fonts** | Load from: (1) system fonts via `node-canvas` font registration; (2) TTF/OTF files in `{project}/assets/fonts/`. Font not found → fall back to sans-serif. |
| **Corner radius** | Applied as a clipping path before painting any layer that sets `cornerRadius > 0`. Card-level radius (outer card corners) is a top-level template property, default 24px at 96 dpi. |
| **Transparency** | Full RGBA. PNG output preserves alpha. JPEG output composites against white. |
| **Performance** | Single card render: < 500 ms. Batch of 100 cards: < 60 s. Batch uses a worker pool capped at `os.cpus().length - 1`. |

---

### P0.3 — Fit / Scale Rules (detail)

The fit algorithm for both image layers and the background follows CSS `object-fit` semantics:

```
cover:
  scale = max(targetW / srcW, targetH / srcH)
  drawX = (targetW - srcW * scale) / 2 + layer.x
  drawY = (targetH - srcH * scale) / 2 + layer.y
  clip to layer bounds before draw

contain:
  scale = min(targetW / srcW, targetH / srcH)
  drawX = (targetW - srcW * scale) / 2 + layer.x
  drawY = (targetH - srcH * scale) / 2 + layer.y
  no clip needed

stretch:
  drawX = layer.x, drawY = layer.y
  draw to (layer.width, layer.height) directly

tile:
  createPattern(image, 'repeat')
  fill layer rect with pattern
```

The `align` property on image layers shifts the crop anchor for `cover` mode:
- `"left top"` → anchor top-left (no offset applied)
- `"center top"` → center horizontally, anchor top
- `"center center"` → center both axes (default)
- etc. (9-point grid: left/center/right × top/middle/bottom)

---

### P0.4 — Export Requirements

#### Single-card export
Triggered from the card editor panel via an "Export Card Image" button.

| Option | Format | DPI | Filename |
|---|---|---|---|
| Web preview | PNG | 96 | `{card-name}-preview.png` |
| Print ready | PNG | 300 | `{card-name}-print.png` |
| Print CMYK hint | PDF | 300 | `{card-name}-print.pdf` (RGB embedded; note to user that true CMYK requires pro pre-press) |

#### Batch export
Triggered from a "Export All Cards" button in the Card Database toolbar.

- Opens a native Save dialog to choose an output folder.
- Renders every card currently matching the active filter (or all cards if no filter).
- Output filenames: `{set_name}_{card-name}_{id}.png` — slugified, lowercased, spaces→underscores.
- Progress bar shown in a modal: "Rendering card X of Y…"
- On completion: shows summary (X exported, Y skipped/errored) with a "Show in Folder" button.
- Errors per card are logged to `{output-folder}/render-errors.log`, not modal-blocking.

#### Sheet export (P0 stretch goal — include if time permits)
- Renders N cards onto a single print sheet (letter or A4).
- Grid layout: auto-calculated to fit standard card size with 3mm bleed.
- One PDF per sheet. Useful for tabletop print-and-play.

---

### P0.5 — IPC Channels (Electron)

New channels added to `electron/database.js` + `electron/preload.js`:

| Channel | Args | Returns |
|---|---|---|
| `getTemplates` | `projectId` | `Template[]` |
| `saveTemplate` | `projectId, template` | `Template` |
| `deleteTemplate` | `id` | `void` |
| `renderCard` | `cardId, templateId, options: {dpi}` | `{dataUrl: string}` |
| `exportCard` | `cardId, templateId, options: {dpi, format, outputPath}` | `{path: string}` |
| `exportAllCards` | `projectId, templateId, options: {dpi, format, outputDir, filter}` | `{exported: number, errors: string[]}` |

`renderCard` returns a base64 data URL for in-app preview. `exportCard` / `exportAllCards` write files to disk.

---

### P0.6 — In-App Preview

A new **"Designer"** view tab in the sidebar (between Cards and Rules). In Phase 0:

- Left panel: template picker dropdown + "New Template" button (opens a file-name dialog; creates a blank template JSON).
- Center: card preview canvas — renders the selected card from the Cards list using the selected template. Updates live when card fields or template change.
- Right panel: read-only JSON template editor (CodeMirror or a `<textarea>` with monospace font). Saving the JSON re-renders the preview.
- Toolbar: "Export This Card" and "Export All Cards" buttons.

The interactive drag-and-drop layer editor (Phase 1) replaces the right-panel JSON textarea.

---

## Gate Criteria — Phase 0 Complete

All of the following must pass before Phase 0 is considered shippable:

- [ ] `renderCard` produces a pixel-identical image across two consecutive calls for the same input (deterministic render).
- [ ] All six `fit` modes (`cover`, `contain`, `stretch`, `tile` for images; `shrink`, `clip`, `wrap` for text) produce visually correct output verified by manual inspection of a test card set.
- [ ] A card with every built-in field populated renders without error or missing layer.
- [ ] A card with no `image_path` renders with a neutral placeholder rect, not a crash.
- [ ] Batch export of 50 cards completes in under 60 seconds on a mid-range machine (tested on the dev machine).
- [ ] Exported PNGs open correctly in Windows Photos, macOS Preview, and GIMP.
- [ ] Exported 300 dpi PNG is exactly 2325 × 3244 px.
- [ ] Template JSON with an unknown layer type logs a warning and skips that layer (no crash).
- [ ] Font fallback works: a template referencing a non-installed font renders in sans-serif, not blank.
- [ ] "Show in Folder" after batch export opens the correct folder in Explorer / Finder.
- [ ] No memory leak: render 200 cards sequentially; process memory returns to baseline ± 50 MB.

---

## Dependencies

### New npm packages (add to `dependencies` in `package.json`)

| Package | Version | Purpose |
|---|---|---|
| `canvas` | `^2.11.2` | Node.js canvas via libcairo — off-screen raster rendering |
| `pdfkit` | `^0.15.0` | PDF generation for single-card and sheet exports |
| `sharp` | `^0.33.0` | Optional: fast image resizing/format conversion before compositing |
| `@electron/rebuild` | devDep | Recompile native modules (`canvas`, `sharp`) against the project's Electron ABI |

### Native build requirement
`canvas` and `sharp` are native Node addons. After `npm install`, run:

```bash
npx electron-rebuild
```

This recompiles both packages against the exact Electron version in use. It requires Python 3 and a C++ build toolchain:
- **Windows:** `npm install --global windows-build-tools` (or install "Desktop development with C++" via Visual Studio Installer)
- **macOS:** `xcode-select --install`
- **Linux:** `apt install build-essential`

Add to `package.json` scripts:

```json
"postinstall": "electron-rebuild"
```

### Existing packages used
- `sql.js` — card data is fetched via existing IPC channels; no schema changes needed for Phase 0 beyond adding the `templates` table.
- `electron` (IPC) — new channels listed in §P0.5.
- `zustand` — new `designerSlice` added to store for active template, preview card, render state.
- `lucide-react` — icons for Designer toolbar (Layers, Download, Image).

### New `templates` table (add to `electron/database.js` schema)

```sql
CREATE TABLE IF NOT EXISTS templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '{}',   -- full template JSON as string
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_templates_project ON templates(project_id);
```

---

## Out of Scope for Phase 0

- Drag-and-drop layer editor (Phase 1)
- Layer panel / inspector UI (Phase 1)
- Undo/redo within the designer (Phase 1)
- Multiple templates per project active simultaneously
- Animation or video export
- Cloud/online rendering
- True CMYK color management

---

## Open Questions

1. Should batch export respect the current Card Database filter, or always export all cards in the project? (Proposed: respect filter, with a confirmation if filter is "all".)
2. `canvas` on Windows sometimes requires a manual `libjpeg` path — worth bundling libjpeg or documenting the workaround?
3. Sheet export: Letter (8.5×11) only for now, or also A4?
