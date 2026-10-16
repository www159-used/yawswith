import { isRecord, readProjects } from '../model';
import type { Project } from '../model';

export type ProjectAction =
  | { command: 'addCurrent' | 'addAny' }
  | { command: 'switchProject' | 'editProject' | 'removeProject'; path: string }
  | { command: 'reorder'; draggedPath: string; targetPath: string };

export type SidebarMessage = ProjectAction | { command: 'ready' };

export interface SidebarState {
  projects: Project[];
  activePath: string | null;
}

export type HostMessage = SidebarState & { command: 'state' };

export function isHostMessage(value: unknown): value is HostMessage {
  return isRecord(value) && value.command === 'state' &&
    (value.activePath === null || typeof value.activePath === 'string') &&
    Array.isArray(value.projects) && readProjects(value.projects).length === value.projects.length;
}

export function isSidebarMessage(value: unknown): value is SidebarMessage {
  if (!isRecord(value)) return false;
  switch (value.command) {
    case 'ready':
    case 'addCurrent':
    case 'addAny':
      return true;
    case 'switchProject':
    case 'editProject':
    case 'removeProject':
      return typeof value.path === 'string' && value.path.length > 0;
    case 'reorder':
      return typeof value.draggedPath === 'string' && value.draggedPath.length > 0 &&
        typeof value.targetPath === 'string' && value.targetPath.length > 0;
    default:
      return false;
  }
}
