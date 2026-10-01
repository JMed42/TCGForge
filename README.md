# TCG Studio

A lightweight desktop app for trading card game developers. Manage cards, write rules, and organize game design documents across multiple projects.

## Features

- **Multi-Project Support** — Switch between unlimited game projects, each with their own cards and documents
- **Card Database Manager** — Full CRUD with filtering, sorting, tagging, bulk operations, and custom fields
- **Rules & GDD Editor** — Rich text editor with document tree, folder organization, rule tagging, and cross-referencing
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
- **SQLite** (better-sqlite3) — Embedded database
- **TipTap** — Rich text editor for rules and GDD documents
- **Zustand** — Lightweight state management
- **Tailwind CSS** — Utility-first styling

## Project Structure

```
TCG-Studio/
├── electron/
│   ├── main.js          # Electron main process
│   ├── preload.js       # IPC bridge (window.api)
│   └── database.js      # SQLite operations
├── src/
│   ├── App.jsx          # Root component
│   ├── store.js         # Zustand state management
│   ├── components/
│   │   ├── Layout/      # Sidebar, TopBar
│   │   ├── Projects/    # Project selector, form, switcher
│   │   ├── Cards/       # Card table, editor, filters, bulk actions
│   │   └── Rules/       # Document tree, TipTap editor, toolbar
│   └── index.css        # Tailwind + custom styles
├── package.json
├── vite.config.js
└── tailwind.config.js
```

## Database

Data is stored in a SQLite database at `{userData}/tcg-studio.db`. The schema includes:

- **projects** — Name, description, custom card schema (JSON)
- **cards** — Name, type, set, rarity, cost, power, toughness, rules text, flavor text, tags, custom fields
- **documents** — Hierarchical tree (folders, documents, rules) with rich text content

## Import/Export

Export any project as a complete JSON file including all cards and documents. Import JSON files to create new projects from shared data.
