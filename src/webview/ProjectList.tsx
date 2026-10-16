import { createMemo, For, Show } from 'solid-js';
import type { Project } from '../model';
import type { ProjectAction } from './messages';
import { ProjectItem } from './ProjectItem';

export function ProjectList(props: {
  projects: Project[];
  activePath: string | null;
  onAction(message: ProjectAction): void;
}) {
  const groups = createMemo(() => [...new Set(props.projects.flatMap(project => project.group ? [project.group] : []))]);
  const ungrouped = createMemo(() => props.projects.filter(project => !project.group));
  const item = (project: Project) => <ProjectItem
    project={project}
    index={props.projects.indexOf(project)}
    active={project.path === props.activePath}
    onAction={props.onAction}
  />;

  return <div class="tabs">
    <Show when={props.projects.length} fallback={
      <div class="empty">
        <div class="empty-icon">🚀</div>
        <div>No projects pinned yet.</div>
        <div>Open a project and click<br /><strong>Pin Current Project</strong></div>
      </div>
    }>
      <For each={groups()}>{group => <>
        <div class="group-header">{group}</div>
        <For each={props.projects.filter(project => project.group === group)}>{item}</For>
      </>}</For>
      <Show when={groups().length > 0 && ungrouped().length > 0}><div class="group-header">Pinned</div></Show>
      <For each={ungrouped()}>{item}</For>
    </Show>
  </div>;
}
