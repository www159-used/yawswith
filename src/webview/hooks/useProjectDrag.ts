import { createSignal } from 'solid-js';
import type { Accessor } from 'solid-js';
import { useSidebar } from './useSidebar';

export function useProjectDrag(projectPath: Accessor<string>) {
  const { reorderProjects } = useSidebar();
  const [dragging, setDragging] = createSignal(false);

  const onDragStart = (event: DragEvent) => {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('text/plain', projectPath());
    event.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  };
  const onDragEnd = () => setDragging(false);
  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const draggedPath = event.dataTransfer?.getData('text/plain');
    if (draggedPath && draggedPath !== projectPath()) {
      reorderProjects(draggedPath, projectPath());
    }
    setDragging(false);
  };
  return { dragging, onDragStart, onDragEnd, onDragOver, onDrop };
}
