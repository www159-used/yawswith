import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Project, ProjectStats, RecentProject, SharedState } from './model';
import { isRecord, readProjects } from './model';

interface StorageContext { globalStorageUri?: { fsPath: string } }

const STATE_FILE = 'state.json';
const RECENT_LIMIT = 5;

export function emptyState(): SharedState {
  return { version: 1, projects: [], stats: {}, recents: [] };
}

/**
 * Profile-scoped globalStorage looks like:
 *   .../User/profiles/<id>/globalStorage/<extId>
 * Application-wide storage (shared by every profile of this editor) is:
 *   .../User/globalStorage/<extId>
 */
export function toApplicationGlobalStorage(fsPath?: string) {
  if (!fsPath) return null;
  const marker = `${path.sep}profiles${path.sep}`;
  const idx = fsPath.indexOf(marker);
  if (idx === -1) return fsPath;
  const userDir = fsPath.slice(0, idx);
  return path.join(userDir, 'globalStorage', path.basename(fsPath));
}

export function resolveSharedDir(context?: StorageContext) {
  const fromContext = toApplicationGlobalStorage(context?.globalStorageUri?.fsPath);
  if (fromContext) return fromContext;
  return path.join(os.homedir(), '.yawswith');
}

function findUserDir(globalStorageFsPath?: string) {
  const appStorage = toApplicationGlobalStorage(globalStorageFsPath);
  if (!appStorage) return null;
  return path.dirname(path.dirname(appStorage));
}

function readProjectsFromSettingsFile(filePath: string): Project[] {
  try {
    const json: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isRecord(json) ? readProjects(json['projectTabs.projects']) : [];
  } catch (e) {
    return [];
  }
}

/**
 * After a setting becomes application-scoped, VS Code ignores leftovers in
 * named-profile settings.json. Read those files directly so the first
 * migration can still recover pinned projects.
 */
export function collectProjectsFromEditorSettings(globalStorageFsPath?: string): Project[] {
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
  let all: Project[] = [];
  for (const file of files) {
    all = unionProjects(all, readProjectsFromSettingsFile(file));
  }
  return all;
}

export function unionProjects(base: Project[] = [], extra: Project[] = []): Project[] {
  const byPath = new Map<string, Project>();
  for (const list of [base, extra]) {
    for (const p of list || []) {
      if (p && p.path && !byPath.has(p.path)) byPath.set(p.path, p);
    }
  }
  return [...byPath.values()];
}

export function mergeStats(a: ProjectStats = {}, b: ProjectStats = {}): ProjectStats {
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

export function mergeRecents(a: RecentProject[] = [], b: RecentProject[] = []): RecentProject[] {
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

function readState(filePath: string): SharedState {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyState();
    const stats: ProjectStats = {};
    if (isRecord(parsed.stats)) {
      for (const [key, value] of Object.entries(parsed.stats)) {
        if (isRecord(value) && typeof value.count === 'number' && typeof value.last === 'number') {
          stats[key] = { count: value.count, last: value.last };
        }
      }
    }
    return {
      version: 1,
      projects: readProjects(parsed.projects),
      stats,
      recents: readProjects(parsed.recents)
    };
  } catch (e) {
    return emptyState();
  }
}

function writeState(filePath: string, data: SharedState) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

export class SharedStore {
  private data: SharedState;

  constructor(readonly filePath: string) {
    this.data = emptyState();
  }

  load() {
    this.data = readState(this.filePath);
    return this.data;
  }

  private save() {
    writeState(this.filePath, this.data);
  }

  getProjects() {
    return this.data.projects;
  }

  setProjects(projects: Project[]) {
    this.data.projects = Array.isArray(projects) ? projects : [];
    this.save();
  }

  getStats() {
    return this.data.stats;
  }

  getRecents() {
    return this.data.recents;
  }

  trackLaunch(projectPath: string) {
    if (!projectPath) return;
    if (!this.data.stats[projectPath]) this.data.stats[projectPath] = { count: 0, last: 0 };
    this.data.stats[projectPath].count++;
    this.data.stats[projectPath].last = Date.now();
    this.save();
  }

  trackRecent(name: string, projectPath: string) {
    if (!projectPath) return;
    this.data.recents = mergeRecents([{ name, path: projectPath }], this.data.recents);
    this.save();
  }

  /**
   * One-time union of profile-local leftovers into the shared file.
   * After this, the file is the source of truth.
   */
  hydrateFromProfile({ projects, stats, recents }: Partial<SharedState> = {}) {
    this.data.projects = unionProjects(this.data.projects, projects);
    this.data.stats = mergeStats(this.data.stats, stats);
    this.data.recents = mergeRecents(this.data.recents, recents);
    this.save();
    return this.data;
  }

  watch(onChange: (state: SharedState) => void) {
    let timer: ReturnType<typeof setTimeout> | undefined;
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

export function createSharedStore(context?: StorageContext) {
  const dir = resolveSharedDir(context);
  const store = new SharedStore(path.join(dir, STATE_FILE));
  store.load();
  // The publisher/name change gives Yawswith a new storage directory. Copy the
  // old file once; an existing Yawswith file (even an empty one) is authoritative.
  if (!fs.existsSync(store.filePath)) {
    const legacyDir = context?.globalStorageUri?.fsPath
      ? path.join(path.dirname(dir), 'jyashsakariyajain.snapswitch-vscode')
      : path.join(os.homedir(), '.snapswitch');
    const legacyFile = path.join(legacyDir, STATE_FILE);
    if (fs.existsSync(legacyFile)) store.hydrateFromProfile(readState(legacyFile));
  }
  return store;
}
