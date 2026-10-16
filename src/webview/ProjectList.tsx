import { For, Show } from 'solid-js';
import type { Project } from '../model';
import { ProjectItem } from './ProjectItem';
import { useSidebar } from './hooks/useSidebar';
import { useProjectGroups } from './hooks/useProjectGroups';

export function ProjectList() {
  const { state } = useSidebar();
  const { groups, ungrouped, inGroup } = useProjectGroups();
  const item = (project: Project) => <ProjectItem
    project={project}
    index={state.projects.indexOf(project)}
    active={project.path === state.activePath}
  />;

  return <div class="tabs">
    <Show when={state.projects.length} fallback={
      <div class="empty">
        <div class="empty-icon">🚀</div>
        <div>No projects pinned yet.</div>
        <div>Open a project and click<br /><strong>Pin Current Project</strong></div>
      </div>
    }>
      <For each={groups()}>{group => <>
        <div class="group-header">{group}</div>
        <For each={inGroup(group)}>{item}</For>
      </>}</For>
      <Show when={groups().length > 0 && ungrouped().length > 0}><div class="group-header">Pinned</div></Show>
      <For each={ungrouped()}>{item}</For>
    </Show>
  </div>;
}
