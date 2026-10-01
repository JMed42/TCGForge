// One-time carry-over of data from the app's previous name (TCG Studio).
// Copies, never moves: the old folder is left untouched so a rollback still works.

const fs = require('fs');
const path = require('path');

const DB_FILE = 'tcgforge.db';
const LEGACY_DB_FILE = 'tcg-studio.db';
// Dev builds used package.json "name", packaged builds used build.productName.
const LEGACY_DIRS = ['tcg-studio', 'TCG Studio'];

/**
 * If userDataPath has no database yet, copy the newest legacy database (and its
 * projects/ folder, if any) from a sibling folder under appDataPath.
 * @returns {{ migrated: boolean, from?: string }}
 */
function migrateLegacyData(appDataPath, userDataPath) {
  const target = path.join(userDataPath, DB_FILE);
  if (fs.existsSync(target)) return { migrated: false };

  const candidates = LEGACY_DIRS
    .map((dir) => path.join(appDataPath, dir))
    .filter((dir) => path.resolve(dir) !== path.resolve(userDataPath))
    .filter((dir) => fs.existsSync(path.join(dir, LEGACY_DB_FILE)))
    .sort((a, b) => fs.statSync(path.join(b, LEGACY_DB_FILE)).mtimeMs - fs.statSync(path.join(a, LEGACY_DB_FILE)).mtimeMs);
  if (candidates.length === 0) return { migrated: false };

  const from = candidates[0];
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.copyFileSync(path.join(from, LEGACY_DB_FILE), target, fs.constants.COPYFILE_EXCL);
  const legacyProjects = path.join(from, 'projects');
  const projects = path.join(userDataPath, 'projects');
  if (fs.existsSync(legacyProjects) && !fs.existsSync(projects)) {
    fs.cpSync(legacyProjects, projects, { recursive: true, errorOnExist: true });
  }
  return { migrated: true, from };
}

module.exports = { DB_FILE, migrateLegacyData };
