# TCGForge

A lightweight desktop app for trading card game developers. Manage cards, write rules, and organize game design documents across multiple projects.

## Features

- **Multi-Project Support** — Switch between unlimited game projects, each with their own cards and documents
- **Card Database Manager** — Full CRUD with filtering, sorting, tagging, bulk operations, and custom fields
- **Rules & GDD Editor** — Rich text editor with document tree, folder organization, rule tagging, and cross-referencing
- **Card Designer** — Visual template designer: zoom and pan, bleed/trim/safe guides, drag, resize, snapping, multi-select, align and distribute, groups and auto-layout stacks, a layer tree, and a properties panel with a binding picker (`{{name}}`, `{{upper(name)}}`, `visibleIf` conditions). Layouts are anchored in mm, so changing the card size reflows them. Step through real cards while you design. Export PNG (any dpi), vector PDF, all cards at once, or print-and-play sheets (Letter/A4, bleed, crop marks). Share templates as `.tcgtemplate` files. What the editor shows is what exports.
- **Card Art** — Attach art in the card editor. Images are copied into the project.
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
│   │   └── Rules/       # Document tree, TipTap editor, toolbar
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
- **cards** — Name, type, set, rarity, cost, power, toughness, rules text, flavor text, tags, custom fields
- **documents** — Hierarchical tree (folders, documents, rules) with rich text content

## Import/Export

Export any project as a complete JSON file including all cards and documents. Import JSON files to create new projects from shared data.
