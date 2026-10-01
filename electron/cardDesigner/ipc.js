// IPC channels for the Card Designer (spec §P0.5).
// Templates are addressed by file id; the project comes from the card (or is passed explicitly).

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

function formatOf(value) {
  const key = value === 'jpg' ? 'jpeg' : String(value || 'png');
  if (!FORMATS[key]) throw new Error(`unsupported format "${value}"`);
  return key;
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

/**
 * @param ipcMain
 * @param deps { userDataPath, getCard(id), queryCards(projectId, filters), dialog, shell, getWindow() }
 */
function registerCardDesignerIpc(ipcMain, deps) {
  const { userDataPath, getCard, queryCards, dialog, shell, getWindow } = deps;
  setImmediate(warmUp);

  const loadCard = (cardId) => {
    const card = getCard(cardId);
    if (!card) throw new Error(`card ${cardId} not found`);
    return card;
  };

  const loadTemplate = (projectId, templateId) =>
    templates.readTemplate(templates.templatesDir(userDataPath, projectId), templateId);

  const render = async (card, templateId, dpi) => {
    const { template, dir } = loadTemplate(card.project_id, templateId);
    const result = await renderCard(card, template, { dpi, templateDir: dir });
    return { ...result, template };
  };

  ipcMain.handle('getTemplates', (_, projectId) => templates.listTemplates(userDataPath, projectId));

  ipcMain.handle('createTemplate', (_, projectId, name) =>
    templates.saveTemplate(userDataPath, projectId, templates.blankTemplate(name), templates.slugify(name) || undefined));

  ipcMain.handle('saveTemplate', (_, projectId, template, id) =>
    templates.saveTemplate(userDataPath, projectId, template, id));

  ipcMain.handle('deleteTemplate', (_, projectId, id) => templates.deleteTemplate(userDataPath, projectId, id));

  ipcMain.handle('renderCard', async (_, cardId, templateId, options = {}) => {
    const card = loadCard(cardId);
    const { canvas, width, height, warnings } = await render(card, templateId, options.dpi || 96);
    return { dataUrl: `data:image/png;base64,${toPng(canvas).toString('base64')}`, width, height, warnings };
  });

  ipcMain.handle('exportCard', async (_, cardId, templateId, options = {}) => {
    const card = loadCard(cardId);
    const format = formatOf(options.format);
    const dpi = Number(options.dpi) || (format === 'pdf' ? 300 : 96);
    let outPath = options.outputPath;
    if (!outPath) {
      const res = await dialog.showSaveDialog(getWindow(), {
        defaultPath: singleFileName(card, format, dpi),
        filters: [FORMATS[format].filter],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      outPath = res.filePath;
    }
    const { canvas, template, warnings } = await render(card, templateId, dpi);
    await writeCardFile(canvas, template, format, dpi, outPath);
    return { path: outPath, warnings };
  });

  ipcMain.handle('exportAllCards', async (event, projectId, templateId, options = {}) => {
    const format = formatOf(options.format);
    const dpi = Number(options.dpi) || 300;
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

    const { template, dir } = loadTemplate(projectId, templateId);
    const cards = queryCards(projectId, options.filter || {});
    const errors = [];
    let exported = 0;
    const started = Date.now();
    const sender = event.sender;

    // Sequential in the spike; the spec's worker pool comes later if timing needs it.
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!sender.isDestroyed()) sender.send('exportProgress', { current: i + 1, total: cards.length });
      try {
        const { canvas, warnings } = await renderCard(card, template, { dpi, templateDir: dir });
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
