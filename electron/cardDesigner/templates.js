// Template JSON files on disk: {userData}/projects/{projectId}/templates/{id}.json
// Assets referenced by templates resolve relative to that templates folder
// (assets/…, assets/fonts/…). No database table until Phase 1.

const fs = require('fs');
const path = require('path');

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

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

function assertId(id) {
  if (!ID_RE.test(String(id))) throw new Error(`invalid template id "${id}"`);
  return String(id);
}

function templatesDir(userDataPath, projectId) {
  const pid = Number(projectId);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid project id "${projectId}"`);
  return path.join(userDataPath, 'projects', String(pid), 'templates');
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
        font: 'sans-serif', fontSize: 36, color: '#ffffff',
        align: 'left', valign: 'middle', overflow: 'shrink', zIndex: 10,
      },
    ],
  };
}

function readTemplate(dir, id) {
  const file = path.join(dir, `${assertId(id)}.json`);
  const raw = fs.readFileSync(file, 'utf8');
  return { id, dir, file, template: JSON.parse(raw), raw };
}

function listTemplates(userDataPath, projectId) {
  const dir = templatesDir(userDataPath, projectId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && ID_RE.test(f.slice(0, -5)))
    .sort()
    .map((f) => {
      const id = f.slice(0, -5);
      try {
        const { template, raw } = readTemplate(dir, id);
        return { id, name: (template.meta && template.meta.name) || id, content: raw, error: null };
      } catch (err) {
        const raw = fs.readFileSync(path.join(dir, f), 'utf8');
        return { id, name: id, content: raw, error: err.message };
      }
    });
}

// template may be an object or a JSON string. Returns the saved list entry.
function saveTemplate(userDataPath, projectId, template, id) {
  const obj = typeof template === 'string' ? JSON.parse(template) : template;
  if (!obj || typeof obj !== 'object' || !obj.meta) throw new Error('template must be an object with meta');
  const dir = templatesDir(userDataPath, projectId);
  const tid = assertId(id || slugify(obj.meta.name) || 'template');
  fs.mkdirSync(path.join(dir, 'assets', 'fonts'), { recursive: true });
  const content = JSON.stringify(obj, null, 2);
  fs.writeFileSync(path.join(dir, `${tid}.json`), content, 'utf8');
  return { id: tid, name: obj.meta.name || tid, content, error: null };
}

function deleteTemplate(userDataPath, projectId, id) {
  const file = path.join(templatesDir(userDataPath, projectId), `${assertId(id)}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = {
  slugify, templatesDir, blankTemplate, readTemplate, listTemplates, saveTemplate, deleteTemplate,
};
