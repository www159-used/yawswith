import { createMemo } from 'solid-js';
import { useSidebar } from './useSidebar';

export function useProjectGroups() {
  const { state } = useSidebar();
  const groups = createMemo(() => [...new Set(state.projects.flatMap(project => project.group ? [project.group] : []))]);
  const ungrouped = createMemo(() => state.projects.filter(project => !project.group));
  const inGroup = (group: string) => state.projects.filter(project => project.group === group);
  return { groups, ungrouped, inGroup };
}
