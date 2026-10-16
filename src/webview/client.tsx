import { render } from 'solid-js/web';
import { App } from './App';
import { SidebarProvider } from './hooks/useSidebar';
import type { SidebarMessage } from './messages';

declare function acquireVsCodeApi(): { postMessage(message: SidebarMessage): void };

const api = acquireVsCodeApi();
const root = document.getElementById('root');
if (root) render(() => <SidebarProvider postMessage={message => api.postMessage(message)}><App /></SidebarProvider>, root);
