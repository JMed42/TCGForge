// Dev helper: seed a throwaway userData folder with a project, sample cards, generated art and
// the fixture templates (converted to schema v1), so the Designer can be exercised without
// touching real data.
//   node scripts/card-designer-seed.cjs <userDataDir>
//   electron . --user-data-dir=<userDataDir>

const fs = require('fs');
const path = require('path');
const { initDatabase, registerIpcHandlers, insertTemplate } = require('../electron/database');
const { DB_FILE } = require('../electron/legacyData');
const templates = require('../electron/cardDesigner/templates');
const { convertLegacyTemplate } = require('../electron/cardDesigner/convertLegacyTemplate');
const { generateAssets } = require('../electron/cardDesigner/fixtures/generateAssets');
const { sampleCards } = require('../electron/cardDesigner/fixtures/sampleCards');

async function main() {
  const userData = path.resolve(process.argv[2] || '');
  if (!process.argv[2]) throw new Error('usage: node scripts/card-designer-seed.cjs <userDataDir>');
  if (fs.existsSync(path.join(userData, DB_FILE))) {
    throw new Error(`${userData} already has a ${DB_FILE} — refusing to seed over it`);
  }
  fs.mkdirSync(userData, { recursive: true });
  await initDatabase(userData);

  const handlers = {};
  registerIpcHandlers({ handle: (name, fn) => { handlers[name] = fn; } });
  const call = (name, ...args) => handlers[name](null, ...args);

  const project = call('createProject', { name: 'Designer Spike', description: 'Card Designer test data' });

  // Assets live in {project}/assets (spec layout); cards store art as project-relative paths.
  const dir = templates.projectDir(userData, project.id);
  const abs = generateAssets(dir, path.join(dir, 'assets', 'art'));
  const rel = (file) => path.relative(dir, file).split(path.sep).join('/');
  const art = { ember: rel(abs.ember), tide: rel(abs.tide) };
  const sysFont = 'C:\\Windows\\Fonts\\segoeprb.ttf';
  if (fs.existsSync(sysFont)) fs.copyFileSync(sysFont, path.join(dir, 'assets', 'fonts', 'Scribe-Bold.ttf'));

  for (const card of sampleCards(art)) call('createCard', project.id, card);

  // The fixtures are Phase 0 pixel templates: convert them the way migration v3 does.
  for (const file of ['standard.json', 'fit-matrix.json']) {
    const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, '../electron/cardDesigner/fixtures', file), 'utf8'));
    const { template } = convertLegacyTemplate(legacy);
    insertTemplate(project.id, template.name, JSON.stringify(template, null, 2));
  }
  console.log(JSON.stringify({ userData, projectId: project.id, projectDir: dir }));
}

main().catch((err) => { console.error(err.message); process.exit(1); });
