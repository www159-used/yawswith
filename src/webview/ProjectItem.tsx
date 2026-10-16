import { createSignal, Show } from 'solid-js';
import type { Project } from '../model';
import type { ProjectAction } from './messages';

export function ProjectItem(props: {
  project: Project;
  index: number;
  active: boolean;
  onAction(message: ProjectAction): void;
}) {
  const [dragging, setDragging] = createSignal(false);
  const open = () => props.onAction({ command: 'switchProject', path: props.project.path });

  return <div
    class="tab"
    classList={{ active: props.active, dragging: dragging() }}
    data-path={props.project.path}
    draggable
    title={props.project.path}
    onClick={open}
    onDragStart={event => {
      if (!event.dataTransfer) return;
      event.dataTransfer.setData('text/plain', props.project.path);
      event.dataTransfer.effectAllowed = 'move';
      setDragging(true);
    }}
    onDragEnd={() => setDragging(false)}
    onDragOver={event => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }}
    onDrop={event => {
      event.preventDefault();
      const draggedPath = event.dataTransfer?.getData('text/plain');
      if (draggedPath && draggedPath !== props.project.path) {
        props.onAction({ command: 'reorder', draggedPath, targetPath: props.project.path });
      }
      setDragging(false);
    }}
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
        props.onAction({ command: 'editProject', path: props.project.path });
      }}>✎</button>
      <button class="tab-btn delete-btn" title="Unpin" aria-label={`Unpin ${props.project.name}`} onClick={event => {
        event.stopPropagation();
        props.onAction({ command: 'removeProject', path: props.project.path });
      }}>✕</button>
    </div>
  </div>;
}
