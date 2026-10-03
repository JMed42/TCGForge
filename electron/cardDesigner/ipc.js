// IPC channels for the Card Designer. Templates (schema v1) are rows in the `templates` table,
// addressed by numeric id. Rendering for export happens in a hidden window running the same
// CardRender component as the editor (electron/renderWindow.js).

const fs = require('fs');
const path = require('path');
const templates = require('./templates');
const art = require('./art');
const sheets = require('./sheets');
const { withDpi } = require('./pngDpi');
const { listProjectFonts } = require('./projectFonts');
const tcgtemplate = require('./tcgtemplate');

const FORMATS = {
  png: { ext: 'png', filter: { name: 'PNG image', extensions: ['png'] } },
  jpeg: { ext: 'jpg', filter: { name: 'JPEG image', extensions: ['jpg', 'jpeg'] } },
  pdf: { ext: 'pdf', filter: { name: 'PDF document', extensions: ['pdf'] } },
};
const MIN_DPI = 24;
const MAX_DPI = 1200;
const MAX_SHEET_SLOTS = 2000;

function formatOf(value) {
  const key = value === 'jpg' ? 'jpeg' : String(value || 'png');
  if (!FORMATS[key]) throw new Error(`unsupported format "${value}"`);
  return key;
}

function dpiOf(value, fallback) {
  const n = Number(value) || fallback;
  return Math.min(MAX_DPI, Math.max(MIN_DPI, n));
}

// Default single-card filename per spec: {card-name}-preview.png / -print.png / -print.pdf
function singleFileName(card, format, dpi) {
  const base = templates.slugify(card.name) || `card_${card.id}`;
  const suffix = format === 'pdf' || dpi >= 300 ? 'print' : 'preview';
  return `${base}-${suffix}.${FORMATS[format].ext}`;
}

// Batch filename per spec: {set_name}_{card-name}_{id}.png
function batchFileName(card, format) {
  const parts = [templates.slugify(card.set_name), templates.slugify(card.name) || 'card', String(card.id)];
  return `${parts.filter(Boolean).join('_')}.${FORMATS[format].ext}`;
}

// Row as sent to the renderer process: content stays JSON text, plus a structural error if any.
function templateRowOut(row) {
  let error = null;
  try { templates.validateTemplateObject(JSON.parse(row.content)); } catch (err) { error = err.message; }
  return { ...row, error };
}

/**
 * @param ipcMain
 * @param deps {
 *   userDataPath, getCard(id), queryCards(projectId, filters),
 *   listTemplates(projectId), getTemplate(id), insertTemplate(projectId, name, content),
 *   updateTemplate(id, name, content), deleteTemplate(id),
 *   render: RenderService, dialog, shell, getWindow(),
 *   listTemplateRules(projectId), resolveTemplates?({ cards, rules, templateIds }) -> Map (tests)
 * }
 *
 * Batch exports and exportCard accept templateId 'auto': each card uses the template its
 * override or the project's template rules pick (saved templates; drafts are not applied).
 */
function registerCardDesignerIpc(ipcMain, deps) {
  const { userDataPath, getCard, queryCards, dialog, shell, getWindow, render } = deps;

  const loadCard = (cardId) => {
    const card = getCard(cardId);
    if (!card) throw new Error(`card ${cardId} not found`);
    return card;
  };

  // Template JSON from the DB, or an unsaved editor draft (validated structurally here; the
  // renderer already ran the full zod schema).
  const loadTemplate = (templateId, draft) => {
    const row = deps.getTemplate(templateId);
    if (!row) throw new Error(`template ${templateId} not found`);
    const template = templates.validateTemplateObject(draft !== undefined && draft !== null ? draft : JSON.parse(row.content));
    return { row, template };
  };

  const isAuto = (templateId) => templateId === 'auto';

  // The project's symbols, keywords and variables travel with every render job, so exports draw
  // them exactly as the editor does.
  const libraryFor = (projectId) => (deps.getLibrary ? deps.getLibrary(projectId) : null);

  // The cards an export covers: an explicit list (what the Database tab shows, in its order),
  // or a filter for older callers.
  const cardsFor = (projectId, options) => {
    if (!Array.isArray(options.cardIds)) return queryCards(projectId, options.filter || {});
    const byId = new Map(queryCards(projectId, {}).map((c) => [c.id, c]));
    return options.cardIds.map((id) => byId.get(Number(id))).filter(Boolean);
  };

  // Map cardId -> templateId (or null) by override, then rules, then the project default.
  const resolveFor = async (projectId, cards) => {
    const templateIds = deps.listTemplates(projectId).map((t) => t.id);
    const rules = deps.listTemplateRules ? deps.listTemplateRules(projectId) : [];
    const resolver = deps.resolveTemplates || ((args) => render.resolveTemplates(args));
    return resolver({ cards, rules, templateIds });
  };

  // Saved templates by id, validated once per export run.
  const templateCache = () => {
    const cache = new Map();
    return (id) => {
      if (!cache.has(id)) cache.set(id, loadTemplate(id).template);
      return cache.get(id);
    };
  };

  const loadForCard = async (cardId, templateId, draft) => {
    if (isAuto(templateId)) {
      const card = loadCard(cardId);
      const resolved = (await resolveFor(card.project_id, [card])).get(card.id);
      if (!resolved) throw new Error('this project has no templates');
      return { card, template: loadTemplate(resolved).template, projectId: card.project_id };
    }
    const card = loadCard(cardId);
    const { row, template } = loadTemplate(templateId, draft);
    if (row.project_id !== card.project_id) throw new Error('card and template belong to different projects');
    return { card, template, projectId: row.project_id };
  };

  const pngFor = async ({ template, card, projectId, library }, dpi, { showBleed = false, background = null } = {}) => {
    const lib = library === undefined ? libraryFor(projectId) : library;
    const { image, report } = await render.renderCard({ template, card, projectId, pxPerMm: dpi / 25.4, showBleed, background, library: lib });
    return { png: withDpi(image.toPNG(), dpi), image, report };
  };

  // One PDF page holding a single card with bleed and crop marks.
  const pdfFor = async ({ template, card, projectId }, { cropMarks = true } = {}) => {
    const layout = sheets.singleCardPage(template, { cropMarks });
    const pages = sheets.buildSheetPages(layout, 1, () => card, { cropMarks });
    return render.printPages({
      projectId, template, showBleed: true, library: libraryFor(projectId),
      pageWidthMm: layout.pageWidthMm, pageHeightMm: layout.pageHeightMm, pages,
    });
  };

  // ── Templates ──
  ipcMain.handle('getTemplates', (_, projectId) => deps.listTemplates(projectId).map(templateRowOut));

  ipcMain.handle('createTemplate', (_, projectId, name) => {
    const tpl = templates.blankTemplate(String(name || '').trim() || 'New Template');
    return templateRowOut(deps.insertTemplate(projectId, tpl.name, JSON.stringify(tpl, null, 2)));
  });

  // template: object or JSON text. id omitted → insert; otherwise update (must be in projectId).
  ipcMain.handle('saveTemplate', (_, projectId, template, id) => {
    const obj = templates.validateTemplateObject(typeof template === 'string' ? JSON.parse(template) : template);
    const name = String(obj.name || '').trim() || 'Untitled';
    const content = JSON.stringify(obj, null, 2);
    if (id === undefined || id === null) return templateRowOut(deps.insertTemplate(projectId, name, content));
    const existing = deps.getTemplate(id);
    if (!existing || existing.project_id !== projectId) throw new Error(`template ${id} not found in project ${projectId}`);
    return templateRowOut(deps.updateTemplate(id, name, content));
  });

  ipcMain.handle('deleteTemplate', (_, id) => deps.deleteTemplate(id));

  ipcMain.handle('listProjectFonts', (_, projectId) => listProjectFonts(templates.projectDir(userDataPath, projectId)));

  // The project's fonts or symbol images folder in Explorer (created if missing).
  ipcMain.handle('openProjectFolder', (_, projectId, sub) => {
    if (!['assets/fonts', 'assets/icons'].includes(sub)) throw new Error(`unknown folder "${sub}"`);
    const dir = path.join(templates.projectDir(userDataPath, projectId), ...sub.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });

  // ── Single card ──
  // options: { format: png|jpeg|pdf, dpi, draft, outputPath, bleed (png: include bleed area) }
  ipcMain.handle('exportCard', async (_, cardId, templateId, options = {}) => {
    const job = await loadForCard(cardId, templateId, options.draft);
    const format = formatOf(options.format);
    const dpi = dpiOf(options.dpi, format === 'pdf' ? 300 : 96);
    let outPath = options.outputPath;
    if (!outPath) {
      const res = await dialog.showSaveDialog(getWindow(), {
        defaultPath: singleFileName(job.card, format, dpi),
        filters: [FORMATS[format].filter],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      outPath = res.filePath;
    }
    let report;
    if (format === 'pdf') {
      const out = await pdfFor(job, { cropMarks: options.cropMarks !== false });
      fs.writeFileSync(outPath, out.pdf);
      report = out.report;
    } else if (format === 'jpeg') {
      // JPEG has no alpha: rounded corners are composited onto white.
      const out = await pngFor(job, dpi, { showBleed: Boolean(options.bleed), background: '#ffffff' });
      fs.writeFileSync(outPath, out.image.toJPEG(92));
      report = out.report;
    } else {
      const out = await pngFor(job, dpi, { showBleed: Boolean(options.bleed) });
      fs.writeFileSync(outPath, out.png);
      report = out.report;
    }
    // fits: the export's own fit results by layer (PNG/JPEG), to compare with the Fit column.
    return { path: outPath, warnings: report ? report.warnings : [], fits: report && report.fits ? report.fits : {} };
  });

  // ── All cards (PNG/JPEG files) ──
  ipcMain.handle('exportAllCards', async (event, projectId, templateId, options = {}) => {
    const format = formatOf(options.format);
    if (format === 'pdf') throw new Error('use print sheets for a multi-card PDF');
    const dpi = dpiOf(options.dpi, 300);
    let outputDir = options.outputDir;
    if (!outputDir) {
      const res = await dialog.showOpenDialog(getWindow(), {
        title: 'Choose export folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || !res.filePaths[0]) return { canceled: true };
      outputDir = res.filePaths[0];
    }
    fs.mkdirSync(outputDir, { recursive: true });

    const cards = cardsFor(projectId, options);
    let templateFor;
    if (isAuto(templateId)) {
      const resolved = await resolveFor(projectId, cards);
      const byId = templateCache();
      templateFor = (card) => {
        const id = resolved.get(card.id);
        if (!id) throw new Error('no template (the project has none)');
        return byId(id);
      };
    } else {
      const { row, template } = loadTemplate(templateId, options.draft);
      if (row.project_id !== projectId) throw new Error(`template ${templateId} not found in project ${projectId}`);
      templateFor = () => template;
    }
    const errors = [];
    let exported = 0;
    const started = Date.now();
    const sender = event.sender;
    const library = libraryFor(projectId);

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!sender.isDestroyed()) sender.send('exportProgress', { current: i + 1, total: cards.length });
      try {
        const out = await pngFor({ template: templateFor(card), card, projectId, library }, dpi, { showBleed: Boolean(options.bleed), background: format === 'jpeg' ? '#ffffff' : null });
        fs.writeFileSync(path.join(outputDir, batchFileName(card, format)), format === 'jpeg' ? out.image.toJPEG(92) : out.png);
        for (const w of out.report.warnings) errors.push(`card ${card.id} "${card.name}": warning: ${w}`);
        exported++;
      } catch (err) {
        errors.push(`card ${card.id} "${card.name}": ${err.message}`);
      }
    }

    if (errors.length) {
      fs.writeFileSync(path.join(outputDir, 'render-errors.log'), errors.join('\n') + '\n', 'utf8');
    }
    return { exported, skipped: cards.length - exported, total: cards.length, errors, outputDir, elapsedMs: Date.now() - started };
  });

  // ── Print sheets ──
  const sheetLayoutFor = (template, options) => {
    const card = sheets.cardSizeMm(template);
    const bleedMm = Math.max(0, Math.min(10, Number(options.bleedMm) || 0));
    return sheets.layoutSheet({ paper: options.paper || 'letter', cardWidthMm: card.width, cardHeightMm: card.height, bleedMm });
  };

  ipcMain.handle('getSheetLayout', (_, templateId, options = {}) => {
    const { template } = loadTemplate(templateId, options.draft);
    return sheetLayoutFor(template, options);
  });

  // options: { paper, bleedMm, cropMarks, copies, filter, draft, outputPath }
  ipcMain.handle('exportPrintSheets', async (event, projectId, templateId, options = {}) => {
    const copies = Math.max(1, Math.min(99, Math.floor(Number(options.copies) || 1)));
    const cards = cardsFor(projectId, options);
    if (cards.length === 0) throw new Error('no cards match the current filter');
    const total = cards.length * copies;
    if (total > MAX_SHEET_SLOTS) throw new Error(`at most ${MAX_SHEET_SLOTS} cards per print run`);

    // Groups of cards that share a card size; each group gets its own sheet layout.
    let groups;
    let template;
    if (isAuto(templateId)) {
      const resolved = await resolveFor(projectId, cards);
      const byId = templateCache();
      const bySize = new Map();
      for (const card of cards) {
        const id = resolved.get(card.id);
        if (!id) throw new Error('this project has no templates');
        const t = byId(id);
        const key = `${t.size.widthMm}x${t.size.heightMm}`;
        if (!bySize.has(key)) bySize.set(key, { template: t, entries: [] });
        bySize.get(key).entries.push({ card, template: t });
      }
      groups = [...bySize.values()];
      template = groups[0].template;
    } else {
      const loaded = loadTemplate(templateId, options.draft);
      if (loaded.row.project_id !== projectId) throw new Error(`template ${templateId} not found in project ${projectId}`);
      template = loaded.template;
      groups = [{ template, entries: cards.map((card) => ({ card, template })) }];
    }
    for (const g of groups) {
      g.layout = sheetLayoutFor(g.template, options);
      if (g.layout.perPage < 1) throw new Error(`${g.template.size.widthMm} × ${g.template.size.heightMm} mm cards do not fit on the chosen paper`);
    }
    const layout = groups[0].layout;

    let outPath = options.outputPath;
    if (!outPath) {
      const res = await dialog.showSaveDialog(getWindow(), {
        defaultPath: `${templates.slugify(template.name) || 'cards'}-${layout.paper}-sheets.pdf`,
        filters: [FORMATS.pdf.filter],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      outPath = res.filePath;
    }

    const started = Date.now();
    const sender = event.sender;
    if (!sender.isDestroyed()) sender.send('exportProgress', { current: 0, total });
    // The sheet's bleed choice overrides the template's for this print (0 = rounded trim cards).
    const forPrint = (t) => ({ ...t, size: { ...t.size, bleedMm: layout.bleedMm } });
    const pages = [];
    for (const g of groups) {
      const printed = new Map();
      const printFor = (t) => { if (!printed.has(t)) printed.set(t, forPrint(t)); return printed.get(t); };
      const groupPages = sheets.buildSheetPages(g.layout, g.entries.length * copies, (i) => g.entries[Math.floor(i / copies)].card, { cropMarks: options.cropMarks !== false });
      let slot = 0;
      for (const page of groupPages) {
        page.items = page.items.map((item) => ({ ...item, template: printFor(g.entries[Math.floor(slot++ / copies)].template) }));
        pages.push({ ...page, pageWidthMm: g.layout.pageWidthMm, pageHeightMm: g.layout.pageHeightMm });
      }
    }
    const { pdf, report } = await render.printPages({
      projectId, template: forPrint(template), showBleed: layout.bleedMm > 0, library: libraryFor(projectId),
      pageWidthMm: layout.pageWidthMm, pageHeightMm: layout.pageHeightMm, pages,
    });
    fs.writeFileSync(outPath, pdf);
    if (!sender.isDestroyed()) sender.send('exportProgress', { current: total, total });
    return {
      path: outPath, pages: pages.length, cards: cards.length, copies, perPage: layout.perPage, layout,
      errors: report ? report.warnings : [], elapsedMs: Date.now() - started,
    };
  });

  // ── .tcgtemplate export / import ──
  // options: { draft, outputPath }
  ipcMain.handle('exportTemplateFile', async (_, templateId, options = {}) => {
    const { row, template } = loadTemplate(templateId, options.draft);
    let outPath = options.outputPath;
    if (!outPath) {
      const res = await dialog.showSaveDialog(getWindow(), {
        defaultPath: `${templates.slugify(template.name || row.name) || 'template'}.tcgtemplate`,
        filters: [{ name: 'TCGForge template', extensions: ['tcgtemplate'] }],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      outPath = res.filePath;
    }
    const pkg = tcgtemplate.buildPackage(userDataPath, row.project_id, { ...template, name: template.name || row.name });
    fs.writeFileSync(outPath, JSON.stringify(pkg));
    return { path: outPath, assets: pkg.assets.map((a) => a.path), bytes: fs.statSync(outPath).size };
  });

  // Step 1: read and check the file; the renderer validates the template (zod) before step 2.
  const pendingImports = new Map();
  let importSeq = 0;
  ipcMain.handle('readTemplateFile', async (_, projectId, options = {}) => {
    let inPath = options.inputPath;
    if (!inPath) {
      const res = await dialog.showOpenDialog(getWindow(), {
        title: 'Import template',
        properties: ['openFile'],
        filters: [{ name: 'TCGForge template', extensions: ['tcgtemplate'] }],
      });
      if (res.canceled || !res.filePaths[0]) return { canceled: true };
      inPath = res.filePaths[0];
    }
    if (fs.statSync(inPath).size > 250 * 1024 * 1024) throw new Error('file is larger than 250 MB');
    const parsed = tcgtemplate.parsePackage(fs.readFileSync(inPath, 'utf8'));
    const token = `imp-${++importSeq}`;
    pendingImports.clear(); // only the latest read can be imported
    pendingImports.set(token, { projectId, parsed });
    return { token, template: parsed.template, assets: parsed.assets.map((a) => ({ path: a.path, size: a.data.length })) };
  });

  // Step 2: write assets (never overwriting) and insert the template.
  ipcMain.handle('importTemplateFile', (_, token) => {
    const pending = pendingImports.get(token);
    if (!pending) throw new Error('import expired; open the file again');
    pendingImports.delete(token);
    const { projectId, parsed } = pending;
    const installed = tcgtemplate.installAssets(userDataPath, projectId, parsed);
    const existing = new Set(deps.listTemplates(projectId).map((t) => t.name));
    let name = String(installed.template.name || 'Imported template').trim() || 'Imported template';
    if (existing.has(name)) {
      name = `${name} (imported)`;
      for (let n = 2; existing.has(name); n++) name = `${String(installed.template.name).trim()} (imported ${n})`;
    }
    const template = { ...installed.template, name };
    const row = deps.insertTemplate(projectId, name, JSON.stringify(template, null, 2));
    return { template: templateRowOut(row), written: installed.written, reused: installed.reused, renamed: installed.renamed, warnings: installed.warnings };
  });

  // ── Card art ──
  ipcMain.handle('chooseCardArt', async (_, projectId) => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose card art',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: art.ART_EXTENSIONS }],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const imagePath = await art.importCardArt(userDataPath, projectId, res.filePaths[0]);
    return { path: imagePath, thumbnail: await art.thumbnail(userDataPath, projectId, imagePath) };
  });

  // Same as chooseCardArt without the dialog (tests, and drag-and-drop later).
  // options.folder: 'art' (card art, default) or 'images' (template frames and icons).
  ipcMain.handle('importCardArt', async (_, projectId, sourcePath, options = {}) => {
    const imagePath = await art.importCardArt(userDataPath, projectId, sourcePath, { folder: options.folder || 'art' });
    return { path: imagePath, thumbnail: await art.thumbnail(userDataPath, projectId, imagePath) };
  });

  ipcMain.handle('getImageThumbnail', (_, projectId, imagePath) => art.thumbnail(userDataPath, projectId, imagePath));

  ipcMain.handle('showInFolder', (_, target) => {
    if (!target) return;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) return shell.openPath(target);
    shell.showItemInFolder(target);
  });
}

module.exports = { registerCardDesignerIpc, batchFileName, singleFileName };
