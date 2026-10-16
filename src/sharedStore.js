const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_FILE = 'state.json';
const RECENT_LIMIT = 5;

function emptyState() {
  return { version: 1, projects: [], stats: {}, recents: [] };
}

/**
 * Profile-scoped globalStorage looks like:
 *   .../User/profiles/<id>/globalStorage/<extId>
 * Application-wide storage (shared by every profile of this editor) is:
 *   .../User/globalStorage/<extId>
 */
function toApplicationGlobalStorage(fsPath) {
  if (!fsPath) return null;
  const marker = `${path.sep}profiles${path.sep}`;
  const idx = fsPath.indexOf(marker);
  if (idx === -1) return fsPath;
  const userDir = fsPath.slice(0, idx);
  return path.join(userDir, 'globalStorage', path.basename(fsPath));
}

function resolveSharedDir(context) {
  const fromContext = toApplicationGlobalStorage(context?.globalStorageUri?.fsPath);
  if (fromContext) return fromContext;
  return path.join(os.homedir(), '.snapswitch');
}

function findUserDir(globalStorageFsPath) {
  const appStorage = toApplicationGlobalStorage(globalStorageFsPath);
  if (!appStorage) return null;
  return path.dirname(path.dirname(appStorage));
}

function readProjectsFromSettingsFile(filePath) {
  try {
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(json['projectTabs.projects']) ? json['projectTabs.projects'] : [];
  } catch (e) {
    return [];
  }
}

/**
 * After a setting becomes application-scoped, VS Code ignores leftovers in
 * named-profile settings.json. Read those files directly so the first
 * migration can still recover pinned projects.
 */
function collectProjectsFromEditorSettings(globalStorageFsPath) {
  const userDir = findUserDir(globalStorageFsPath);
  if (!userDir) return [];
  const files = [path.join(userDir, 'settings.json')];
  const profilesDir = path.join(userDir, 'profiles');
  try {
    for (const name of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      if (name.isDirectory()) {
        files.push(path.join(profilesDir, name.name, 'settings.json'));
      }
    }
  } catch (e) {
    // no profiles directory
  }
  let all = [];
  for (const file of files) {
    all = unionProjects(all, readProjectsFromSettingsFile(file));
  }
  return all;
}

function unionProjects(base, extra) {
  const byPath = new Map();
  for (const list of [base, extra]) {
    for (const p of list || []) {
      if (p && p.path && !byPath.has(p.path)) byPath.set(p.path, p);
    }
  }
  return [...byPath.values()];
}

function mergeStats(a, b) {
  const out = { ...(a || {}) };
  for (const [key, value] of Object.entries(b || {})) {
    if (!value) continue;
    const prev = out[key];
    if (!prev) {
      out[key] = { count: value.count || 0, last: value.last || 0 };
      continue;
    }
    out[key] = {
      count: Math.max(prev.count || 0, value.count || 0),
      last: Math.max(prev.last || 0, value.last || 0)
    };
  }
  return out;
}

function mergeRecents(a, b) {
  const seen = new Set();
  const out = [];
  for (const item of [...(a || []), ...(b || [])]) {
    if (!item?.path || seen.has(item.path)) continue;
    seen.add(item.path);
    out.push({ name: item.name, path: item.path });
    if (out.length >= RECENT_LIMIT) break;
  }
  return out;
}

function readState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyState();
    return {
      version: 1,
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      stats: parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {},
      recents: Array.isArray(parsed.recents) ? parsed.recents : []
    };
  } catch (e) {
    return emptyState();
  }
}

function writeState(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

class SharedStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = emptyState();
  }

  load() {
    this.data = readState(this.filePath);
    return this.data;
  }

  save() {
    writeState(this.filePath, this.data);
  }

  getProjects() {
    return this.data.projects;
  }

  setProjects(projects) {
    this.data.projects = Array.isArray(projects) ? projects : [];
    this.save();
  }

  getStats() {
    return this.data.stats;
  }

  getRecents() {
    return this.data.recents;
  }

  trackLaunch(projectPath) {
    if (!projectPath) return;
    if (!this.data.stats[projectPath]) this.data.stats[projectPath] = { count: 0, last: 0 };
    this.data.stats[projectPath].count++;
    this.data.stats[projectPath].last = Date.now();
    this.save();
  }

  trackRecent(name, projectPath) {
    if (!projectPath) return;
    this.data.recents = mergeRecents([{ name, path: projectPath }], this.data.recents);
    this.save();
  }

  /**
   * One-time union of profile-local leftovers into the shared file.
   * After this, the file is the source of truth.
   */
  hydrateFromProfile({ projects, stats, recents } = {}) {
    this.data.projects = unionProjects(this.data.projects, projects);
    this.data.stats = mergeStats(this.data.stats, stats);
    this.data.recents = mergeRecents(this.data.recents, recents);
    this.save();
    return this.data;
  }

  watch(onChange) {
    let timer = null;
    const fire = () => {
      const next = readState(this.filePath);
      if (JSON.stringify(next) === JSON.stringify(this.data)) return;
      this.data = next;
      onChange(this.data);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(fire, 80);
    };

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const watcher = fs.watch(path.dirname(this.filePath), (event, filename) => {
        if (!filename || filename === STATE_FILE || filename === path.basename(this.filePath)) {
          schedule();
        }
      });
      return {
        dispose() {
          clearTimeout(timer);
          watcher.close();
        }
      };
    } catch (e) {
      return { dispose() {} };
    }
  }
}

function createSharedStore(context) {
  const dir = resolveSharedDir(context);
  const store = new SharedStore(path.join(dir, STATE_FILE));
  store.load();
  return store;
}

module.exports = {
  SharedStore,
  createSharedStore,
  toApplicationGlobalStorage,
  resolveSharedDir,
  collectProjectsFromEditorSettings,
  unionProjects,
  mergeStats,
  mergeRecents,
  emptyState
};
