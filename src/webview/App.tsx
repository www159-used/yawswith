import { ProjectList } from './ProjectList';
import { useSidebar } from './hooks/useSidebar';

export function App() {
  const { pinCurrent, addProject } = useSidebar();

  return <>
    <div class="toolbar">
      <button class="add-btn" title="Pin current workspace" onClick={pinCurrent}>＋ Pin Current</button>
      <button class="add-btn" title="Add another project folder" onClick={addProject}>＋ Add Project</button>
    </div>
    <div class="divider" />
    <div class="shell pos-left">
      <ProjectList />
    </div>
  </>;
}
