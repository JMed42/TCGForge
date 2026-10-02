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
 *   render: RenderService, dialog, shell, getWindow()
 * }
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

  const loadForCard = (cardId, templateId, draft) => {
    const card = loadCard(cardId);
    const { row, template } = loadTemplate(templateId, draft);
    if (row.project_id !== card.project_id) throw new Error('card and template belong to different projects');
    return { card, template, projectId: row.project_id };
  };

  const pngFor = async ({ template, card, projectId }, dpi, { showBleed = false, background = null } = {}) => {
    const { image, report } = await render.renderCard({ template, card, projectId, pxPerMm: dpi / 25.4, showBleed, background });
    return { png: withDpi(image.toPNG(), dpi), image, report };
  };

  // One PDF page holding a single card with bleed and crop marks.
  const pdfFor = async ({ template, card, projectId }, { cropMarks = true } = {}) => {
    const layout = sheets.singleCardPage(template, { cropMarks });
    const pages = sheets.buildSheetPages(layout, 1, () => card, { cropMarks });
    return render.printPages({
      projectId, template, showBleed: true,
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

  // ── Single card ──
  // options: { format: png|jpeg|pdf, dpi, draft, outputPath, bleed (png: include bleed area) }
  ipcMain.handle('exportCard', async (_, cardId, templateId, options = {}) => {
    const job = loadForCard(cardId, templateId, options.draft);
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
    return { path: outPath, warnings: report ? report.warnings : [] };
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

    const { row, template } = loadTemplate(templateId, options.draft);
    if (row.project_id !== projectId) throw new Error(`template ${templateId} not found in project ${projectId}`);
    const cards = queryCards(projectId, options.filter || {});
    const errors = [];
    let exported = 0;
    const started = Date.now();
    const sender = event.sender;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!sender.isDestroyed()) sender.send('exportProgress', { current: i + 1, total: cards.length });
      try {
        const out = await pngFor({ template, card, projectId }, dpi, { showBleed: Boolean(options.bleed), background: format === 'jpeg' ? '#ffffff' : null });
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
    const { row, template } = loadTemplate(templateId, options.draft);
    if (row.project_id !== projectId) throw new Error(`template ${templateId} not found in project ${projectId}`);
    const layout = sheetLayoutFor(template, options);
    if (layout.perPage < 1) throw new Error('this card size does not fit on the chosen paper');
    const copies = Math.max(1, Math.min(99, Math.floor(Number(options.copies) || 1)));
    const cards = queryCards(projectId, options.filter || {});
    if (cards.length === 0) throw new Error('no cards match the current filter');
    const total = cards.length * copies;
    if (total > MAX_SHEET_SLOTS) throw new Error(`at most ${MAX_SHEET_SLOTS} cards per print run`);

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
    const pages = sheets.buildSheetPages(layout, total, (i) => cards[Math.floor(i / copies)], { cropMarks: options.cropMarks !== false });
    // The sheet's bleed choice overrides the template's for this print (0 = rounded trim cards).
    const printTemplate = { ...template, size: { ...template.size, bleedMm: layout.bleedMm } };
    const { pdf, report } = await render.printPages({
      projectId, template: printTemplate, showBleed: layout.bleedMm > 0,
      pageWidthMm: layout.pageWidthMm, pageHeightMm: layout.pageHeightMm, pages,
    });
    fs.writeFileSync(outPath, pdf);
    if (!sender.isDestroyed()) sender.send('exportProgress', { current: total, total });
    return {
      path: outPath, pages: pages.length, cards: cards.length, copies, perPage: layout.perPage, layout,
      errors: report ? report.warnings : [], elapsedMs: Date.now() - started,
    };
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
  ipcMain.handle('importCardArt', async (_, projectId, sourcePath) => {
    const imagePath = await art.importCardArt(userDataPath, projectId, sourcePath);
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
