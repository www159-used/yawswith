import { render } from 'solid-js/web';
import { App } from './App';
import type { SidebarMessage } from './messages';

declare function acquireVsCodeApi(): { postMessage(message: SidebarMessage): void };

const api = acquireVsCodeApi();
const root = document.getElementById('root');
if (root) render(() => <App postMessage={message => api.postMessage(message)} />, root);
