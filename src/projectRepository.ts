import * as vscode from 'vscode';
import { createSharedStore, collectProjectsFromEditorSettings, unionProjects, SharedStore } from './sharedStore';
import { readProjects } from './model';
import type { Project, ProjectStats, RecentProject } from './model';

/** Owns migration, settings mirroring, and notifications for every project view. */
export class ProjectRepository implements vscode.Disposable {
  private readonly store: SharedStore;
  private readonly changes = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private mirroring = false;
  private pendingMirror: Promise<void> = Promise.resolve();
  readonly onDidChange = this.changes.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.store = createSharedStore(context);
  }

  async initialize(): Promise<void> {
    const config = vscode.workspace.getConfiguration('projectTabs');
    const inspection = config.inspect<unknown>('projects');
    const projects = [
      config.get<unknown>('projects'),
      inspection?.globalValue,
      inspection?.workspaceValue,
      collectProjectsFromEditorSettings(this.context.globalStorageUri.fsPath)
    ].reduce<Project[]>((all, value) => unionProjects(all, readProjects(value)), []);
    this.store.hydrateFromProfile({
      projects,
      stats: this.context.globalState.get<ProjectStats>('yawswith.projectStats') || {},
      recents: this.context.globalState.get<RecentProject[]>('yawswith.recentProjects') || []
    });
    await this.mirrorSettings();
    this.disposables.push(
      this.store.watch(() => {
        this.changes.fire();
        void this.mirrorSettings().catch(reportError);
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration('projectTabs.projects') || this.mirroring) return;
        const projects = readProjects(vscode.workspace.getConfiguration('projectTabs').get('projects'));
        if (JSON.stringify(projects) === JSON.stringify(this.store.getProjects())) return;
        try {
          this.store.setProjects(projects);
          this.changes.fire();
        } catch (error) {
          reportError(error);
        }
      })
    );
  }

  getProjects(): Project[] {
    return unionProjects(this.store.getProjects()).map(project => ({ ...project }));
  }

  async setProjects(projects: Project[]): Promise<void> {
    this.store.setProjects(projects);
    this.changes.fire();
    await this.mirrorSettings();
  }

  trackLaunch(projectPath: string): void {
    this.store.trackLaunch(projectPath);
    // Recording a launch also reloads edits from other windows before saving.
    this.changes.fire();
    void this.mirrorSettings().catch(reportError);
  }

  private mirrorSettings(): Promise<void> {
    // Queue writes so rapid edits cannot leave the settings mirror out of order.
    const next = this.pendingMirror.then(async () => {
      const projects = this.store.getProjects();
      const config = vscode.workspace.getConfiguration('projectTabs');
      if (JSON.stringify(config.get('projects') || []) === JSON.stringify(projects)) return;
      this.mirroring = true;
      try {
        await config.update('projects', projects, vscode.ConfigurationTarget.Global);
      } finally {
        this.mirroring = false;
      }
    });
    this.pendingMirror = next.catch(() => {});
    return next;
  }

  dispose(): void {
    this.disposables.forEach(disposable => disposable.dispose());
    this.changes.dispose();
  }
}

export function reportError(error: unknown): void {
  console.error('Yawswith:', error);
  void vscode.window.showErrorMessage(`Yawswith: ${error instanceof Error ? error.message : String(error)}`);
}
