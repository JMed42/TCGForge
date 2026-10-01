// Template helpers. Template JSON lives in the `templates` table (electron/database.js);
// this module covers what stays on disk:
//   {userData}/projects/{projectId}/templates/   asset root: assets/…, assets/fonts/…
//   {userData}/projects/{projectId}/art/         card art copied in by the card editor
// plus reading Phase 0 template files for the one-time import (migration v2).

const fs = require('fs');
const path = require('path');

const FILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_TEMPLATE_PX = 8000;

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
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

function blankTemplate(name) {
  return {
    meta: { name: name || 'New Template', version: '1', width: 744, height: 1039, dpi: 300 },
    cornerRadius: 24,
    background: { color: '#1a1a2e' },
    layers: [
      {
        id: 'card-name', type: 'text', value: '{{name}}',
        x: 40, y: 40, width: 664, height: 60,
        font: 'Segoe UI Semibold', fontSize: 36, color: '#ffffff',
        align: 'left', valign: 'middle', overflow: 'shrink', zIndex: 10,
      },
    ],
  };
}

// Structural check for template JSON coming from the editor or the DB. Data only — nothing
// in a template is ever executed.
function validateTemplateObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('template must be a JSON object');
  const meta = obj.meta;
  if (!meta || typeof meta !== 'object') throw new Error('template.meta is required');
  for (const key of ['width', 'height', 'dpi']) {
    const n = Number(meta[key]);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`template.meta.${key} must be a positive number`);
  }
  if (Number(meta.width) > MAX_TEMPLATE_PX || Number(meta.height) > MAX_TEMPLATE_PX) {
    throw new Error(`template size is limited to ${MAX_TEMPLATE_PX}×${MAX_TEMPLATE_PX} px`);
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
        const template = validateTemplateObject(JSON.parse(content));
        return { id, name: (template.meta && template.meta.name) || id, content, error: null };
      } catch (err) {
        return { id, name: id, content, error: err.message };
      }
    });
}

module.exports = {
  slugify, projectDir, templatesDir, blankTemplate, validateTemplateObject, listTemplateFiles, MAX_TEMPLATE_PX,
};
