import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { getHtml } from './webview/html';
import { createBrowser } from './testSupport/browser';

test('webview shell loads local assets under a nonce-based script policy', () => {
  const html = getHtml('https://webview.test/sidebar.js', 'https://webview.test/sidebar.css', 'https://webview.test');
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
  const nonce = html.match(/script-src 'nonce-([a-f0-9]+)'/)?.[1];
  assert.ok(nonce);
  assert.ok(html.includes(`<script nonce="${nonce}" src="https://webview.test/sidebar.js">`));
  assert.match(html, /href="https:\/\/webview.test\/sidebar.css"/);
});

test('Solid renders groups safely and preserves rows, focus, and scroll across state updates', t => {
  const browser = createBrowser();
  t.after(browser.dispose);
  browser.start();
  assert.deepEqual(browser.messages, [{ command: 'ready' }]);
  assert.match(browser.document.body.textContent || '', /No projects pinned yet/);
  const projects = [
    { name: 'First', path: '/first' },
    { name: '<img onerror="alert(1)">', path: '/"quoted', group: '__proto__', icon: 'star" onclick="alert(1)' }
  ];
  browser.receive({ command: 'state', projects, activePath: '/first' });
  const rows = browser.document.querySelectorAll<HTMLElement>('.tab');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent || '', /2: <img/);
  assert.equal(rows[0].dataset.path, '/"quoted');
  assert.equal(browser.document.querySelector('img, [onclick]'), null);
  assert.equal(browser.document.querySelector('.group-header')?.textContent, '__proto__');
  const first = browser.document.querySelector<HTMLElement>('[data-path="/first"]');
  const button = first?.querySelector<HTMLButtonElement>('.tab-left');
  const list = browser.document.querySelector<HTMLElement>('.tabs');
  assert.ok(first && button && list);
  button.focus();
  list.scrollTop = 80;
  browser.receive({ command: 'state', projects: [{ ...projects[0], name: 'Renamed' }, projects[1]], activePath: null });
  assert.equal(browser.document.querySelector('[data-path="/first"]'), first);
  assert.equal(browser.document.activeElement, button);
  assert.equal(list.scrollTop, 80);
  assert.match(first.textContent || '', /1: Renamed/);
  assert.equal(first.classList.contains('active'), false);
  assert.ok(first.querySelector('.codicon-folder'));
  browser.receive({ command: 'state', projects: [], activePath: null });
  assert.match(browser.document.body.textContent || '', /No projects pinned yet/);
});

test('Solid buttons send one action each, and malformed state is ignored', t => {
  const browser = createBrowser();
  t.after(browser.dispose);
  browser.start();
  browser.receive({ command: 'state', projects: [{ name: 'A', path: '/a' }], activePath: null });
  for (const value of [null, {}, { command: 'state', projects: [null], activePath: null }]) browser.receive(value);
  const click = (selector: string) => {
    const button = browser.document.querySelector<HTMLButtonElement>(selector);
    assert.ok(button);
    button.click();
  };
  click('.tab-left');
  click('.edit-btn');
  click('.delete-btn');
  click('.toolbar button:first-child');
  click('.toolbar button:last-child');
  assert.deepEqual(browser.messages, [
    { command: 'ready' },
    { command: 'switchProject', path: '/a' },
    { command: 'editProject', path: '/a' },
    { command: 'removeProject', path: '/a' },
    { command: 'addCurrent' },
    { command: 'addAny' }
  ]);
});

test('Solid drag and drop keeps the global shortcut order after the host confirms a reorder', t => {
  const browser = createBrowser();
  t.after(browser.dispose);
  browser.start();
  const projects = [{ name: 'A', path: '/a' }, { name: 'B', path: '/b' }];
  browser.receive({ command: 'state', projects, activePath: null });
  const first = browser.document.querySelector<HTMLElement>('[data-path="/a"]');
  const second = browser.document.querySelector<HTMLElement>('[data-path="/b"]');
  assert.ok(first && second);
  let draggedPath = '';
  const transfer = {
    setData: (_format: string, value: string) => { draggedPath = value; },
    getData: () => draggedPath
  };
  const drag = (target: HTMLElement, type: string) => {
    const event = new browser.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    target.dispatchEvent(event);
  };
  drag(first, 'dragstart');
  assert.ok(first.classList.contains('dragging'));
  drag(second, 'drop');
  drag(first, 'dragend');
  assert.equal(first.classList.contains('dragging'), false);
  assert.deepEqual(browser.messages.slice(-1)[0], { command: 'reorder', draggedPath: '/a', targetPath: '/b' });
  browser.receive({ command: 'state', projects: [projects[1], projects[0]], activePath: null });
  assert.equal(browser.document.querySelector('.tab'), second);
  assert.match(second.textContent || '', /1: B/);
  assert.match(first.textContent || '', /2: A/);
});
