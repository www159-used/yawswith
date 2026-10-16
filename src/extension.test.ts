import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEditor } from './testSupport/editor';
import { SharedStore } from './sharedStore';
import { createBrowser } from './testSupport/browser';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('activation migrates legacy data, registers commands, and keeps all views in sync', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'yawswith-extension-'));
  const editor = createEditor(dir, [{ name: 'Legacy', path: '/legacy', group: 'Work' }]);
  t.after(() => { editor.dispose(); rmSync(dir, { recursive: true, force: true }); });
  editor.state.set('yawswith.projectStats', { '/legacy': { count: 4, last: 20 } });
  editor.state.set('yawswith.recentProjects', [{ name: 'Legacy', path: '/legacy' }]);
  await editor.activate();
  editor.resolveSidebar();
  editor.sendMessage({ command: 'ready' });
  const manifest = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
  for (const command of manifest.contributes.commands) assert.ok(editor.commands.has(command.command));
  assert.equal(editor.posted.slice(-1)[0].projects[0].name, 'Legacy');
  const shell = editor.webview.html;
  const stored = new SharedStore(join(dir, 'state.json'));
  stored.load();
  assert.equal(stored.getStats()['/legacy'].count, 4);
  assert.equal(stored.getRecents()[0].path, '/legacy');

  editor.inputs.push('New Project');
  await editor.commands.get('yawswith.addProject')?.();
  assert.equal(editor.posted.slice(-1)[0].projects[1].name, 'New Project');
  assert.equal(editor.webview.html, shell, 'updates must not replace the HTML document');
  assert.ok([...editor.statuses].some(item => item.text.includes('New Project')));
  assert.deepEqual(editor.trees.get('yawswith.projectsTree')?.getChildren().map(item => item.label), ['Work', 'New Project']);
  editor.sendMessage({ command: 'reorder', draggedPath: '/current', targetPath: '/legacy' });
  await settle();
  await editor.commands.get('yawswith.openProject1')?.();
  assert.deepEqual(editor.opened.slice(-1)[0], ['vscode.openFolder', { fsPath: '/current', path: '/current' }, true]);
  await editor.commands.get('yawswith.switchProject')?.();
  assert.deepEqual(editor.quickPickOptions, { placeHolder: 'Switch to a pinned project', matchOnDescription: true });

  editor.sendMessage({ command: 'removeProject', path: '/current' });
  await settle();
  assert.ok(editor.posted.slice(-1)[0].projects.every(project => project.path !== '/current'));
  assert.deepEqual(editor.settings.projects, [{ name: 'Legacy', path: '/legacy', group: 'Work' }]);
  editor.updateSetting('projects', []);
  assert.deepEqual(editor.posted.slice(-1)[0].projects, []);
  assert.equal(editor.statuses.size, 1);
  assert.ok(editor.mirrorWrites < 6, 'settings changes must not create a feedback loop');
  assert.deepEqual(editor.errors, []);
  editor.dispose();
  assert.equal(editor.listenerCount, 0);
  assert.equal(editor.commands.size, 0);
  assert.equal(editor.statuses.size, 0);
});

test('sidebar validates messages and supports add/edit without stale view data', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'yawswith-extension-'));
  const editor = createEditor(dir);
  t.after(() => { editor.dispose(); rmSync(dir, { recursive: true, force: true }); });
  await editor.activate();
  editor.resolveSidebar();
  editor.sendMessage({ command: 'ready' });
  for (const message of [null, {}, { command: 'switchProject', path: 42 }, { command: 'unknown' }]) {
    editor.sendMessage(message);
  }
  await settle();
  assert.deepEqual(editor.opened, []);
  editor.inputs.push('Other');
  editor.sendMessage({ command: 'addAny' });
  await settle();
  editor.inputs.push('Renamed', 'Personal', 'star');
  editor.sendMessage({ command: 'editProject', path: '/other' });
  await settle();
  assert.deepEqual(editor.settings.projects, [{ name: 'Renamed', path: '/other', group: 'Personal', icon: 'star' }]);
  assert.equal(editor.posted.slice(-1)[0].projects[0].name, 'Renamed');
  assert.equal(editor.posted.slice(-1)[0].projects[0].icon, 'star');
  assert.deepEqual(editor.errors, []);
});

test('external store updates refresh the editor and settings mirror', { timeout: 3000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'yawswith-extension-'));
  const editor = createEditor(dir);
  t.after(() => { editor.dispose(); rmSync(dir, { recursive: true, force: true }); });
  await editor.activate();
  editor.resolveSidebar();
  editor.sendMessage({ command: 'ready' });
  const tree = editor.trees.get('yawswith.projectsTree');
  assert.ok(tree);
  const refreshed = new Promise<void>(resolve => {
    const subscription = tree.onDidChangeTreeData(() => { subscription.dispose(); resolve(); });
  });
  const other = new SharedStore(join(dir, 'state.json'));
  other.load();
  other.setProjects([{ name: 'Another Window', path: '/another' }]);
  await refreshed;
  await settle();
  assert.equal(editor.posted.slice(-1)[0].projects[0].name, 'Another Window');
  assert.deepEqual(editor.settings.projects, other.getProjects());
  assert.deepEqual(editor.errors, []);
});

test('already migrated profiles keep deletions when the extension restarts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'yawswith-extension-'));
  const store = new SharedStore(join(dir, 'state.json'));
  store.setProjects([]);
  const editor = createEditor(dir, [{ name: 'Removed', path: '/removed' }]);
  editor.state.set('yawswith.sharedStoreMigrated', true);
  t.after(() => { editor.dispose(); rmSync(dir, { recursive: true, force: true }); });
  await editor.activate();
  editor.resolveSidebar();
  editor.sendMessage({ command: 'ready' });
  assert.deepEqual(editor.settings.projects, []);
  assert.deepEqual(editor.posted.slice(-1)[0].projects, []);
  assert.deepEqual(editor.errors, []);
});

test('switching to a profile for the first time does not restore a removed pin', async t => {
  const root = mkdtempSync(join(tmpdir(), 'yawswith-profile-switch-'));
  const projects = [{ name: 'Removed', path: '/removed' }, { name: 'Kept', path: '/kept' }];
  const first = createEditor(join(root, 'User/globalStorage/www159-used.yawswith'), projects);
  const next = createEditor(join(root, 'User/profiles/work/globalStorage/www159-used.yawswith'), projects);
  t.after(() => { first.dispose(); next.dispose(); rmSync(root, { recursive: true, force: true }); });
  await first.activate();
  await first.commands.get('yawswith.removeProject')?.();
  first.dispose();
  await next.activate();
  next.resolveSidebar();
  next.sendMessage({ command: 'ready' });
  assert.deepEqual(next.posted.at(-1)?.projects, [projects[1]]);
  assert.deepEqual(next.settings.projects, [projects[1]]);
});

test('sidebar sends current state after ready and when a hidden view becomes visible', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'yawswith-extension-'));
  const editor = createEditor(dir);
  t.after(() => { editor.dispose(); rmSync(dir, { recursive: true, force: true }); });
  await editor.activate();
  editor.resolveSidebar();
  const html = editor.webview.html;
  assert.equal(editor.posted.length, 0, 'do not send state before the browser listener exists');
  editor.updateSetting('projects', [{ name: 'Latest', path: '/latest' }]);
  editor.sendMessage({ command: 'ready' });
  assert.equal(editor.posted.slice(-1)[0].projects[0].name, 'Latest');
  editor.setVisible(false);
  editor.updateSetting('projects', [{ name: 'While Hidden', path: '/hidden' }]);
  assert.equal(editor.posted.length, 1);
  editor.setVisible(true);
  assert.equal(editor.posted.slice(-1)[0].projects[0].name, 'While Hidden');
  assert.equal(editor.webview.html, html);
  editor.resolveSidebar();
  const count = editor.posted.length;
  editor.sendMessage({ command: 'ready' });
  assert.equal(editor.posted.length, count + 1, 'resolving again must dispose the old message listener');
});

test('production Solid UI and compiled extension complete add/open/unpin through the message channel', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'yawswith-solid-'));
  const editor = createEditor(dir);
  await editor.activate();
  editor.resolveSidebar();
  const browser = createBrowser(editor.webview.html, editor.sendMessage);
  const subscription = editor.onHostMessage(browser.receive);
  t.after(() => {
    subscription.dispose(); browser.dispose(); editor.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
  browser.start();
  const pin = browser.document.querySelector<HTMLButtonElement>('.toolbar button');
  assert.ok(pin);
  editor.inputs.push('From Solid');
  pin.click();
  await settle();
  const open = browser.document.querySelector<HTMLButtonElement>('.tab-left');
  assert.ok(open);
  assert.match(open.textContent || '', /From Solid/);
  assert.deepEqual(editor.settings.projects, [{ name: 'From Solid', path: '/current' }]);
  open.click();
  await settle();
  assert.deepEqual(editor.opened.slice(-1)[0], ['vscode.openFolder', { fsPath: '/current', path: '/current' }, true]);
  browser.document.querySelector<HTMLButtonElement>('.delete-btn')?.click();
  await settle();
  assert.match(browser.document.body.textContent || '', /No projects pinned yet/);
  assert.deepEqual(editor.settings.projects, []);
  assert.deepEqual(editor.errors, []);
});
