// Dev helper: seed a throwaway userData folder with a project, sample cards and the Phase 0
// fixture templates, so the Designer can be exercised without touching real data.
//   node scripts/card-designer-seed.cjs <userDataDir>
//   electron . --user-data-dir=<userDataDir>

const fs = require('fs');
const path = require('path');
const { initDatabase, registerIpcHandlers } = require('../electron/database');
const templates = require('../electron/cardDesigner/templates');
const { generateAssets } = require('../electron/cardDesigner/fixtures/generateAssets');
const { sampleCards } = require('../electron/cardDesigner/fixtures/sampleCards');

async function main() {
  const userData = path.resolve(process.argv[2] || '');
  if (!process.argv[2]) throw new Error('usage: node scripts/card-designer-seed.cjs <userDataDir>');
  if (fs.existsSync(path.join(userData, 'tcg-studio.db'))) {
    throw new Error(`${userData} already has a tcg-studio.db — refusing to seed over it`);
  }
  fs.mkdirSync(userData, { recursive: true });
  await initDatabase(userData);

  const handlers = {};
  registerIpcHandlers({ handle: (name, fn) => { handlers[name] = fn; } });
  const call = (name, ...args) => handlers[name](null, ...args);

  const project = call('createProject', { name: 'Designer Spike', description: 'Card Designer Phase 0 test data' });
  const dir = templates.templatesDir(userData, project.id);
  const art = generateAssets(dir);
  const sysFont = 'C:\\Windows\\Fonts\\segoeprb.ttf';
  if (fs.existsSync(sysFont)) fs.copyFileSync(sysFont, path.join(dir, 'assets', 'fonts', 'Scribe-Bold.ttf'));

  for (const card of sampleCards(art)) call('createCard', project.id, card);
  for (const [id, file] of [['standard', 'standard.json'], ['fit-matrix', 'fit-matrix.json']]) {
    const tpl = JSON.parse(fs.readFileSync(path.join(__dirname, '../electron/cardDesigner/fixtures', file), 'utf8'));
    templates.saveTemplate(userData, project.id, tpl, id);
  }
  console.log(JSON.stringify({ userData, projectId: project.id, templatesDir: dir }));
}

main().catch((err) => { console.error(err.message); process.exit(1); });
