import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getHtml } from '../webview/html';
import type { SidebarMessage } from '../webview/messages';

/** Runs the production Solid bundle in a DOM without a Node.js global or runtime imports. */
export function createBrowser(
  html = getHtml('https://webview.test/sidebar.js', 'https://webview.test/sidebar.css', 'https://webview.test'),
  onMessage?: (message: SidebarMessage) => void,
  scriptFile = join(__dirname, '../webview-ui/sidebar.js')
) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://webview.test' });
  const messages: SidebarMessage[] = [];
  Object.defineProperty(dom.window, 'acquireVsCodeApi', { value: () => ({
    postMessage: (message: SidebarMessage) => {
      const copy: SidebarMessage = JSON.parse(JSON.stringify(message));
      messages.push(copy);
      onMessage?.(copy);
    }
  }) });
  return {
    window: dom.window,
    document: dom.window.document,
    messages,
    start: () => dom.window.eval(readFileSync(scriptFile, 'utf8')),
    receive: (data: unknown) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      // A real postMessage deserializes objects in the receiving window's realm.
      data: dom.window.JSON.parse(JSON.stringify(data))
    })),
    dispose: () => dom.window.close()
  };
}
