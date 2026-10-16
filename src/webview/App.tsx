import { onMount, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { ProjectList } from './ProjectList';
import { isHostMessage } from './messages';
import type { SidebarMessage, SidebarState } from './messages';

export function App(props: { postMessage(message: SidebarMessage): void }) {
  const [state, setState] = createStore<SidebarState>({ projects: [], activePath: null });
  const receiveState = (event: MessageEvent<unknown>) => {
    if (!isHostMessage(event.data)) return;
    // Reconcile by path to preserve row elements, focus, and drag state across updates.
    setState(reconcile({ projects: event.data.projects, activePath: event.data.activePath }, { key: 'path' }));
  };
  onMount(() => {
    window.addEventListener('message', receiveState);
    props.postMessage({ command: 'ready' });
  });
  onCleanup(() => window.removeEventListener('message', receiveState));

  return <>
    <div class="toolbar">
      <button class="add-btn" title="Pin current workspace" onClick={() => props.postMessage({ command: 'addCurrent' })}>＋ Pin Current</button>
      <button class="add-btn" title="Add another project folder" onClick={() => props.postMessage({ command: 'addAny' })}>＋ Add Project</button>
    </div>
    <div class="divider" />
    <div class="shell pos-left">
      <ProjectList projects={state.projects} activePath={state.activePath} onAction={props.postMessage} />
    </div>
  </>;
}
