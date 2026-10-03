// The fit cache (spec data model: fit_cache: card_id, template_version, data_hash, results_json):
// each card's fit results, measured in the app window by the background fit check
// (src/components/Fit/FitRunner.jsx). data_hash covers everything the results depend on
// (src/designer/fit/inputs.ts), so the renderer uses a row only while its hash still matches.
// Computed data: rebuilt when missing, and not part of project exports.

const MAX_ROWS_PER_SAVE = 5000;
const MAX_RESULTS_CHARS = 100000;

function parseResults(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function createFitCache({ queryAll, exec, inTransaction }) {
  return {
    /** Rows for the project's existing cards: [{ cardId, templateId, templateVersion, hash, results, computedAt }] */
    list(projectId) {
      return queryAll(
        `SELECT f.* FROM fit_cache f JOIN cards c ON c.id = f.card_id
         WHERE f.project_id = ? AND c.project_id = ?`,
        [projectId, projectId],
      ).map((r) => ({
        cardId: r.card_id, templateId: r.template_id, templateVersion: r.template_version,
        hash: r.data_hash, results: parseResults(r.results_json), computedAt: r.computed_at,
      }));
    },

    /**
     * rows: [{ cardId, templateId, templateVersion, hash, results }], one transaction. Rows for
     * cards that aren't in the project (deleted while a check ran) are skipped, not an error.
     */
    save(projectId, rows) {
      if (!Array.isArray(rows)) throw new Error('fit results must be a list');
      if (rows.length > MAX_ROWS_PER_SAVE) throw new Error(`at most ${MAX_ROWS_PER_SAVE} fit results at a time`);
      const known = new Set(queryAll('SELECT id FROM cards WHERE project_id = ?', [projectId]).map((r) => r.id));
      const clean = [];
      for (const row of rows) {
        const cardId = Number(row && row.cardId);
        if (!Number.isInteger(cardId) || !known.has(cardId)) continue;
        if (typeof row.hash !== 'string' || !row.hash || row.hash.length > 128) throw new Error('fit results need a hash');
        const results = row.results && typeof row.results === 'object' && !Array.isArray(row.results) ? row.results : {};
        const json = JSON.stringify(results);
        if (json.length > MAX_RESULTS_CHARS) throw new Error('fit results are too large');
        const intOrNull = (v) => (Number.isInteger(Number(v)) && v !== null && v !== '' ? Number(v) : null);
        clean.push([cardId, projectId, intOrNull(row.templateId), intOrNull(row.templateVersion), row.hash, json]);
      }
      if (clean.length) {
        inTransaction(() => {
          for (const values of clean) {
            exec(`INSERT OR REPLACE INTO fit_cache (card_id, project_id, template_id, template_version, data_hash, results_json, computed_at)
                  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`, values);
          }
        });
      }
      return { saved: clean.length, skipped: rows.length - clean.length };
    },

    /** Forget every result of the project ("Re-check all"). */
    clear(projectId) {
      inTransaction(() => exec('DELETE FROM fit_cache WHERE project_id = ?', [projectId]));
    },
  };
}

function registerFitCacheIpc(ipcMain, cache) {
  ipcMain.handle('getFitCache', (_, projectId) => cache.list(projectId));
  ipcMain.handle('saveFitResults', (_, projectId, rows) => cache.save(projectId, rows));
  ipcMain.handle('clearFitCache', (_, projectId) => cache.clear(projectId));
}

module.exports = { createFitCache, registerFitCacheIpc };
