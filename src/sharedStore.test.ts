import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SharedStore,
  createSharedStore,
  toApplicationGlobalStorage,
  collectProjectsFromEditorSettings,
  unionProjects,
  mergeStats,
  mergeRecents
} from './sharedStore';

test('profile-scoped globalStorage rewrites to application storage', () => {
  const profilePath = path.join(
    '/Users/me/Library/Application Support/Cursor/User',
    'profiles',
    'Work-abc',
    'globalStorage',
    'publisher.yawswith-vscode'
  );
  assert.equal(
    toApplicationGlobalStorage(profilePath),
    path.join(
      '/Users/me/Library/Application Support/Cursor/User',
      'globalStorage',
      'publisher.yawswith-vscode'
    )
  );
});

test('default-profile globalStorage is already shared', () => {
  const defaultPath = path.join(
    '/Users/me/Library/Application Support/Cursor/User',
    'globalStorage',
    'publisher.yawswith-vscode'
  );
  assert.equal(toApplicationGlobalStorage(defaultPath), defaultPath);
});

test('missing state starts empty', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yawswith-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new SharedStore(path.join(dir, 'state.json'));
  assert.deepEqual(store.load(), { version: 1, projects: [], stats: {}, recents: [] });
});

test('two profiles writing the same SharedStore can see each other', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yawswith-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');

  const profileA = new SharedStore(file);
  profileA.load();
  profileA.setProjects([{ name: 'frontend', path: '/a/frontend' }]);
  profileA.trackLaunch('/a/frontend');
  profileA.trackRecent('frontend', '/a/frontend');

  const profileB = new SharedStore(file);
  profileB.load();
  assert.equal(profileB.getProjects()[0].path, '/a/frontend');
  assert.equal(profileB.getStats()['/a/frontend'].count, 1);
  assert.equal(profileB.getRecents()[0].path, '/a/frontend');
});

test('opening a project in a stale window cannot restore pins removed by another window', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yawswith-stale-window-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = new SharedStore(path.join(dir, 'state.json'));
  first.setProjects([{ name: 'Removed', path: '/removed' }]);
  const other = new SharedStore(first.filePath);
  other.load();
  first.setProjects([]);
  other.trackLaunch('/removed');
  assert.deepEqual(first.load().projects, []);
  assert.equal(first.getStats()['/removed'].count, 1);
});

test('hydrateFromProfile preserves an existing shared file over stale profile data', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yawswith-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new SharedStore(path.join(dir, 'state.json'));
  store.load();
  store.setProjects([{ name: 'shared', path: '/shared' }]);
  store.hydrateFromProfile({
    projects: [
      { name: 'shared-renamed', path: '/shared' },
      { name: 'work', path: '/work' }
    ],
    stats: { '/work': { count: 3, last: 10 } },
    recents: [{ name: 'work', path: '/work' }]
  });

  const paths = store.getProjects().map(p => p.path);
  assert.deepEqual(paths, ['/shared']);
  assert.equal(store.getProjects()[0].name, 'shared');
  assert.deepEqual(store.getStats(), {});
});

test('unionProjects keeps first-seen metadata and appends new paths', () => {
  const merged = unionProjects(
    [{ name: 'A', path: '/a', icon: 'star' }],
    [{ name: 'A-new', path: '/a' }, { name: 'B', path: '/b' }]
  );
  assert.deepEqual(merged, [
    { name: 'A', path: '/a', icon: 'star' },
    { name: 'B', path: '/b' }
  ]);
});

test('mergeStats keeps the higher count and later timestamp', () => {
  assert.deepEqual(
    mergeStats({ '/a': { count: 2, last: 5 } }, { '/a': { count: 4, last: 3 }, '/b': { count: 1, last: 9 } }),
    { '/a': { count: 4, last: 5 }, '/b': { count: 1, last: 9 } }
  );
});

test('collectProjectsFromEditorSettings unions default + named profile leftovers', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yawswith-user-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userDir = path.join(root, 'User');
  const extId = 'publisher.yawswith-vscode';
  const profileStorage = path.join(userDir, 'profiles', 'Work-abc', 'globalStorage', extId);
  fs.mkdirSync(path.join(userDir, 'profiles', 'Work-abc'), { recursive: true });
  fs.writeFileSync(
    path.join(userDir, 'settings.json'),
    JSON.stringify({ 'projectTabs.projects': [{ name: 'default', path: '/default' }] })
  );
  fs.writeFileSync(
    path.join(userDir, 'profiles', 'Work-abc', 'settings.json'),
    JSON.stringify({ 'projectTabs.projects': [{ name: 'work', path: '/work' }] })
  );

  const merged = collectProjectsFromEditorSettings(profileStorage);
  assert.deepEqual(merged.map(p => p.path), ['/default', '/work']);
});

test('mergeRecents de-duplicates and caps at 5', () => {
  const first = [{ name: '1', path: '/1' }, { name: '2', path: '/2' }];
  const extra = [
    { name: '1-dup', path: '/1' },
    { name: '3', path: '/3' },
    { name: '4', path: '/4' },
    { name: '5', path: '/5' },
    { name: '6', path: '/6' }
  ];
  const merged = mergeRecents(first, extra);
  assert.equal(merged.length, 5);
  assert.deepEqual(merged.map(p => p.path), ['/1', '/2', '/3', '/4', '/5']);
});

test('renamed extension migrates SnapSwitch data once across profiles without reviving deletions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yawswith-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userDir = path.join(root, 'User');
  const legacy = new SharedStore(path.join(userDir, 'globalStorage', 'jyashsakariyajain.snapswitch-vscode', 'state.json'));
  legacy.setProjects([{ name: 'Existing', path: '/existing', group: 'Work' }]);
  legacy.trackLaunch('/existing');
  legacy.trackRecent('Existing', '/existing');
  const original = fs.readFileSync(legacy.filePath, 'utf8');
  const migrated = createSharedStore({ globalStorageUri: {
    fsPath: path.join(userDir, 'profiles', 'work', 'globalStorage', 'www159-used.yawswith')
  } });
  assert.deepEqual(migrated.getProjects(), legacy.getProjects());
  assert.deepEqual(migrated.getStats(), legacy.getStats());
  assert.deepEqual(migrated.getRecents(), legacy.getRecents());
  assert.equal(fs.readFileSync(legacy.filePath, 'utf8'), original, 'migration must not change old storage');
  migrated.setProjects([]);
  const reopened = createSharedStore({ globalStorageUri: {
    fsPath: path.join(userDir, 'globalStorage', 'www159-used.yawswith')
  } });
  assert.deepEqual(reopened.getProjects(), []);
  assert.deepEqual(reopened.getStats(), legacy.getStats());
});
