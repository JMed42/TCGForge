// Template helpers. Template JSON (schema v1) lives in the `templates` table
// (electron/database.js); files live on disk under {userData}/projects/{projectId}/:
//   assets/{art,frames,icons,fonts}/   current asset folders (served by tcg-asset://)
//   templates/assets/…                 Phase 0 template assets (still resolved)
// plus reading Phase 0 template files for the one-time import (migration v2).

const fs = require('fs');
const path = require('path');

const FILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
}

function projectDir(userDataPath, projectId) {
  const pid = Number(projectId);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid project id "${projectId}"`);
  return path.join(userDataPath, 'projects', String(pid));
}

// Asset root for a project's templates (relative asset paths in template JSON resolve here).
function templatesDir(userDataPath, projectId) {
  return path.join(projectDir(userDataPath, projectId), 'templates');
}

// A new template in schema v1 (docs/card-designer-spec.md): poker size, 3 mm bleed and safe zone,
// a full-bleed background and a name line.
function blankTemplate(name) {
  return {
    schemaVersion: 1,
    name: name || 'New Template',
    size: { widthMm: 63, heightMm: 88, bleedMm: 3, safeMm: 3, cornerRadiusMm: 3 },
    layers: [
      { id: 'background', type: 'shape', shape: 'rect', frame: { left: -3, right: -3, top: -3, bottom: -3 }, fill: '#1a1a2e', locked: true },
      {
        id: 'name', type: 'text', frame: { left: 5, right: 5, top: 5, height: 7 }, text: '{{name}}',
        style: { font: 'Segoe UI', sizePt: 12, weight: 600, color: '#ffffff', valign: 'middle' },
        fit: { minPt: 7, strategy: ['shrink'] },
      },
    ],
  };
}

const MAX_SIZE_MM = 500;

// Structural check for schema v1 in the main process. The full zod schema
// (src/designer/schema/schema.ts) runs in the renderer before anything is saved or imported;
// this guards the main process against malformed input. Data only, never executed.
function validateTemplateObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('template must be a JSON object');
  if (obj.schemaVersion !== 1) throw new Error('template.schemaVersion must be 1');
  const size = obj.size;
  if (!size || typeof size !== 'object') throw new Error('template.size is required');
  for (const key of ['widthMm', 'heightMm']) {
    const n = Number(size[key]);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_SIZE_MM) throw new Error(`template.size.${key} must be between 0 and ${MAX_SIZE_MM} mm`);
  }
  for (const key of ['bleedMm', 'safeMm']) {
    const n = Number(size[key] ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`template.size.${key} must be between 0 and 100 mm`);
  }
  if (!Array.isArray(obj.layers)) throw new Error('template.layers must be an array');
  return obj;
}

// Phase 0 (pixel) template check, used only when importing Phase 0 files (migration v2).
function validateLegacyTemplate(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('template must be a JSON object');
  const meta = obj.meta;
  if (!meta || typeof meta !== 'object') throw new Error('template.meta is required');
  for (const key of ['width', 'height', 'dpi']) {
    const n = Number(meta[key]);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`template.meta.${key} must be a positive number`);
  }
  if (obj.layers !== undefined && !Array.isArray(obj.layers)) throw new Error('template.layers must be an array');
  return obj;
}

// Phase 0 template files, for the migration import.
function listTemplateFiles(userDataPath, projectId) {
  const dir = templatesDir(userDataPath, projectId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && FILE_ID_RE.test(f.slice(0, -5)))
    .sort()
    .map((f) => {
      const id = f.slice(0, -5);
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      try {
        const template = validateLegacyTemplate(JSON.parse(content));
        return { id, name: (template.meta && template.meta.name) || id, content, error: null };
      } catch (err) {
        return { id, name: id, content, error: err.message };
      }
    });
}

module.exports = {
  slugify, projectDir, templatesDir, blankTemplate, validateTemplateObject, validateLegacyTemplate, listTemplateFiles,
};
