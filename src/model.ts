export interface Project {
  name: string;
  path: string;
  group?: string;
  icon?: string;
  color?: string;
}

export interface LaunchStats {
  count: number;
  last: number;
}

export type ProjectStats = Record<string, LaunchStats>;
export type RecentProject = Pick<Project, 'name' | 'path'>;

export interface SharedState {
  version: 1;
  projects: Project[];
  stats: ProjectStats;
  recents: RecentProject[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item: unknown): item is Project =>
    isRecord(item) && typeof item.name === 'string' &&
    typeof item.path === 'string' && item.path.length > 0 &&
    ['group', 'icon', 'color'].every(key => item[key] === undefined || typeof item[key] === 'string')
  );
}
