import { Show } from 'solid-js';
import type { Project } from '../model';
import { useSidebar } from './hooks/useSidebar';
import { useProjectDrag } from './hooks/useProjectDrag';

export function ProjectItem(props: {
  project: Project;
  index: number;
  active: boolean;
}) {
  const { openProject, editProject, unpinProject } = useSidebar();
  const drag = useProjectDrag(() => props.project.path);
  const open = () => openProject(props.project.path);

  return <div
    class="tab"
    classList={{ active: props.active, dragging: drag.dragging() }}
    data-path={props.project.path}
    draggable
    title={props.project.path}
    onClick={open}
    onDragStart={drag.onDragStart}
    onDragEnd={drag.onDragEnd}
    onDragOver={drag.onDragOver}
    onDrop={drag.onDrop}
  >
    <button class="tab-left" title={`Open ${props.project.name}`} onClick={event => { event.stopPropagation(); open(); }}>
      <span class="icon-wrap" classList={{ active: props.active }}>
        <i class={`codicon codicon-${props.project.icon || (props.active ? 'rocket' : 'folder')}`} />
      </span>
      <span class="tab-info">
        <span class="tab-name">
          <Show when={props.index < 9}><span class="shortcut-n">{props.index + 1}: </span></Show>
          {props.project.name}
        </span>
      </span>
    </button>
    <div class="tab-actions">
      <button class="tab-btn edit-btn" title="Edit Tab" aria-label={`Edit ${props.project.name}`} onClick={event => {
        event.stopPropagation();
        editProject(props.project.path);
      }}>✎</button>
      <button class="tab-btn delete-btn" title="Unpin" aria-label={`Unpin ${props.project.name}`} onClick={event => {
        event.stopPropagation();
        unpinProject(props.project.path);
      }}>✕</button>
    </div>
  </div>;
}
