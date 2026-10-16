const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SharedStore,
  toApplicationGlobalStorage,
  collectProjectsFromEditorSettings,
  unionProjects,
  mergeStats,
  mergeRecents
} = require('./sharedStore');

test('profile-scoped globalStorage rewrites to application storage', () => {
  const profilePath = path.join(
    '/Users/me/Library/Application Support/Cursor/User',
    'profiles',
    'Work-abc',
    'globalStorage',
    'publisher.snapswitch-vscode'
  );
  assert.equal(
    toApplicationGlobalStorage(profilePath),
    path.join(
      '/Users/me/Library/Application Support/Cursor/User',
      'globalStorage',
      'publisher.snapswitch-vscode'
    )
  );
});

test('default-profile globalStorage is already shared', () => {
  const defaultPath = path.join(
    '/Users/me/Library/Application Support/Cursor/User',
    'globalStorage',
    'publisher.snapswitch-vscode'
  );
  assert.equal(toApplicationGlobalStorage(defaultPath), defaultPath);
});

test('isolated profile maps cannot see each other (current bug)', () => {
  const profileA = {};
  const profileB = {};
  profileA.projects = [{ name: 'frontend', path: '/a/frontend' }];
  assert.deepEqual(profileB.projects || [], []);
});

test('two profiles writing the same SharedStore can see each other', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapswitch-'));
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

test('hydrateFromProfile unions leftovers without dropping shared items', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapswitch-'));
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
  assert.deepEqual(paths, ['/shared', '/work']);
  assert.equal(store.getProjects()[0].name, 'shared');
  assert.equal(store.getStats()['/work'].count, 3);
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

test('collectProjectsFromEditorSettings unions default + named profile leftovers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapswitch-user-'));
  const userDir = path.join(root, 'User');
  const extId = 'publisher.snapswitch-vscode';
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
