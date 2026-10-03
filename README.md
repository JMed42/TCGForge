# TCGForge

A lightweight desktop app for trading card game developers. Manage cards, write rules, and organize game design documents across multiple projects.

## Features

- **Multi-Project Support** — Switch between unlimited game projects, each with their own cards and documents
- **Card Types** — Define your game's own card types (Unit, Spell, Equipment…) and the fields each one has (cost, ATK, DEF, Action Rating, attunement cost…): text, long text, number, choice, yes/no, image or tags. Each type has a default template.
- **Cards** — Two tabs over the same cards, with a live render beside them. **Cards**: a list and a form with the card type's fields, saved as you type. **Database**: a spreadsheet grid for batch edits — copy and paste blocks with Excel or Google Sheets, fill down, set a field on many cards, filter on any field, undo every batch in one step. Import cards from CSV or Excel (.xlsx) onto your fields, with a preview before anything is written.
- **Template Assignment** — Each card type has its template; exceptions pick another for some cards (`rarity == "Mythic"` → foil frame); any card can choose its own. Batch exports and print sheets can follow it.
- **Fit Checks** — Every text layer shrinks to its minimum size, tightens its line spacing, then hides (in a stack, flavor text gives way before card text) or is flagged as overflowing. The whole set is checked in the background: a Fit column and filter on the Database tab ("overflow", "shrunk below 7 pt"), badges in the card list, a live budget under the field you are typing in ("Effect: fits at 8 pt · about 2 lines to spare"), and a Worst case button in the Designer that jumps to the card where the selected text is hardest to fit.
- **Clipboard Art** — Copy an image anywhere (a browser, an image editor, a file in Explorer) and press Paste on a card's art, in the preview, on an art cell, or on a template's image layer.
- **Game Docs** — Your game's rulebook, lore and design notes: rich text documents in folders, with numbered rule entries
- **Card Designer** — Visual template designer: zoom and pan, bleed/trim/safe guides, drag, resize, snapping, multi-select, align and distribute, groups and auto-layout stacks, a layer tree, and a properties panel with a binding picker (`{{name}}`, `{{upper(name)}}`, `visibleIf` conditions). Layouts are anchored in mm, so changing the card size reflows them. Step through real cards while you design. Export PNG (any dpi), vector PDF, all cards at once, or print-and-play sheets (Letter/A4, bleed, crop marks). Share templates as `.tcgtemplate` files. What the editor shows is what exports.
- **SQLite Storage** — Fast local database with JSON import/export for portability
- **Dark Theme** — Purpose-built dark interface designed for long sessions

## Quick Start

**Double-click `StartTCGForge.cmd`.** On first run it installs dependencies, then opens the app. Closing the app window shuts everything down.

For development (with DevTools):

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
```

This starts both the Vite dev server and Electron. The app window will open automatically once the dev server is ready.

Run the tests with:

```bash
npm test
```

## Build for Production

```bash
npm run build
```

This creates a distributable Electron app in the `release/` directory.

## Tech Stack

- **Electron** — Desktop shell with native file system access
- **React 18** — UI framework
- **Vite** — Fast dev server and bundler
- **SQLite** (sql.js, WebAssembly) — Embedded database
- **React DOM card renderer** — one renderer for the editor and exports (Electron capturePage / printToPDF)
- **zod + TypeScript** — template schema validation and type-checking for the designer engine
- **TipTap** — Rich text editor for rules and GDD documents
- **Zustand** — Lightweight state management
- **Tailwind CSS** — Utility-first styling

## Project Structure

```
TCGForge/
├── docs/                # Architecture notes and feature specs
├── electron/
│   ├── main.js          # Electron main process
│   ├── preload.js       # IPC bridge (window.api)
│   ├── database.js      # SQLite operations
│   ├── renderWindow.js  # hidden export window (PNG/PDF from the same renderer)
│   ├── assets.js        # tcg-asset:// protocol and file watching
│   ├── assetIndex.js    # assets table and missing-art report
│   ├── fitCache.js      # stored fit results
│   ├── import/          # CSV/XLSX card import
│   └── cardDesigner/    # templates, exports, print sheets, .tcgtemplate
├── scripts/             # dev seed data for a throwaway profile
├── src/
│   ├── App.jsx          # Root component
│   ├── store.js         # Zustand state management
│   ├── designer/        # Card Designer engine (TypeScript): schema, expressions, layout, renderer
│   ├── components/
│   │   ├── Layout/      # Sidebar, TopBar
│   │   ├── Projects/    # Project selector, form, switcher
│   │   ├── Cards/       # Card table, editor, filters, bulk actions
│   │   ├── CardDesigner/ # Designer canvas, layers, properties, export
│   │   ├── CardTypes/   # Card types and fields
│   │   ├── Fit/         # background fit check, live budget, Fit column pieces
│   │   └── Rules/       # Game Docs: document tree, TipTap editor, toolbar
│   └── index.css        # Tailwind + custom styles
├── package.json
├── vite.config.js
└── tailwind.config.js
```

## Database

Data is stored in a SQLite database at `{appData}/TCGForge/tcgforge.db` (on Windows, `%APPDATA%\TCGForge`). Template JSON lives in the database; images and fonts live beside it in `projects/{id}/assets/` (`art`, `frames`, `icons`, `fonts`). Replacing a file there updates every card immediately.

On first launch, data from the app's previous name (TCG Studio: `%APPDATA%\tcg-studio` or `%APPDATA%\TCG Studio`) is copied over automatically. The old folder is left untouched.

The schema includes:

- **projects** — Name, description, custom card schema (JSON)
- **cards** — Name, type, set, rarity, cost, power, toughness, rules text, flavor text, tags, custom fields, optional template override
- **templates** / **template_rules** — Card layouts (JSON) and the rules that pick one per card
- **assets** — Index of the image and font files in each project folder
- **card_types** / **card_fields** — Each project's card types and the fields they use
- **fit_cache** — Each card's fit results, kept while its text, template and fonts are unchanged
- **documents** — Hierarchical tree (folders, documents, rules) with rich text content

## Import/Export

Export any project as a complete JSON file including all cards and documents. Import JSON files to create new projects from shared data.

On the Cards screen, **Import…** reads a `.csv`, `.tsv` or `.xlsx` file: choose the sheet, map each column to a card field or custom field, check what each row will do (new, update by name, or skipped and why) with a live render, then import.
