import { createContext, onCleanup, onMount, useContext } from 'solid-js';
import type { ParentProps } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { isHostMessage } from '../messages';
import type { SidebarMessage, SidebarState } from '../messages';

function createSidebar(postMessage: (message: SidebarMessage) => void) {
  const [state, setState] = createStore<SidebarState>({ projects: [], activePath: null });
  const receiveState = (event: MessageEvent<unknown>) => {
    if (!isHostMessage(event.data)) return;
    // Stable paths preserve row elements, focus, and drag state across updates.
    setState(reconcile({ projects: event.data.projects, activePath: event.data.activePath }, { key: 'path' }));
  };
  onMount(() => {
    window.addEventListener('message', receiveState);
    postMessage({ command: 'ready' });
  });
  onCleanup(() => window.removeEventListener('message', receiveState));

  // The extension owns persistence; the UI changes only after host confirmation.
  return {
    state,
    pinCurrent: () => postMessage({ command: 'addCurrent' }),
    addProject: () => postMessage({ command: 'addAny' }),
    openProject: (path: string) => postMessage({ command: 'switchProject', path }),
    editProject: (path: string) => postMessage({ command: 'editProject', path }),
    unpinProject: (path: string) => postMessage({ command: 'removeProject', path }),
    reorderProjects: (draggedPath: string, targetPath: string) => postMessage({ command: 'reorder', draggedPath, targetPath })
  };
}

const SidebarContext = createContext<ReturnType<typeof createSidebar>>();

export function SidebarProvider(props: ParentProps<{ postMessage(message: SidebarMessage): void }>) {
  const sidebar = createSidebar(message => props.postMessage(message));
  return <SidebarContext.Provider value={sidebar}>{props.children}</SidebarContext.Provider>;
}

/** Read the single sidebar instance owned by the nearest provider. */
export function useSidebar() {
  const sidebar = useContext(SidebarContext);
  if (!sidebar) throw new Error('useSidebar requires a SidebarProvider');
  return sidebar;
}
