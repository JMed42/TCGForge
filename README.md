# TCGForge

A lightweight desktop app for trading card game developers. Manage cards, write rules, and organize game design documents across multiple projects.

## Features

- **Multi-Project Support** — Switch between unlimited game projects, each with their own cards and documents
- **Card Database Manager** — Full CRUD with filtering, sorting, tagging, bulk operations, and custom fields
- **Rules & GDD Editor** — Rich text editor with document tree, folder organization, rule tagging, and cross-referencing
- **Card Designer** (Phase 0) — JSON card templates rendered to PNG (96/300 dpi) and PDF, with an in-app preview from the same renderer
- **SQLite Storage** — Fast local database with JSON import/export for portability
- **Dark Theme** — Purpose-built dark interface designed for long sessions

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
```

This starts both the Vite dev server and Electron. The app window will open automatically once the dev server is ready.

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
- **node-canvas + pdfkit** — Off-screen card rendering and PDF export
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
│   └── cardDesigner/    # Card renderer, templates, export
├── scripts/             # Card Designer spike checks and dev seed data
├── src/
│   ├── App.jsx          # Root component
│   ├── store.js         # Zustand state management
│   ├── components/
│   │   ├── Layout/      # Sidebar, TopBar
│   │   ├── Projects/    # Project selector, form, switcher
│   │   ├── Cards/       # Card table, editor, filters, bulk actions
│   │   ├── CardDesigner/ # Template picker, preview, export
│   │   └── Rules/       # Document tree, TipTap editor, toolbar
│   └── index.css        # Tailwind + custom styles
├── package.json
├── vite.config.js
└── tailwind.config.js
```

## Database

Data is stored in a SQLite database at `{appData}/TCGForge/tcgforge.db` (on Windows, `%APPDATA%\TCGForge`). Card Designer templates live beside it in `projects/{id}/templates/`.

On first launch, data from the app's previous name (TCG Studio: `%APPDATA%\tcg-studio` or `%APPDATA%\TCG Studio`) is copied over automatically. The old folder is left untouched.

The schema includes:

- **projects** — Name, description, custom card schema (JSON)
- **cards** — Name, type, set, rarity, cost, power, toughness, rules text, flavor text, tags, custom fields
- **documents** — Hierarchical tree (folders, documents, rules) with rich text content

## Import/Export

Export any project as a complete JSON file including all cards and documents. Import JSON files to create new projects from shared data.
