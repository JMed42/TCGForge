// IPC channels for the Card Designer (spec §P0.5).
// Templates are rows in the `templates` table, addressed by numeric id. Their assets live on
// disk under the project's folder (see templates.js).

const fs = require('fs');
const path = require('path');
const templates = require('./templates');
const { renderCard, yieldToEventLoop, warmUp } = require('./render');
const { toPng, toJpeg, writePdf } = require('./exporters');

const FORMATS = {
  png: { ext: 'png', filter: { name: 'PNG image', extensions: ['png'] } },
  jpeg: { ext: 'jpg', filter: { name: 'JPEG image', extensions: ['jpg', 'jpeg'] } },
  pdf: { ext: 'pdf', filter: { name: 'PDF document', extensions: ['pdf'] } },
};
const MIN_DPI = 24;
const MAX_DPI = 1200;

function formatOf(value) {
  const key = value === 'jpg' ? 'jpeg' : String(value || 'png');
  if (!FORMATS[key]) throw new Error(`unsupported format "${value}"`);
  return key;
}

function dpiOf(value, fallback) {
  const n = Number(value) || fallback;
  return Math.min(MAX_DPI, Math.max(MIN_DPI, n));
}

async function writeCardFile(canvas, template, format, dpi, outPath) {
  if (format === 'pdf') return writePdf(canvas, template, outPath, dpi);
  const buf = format === 'jpeg' ? toJpeg(canvas) : toPng(canvas, dpi);
  fs.writeFileSync(outPath, buf);
  return outPath;
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

// Row as sent to the renderer process: content stays JSON text, plus a parse error if any.
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
 *   dialog, shell, getWindow()
 * }
 */
function registerCardDesignerIpc(ipcMain, deps) {
  const { userDataPath, getCard, queryCards, dialog, shell, getWindow } = deps;
  setImmediate(warmUp);

  const loadCard = (cardId) => {
    const card = getCard(cardId);
    if (!card) throw new Error(`card ${cardId} not found`);
    return card;
  };

  // Template JSON from the DB (or an unsaved editor draft) plus the folders its relative
  // asset paths resolve against.
  const loadTemplate = (templateId, draft) => {
    const row = deps.getTemplate(templateId);
    if (!row) throw new Error(`template ${templateId} not found`);
    const template = templates.validateTemplateObject(draft !== undefined && draft !== null ? draft : JSON.parse(row.content));
    return {
      row,
      template,
      assetDirs: {
        templateDir: templates.templatesDir(userDataPath, row.project_id),
        projectDir: templates.projectDir(userDataPath, row.project_id),
      },
    };
  };

  const render = async (card, templateId, dpi, draft) => {
    const { row, template, assetDirs } = loadTemplate(templateId, draft);
    if (row.project_id !== card.project_id) throw new Error('card and template belong to different projects');
    const result = await renderCard(card, template, { dpi, ...assetDirs });
    return { ...result, template };
  };

  ipcMain.handle('getTemplates', (_, projectId) => deps.listTemplates(projectId).map(templateRowOut));

  ipcMain.handle('createTemplate', (_, projectId, name) => {
    const tpl = templates.blankTemplate(String(name || '').trim() || 'New Template');
    return templateRowOut(deps.insertTemplate(projectId, tpl.meta.name, JSON.stringify(tpl, null, 2)));
  });

  // template: object or JSON text. id omitted → insert; otherwise update (must be in projectId).
  ipcMain.handle('saveTemplate', (_, projectId, template, id) => {
    const obj = templates.validateTemplateObject(typeof template === 'string' ? JSON.parse(template) : template);
    const name = String(obj.meta.name || '').trim() || 'Untitled';
    const content = JSON.stringify(obj, null, 2);
    if (id === undefined || id === null) return templateRowOut(deps.insertTemplate(projectId, name, content));
    const existing = deps.getTemplate(id);
    if (!existing || existing.project_id !== projectId) throw new Error(`template ${id} not found in project ${projectId}`);
    return templateRowOut(deps.updateTemplate(id, name, content));
  });

  ipcMain.handle('deleteTemplate', (_, id) => deps.deleteTemplate(id));

  // options.draft: unsaved template object from the editor, rendered instead of the stored JSON.
  ipcMain.handle('renderCard', async (_, cardId, templateId, options = {}) => {
    const card = loadCard(cardId);
    const { canvas, width, height, warnings } = await render(card, templateId, dpiOf(options.dpi, 96), options.draft);
    return { dataUrl: `data:image/png;base64,${toPng(canvas).toString('base64')}`, width, height, warnings };
  });

  ipcMain.handle('exportCard', async (_, cardId, templateId, options = {}) => {
    const card = loadCard(cardId);
    const format = formatOf(options.format);
    const dpi = dpiOf(options.dpi, format === 'pdf' ? 300 : 96);
    let outPath = options.outputPath;
    if (!outPath) {
      const res = await dialog.showSaveDialog(getWindow(), {
        defaultPath: singleFileName(card, format, dpi),
        filters: [FORMATS[format].filter],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      outPath = res.filePath;
    }
    const { canvas, template, warnings } = await render(card, templateId, dpi, options.draft);
    await writeCardFile(canvas, template, format, dpi, outPath);
    return { path: outPath, warnings };
  });

  ipcMain.handle('exportAllCards', async (event, projectId, templateId, options = {}) => {
    const format = formatOf(options.format);
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

    const { row, template, assetDirs } = loadTemplate(templateId, options.draft);
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
        const { canvas, warnings } = await renderCard(card, template, { dpi, ...assetDirs });
        await writeCardFile(canvas, template, format, dpi, path.join(outputDir, batchFileName(card, format)));
        for (const w of warnings) errors.push(`card ${card.id} "${card.name}": warning: ${w}`);
        exported++;
      } catch (err) {
        errors.push(`card ${card.id} "${card.name}": ${err.message}`);
      }
      await yieldToEventLoop();
    }

    if (errors.length) {
      fs.writeFileSync(path.join(outputDir, 'render-errors.log'), errors.join('\n') + '\n', 'utf8');
    }
    return {
      exported,
      skipped: cards.length - exported,
      total: cards.length,
      errors,
      outputDir,
      elapsedMs: Date.now() - started,
    };
  });

  ipcMain.handle('showInFolder', (_, target) => {
    if (!target) return;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) return shell.openPath(target);
    shell.showItemInFolder(target);
  });
}

module.exports = { registerCardDesignerIpc, batchFileName, singleFileName };
