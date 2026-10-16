import * as vscode from 'vscode';
import type { Project } from './model';
import type { ProjectRepository } from './projectRepository';
import { getActivePath } from './projects';

function getStatusBarMaxItems() {
  const config = vscode.workspace.getConfiguration('projectTabs');
  const n = Number(config.get('statusBarMaxItems'));
  if (!Number.isFinite(n)) return 6;
  return Math.max(0, Math.min(20, Math.floor(n)));
}

export class ProjectsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly repository: ProjectRepository) {}

  dispose(): void { this._onDidChangeTreeData.dispose(); }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem) {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    const projects = this.repository.getProjects();
    const activePath = getActivePath();

    if (!element) {
      const groups = new Set<string>();
      const rootItems: vscode.TreeItem[] = [];
      for (const p of projects) {
        if (p.group) {
          groups.add(p.group);
        } else {
          rootItems.push(this._createProjectItem(p, activePath));
        }
      }

      const groupItems = Array.from(groups).map(g => {
        const item = new vscode.TreeItem(g, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('folder');
        item.contextValue = 'yawswithGroup';
        return item;
      });

      return [...groupItems, ...rootItems];
    } else if (element.contextValue === 'yawswithGroup') {
      return projects
        .filter(p => p.group === element.label)
        .map(p => this._createProjectItem(p, activePath));
    }

    return [];
  }

  private _createProjectItem(p: Project, activePath: string | null) {
    const item = new vscode.TreeItem(p.name, vscode.TreeItemCollapsibleState.None);
    item.tooltip = p.path;
    item.contextValue = 'yawswithProject';
    item.command = {
      command: 'yawswith.openProject',
      title: 'Open Project',
      arguments: [p.path]
    };

    let iconName = 'folder';
    if (p.path === activePath) iconName = 'check';
    else if (p.icon) iconName = p.icon;

    item.iconPath = new vscode.ThemeIcon(iconName, p.color ? new vscode.ThemeColor(p.color) : undefined);

    return item;
  }
}

export class ProjectStatusBar implements vscode.Disposable {
  private readonly switchItem: vscode.StatusBarItem;
  private items: vscode.StatusBarItem[] = [];

  constructor(private readonly repository: ProjectRepository) {
    this.switchItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.switchItem.text = '$(rocket) Yawswith';
    this.switchItem.tooltip = 'Switch project (Yawswith)';
    this.switchItem.command = 'yawswith.switchProject';
    this.switchItem.show();
  }

  refresh(): void {
    this.items.forEach(item => item.dispose());
    this.items = [];
    const projects = this.repository.getProjects();
    const activePath = getActivePath();
    for (let i = 0; i < Math.min(getStatusBarMaxItems(), projects.length); i++) {
      const project = projects[i];
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99 - i);
      const icon = project.icon || (project.path === activePath ? 'rocket' : 'folder');
      item.text = `$(${icon}) ${i + 1}: ${project.name}`;
      item.tooltip = `Open ${project.path}${i < 9 ? ` (Cmd+${i + 1})` : ''}`;
      if (project.color) item.color = new vscode.ThemeColor(project.color);
      item.command = { command: 'yawswith.openProject', title: 'Open Project', arguments: [project.path] };
      item.show();
      this.items.push(item);
    }
  }

  dispose(): void {
    this.switchItem.dispose();
    this.items.forEach(item => item.dispose());
    this.items = [];
  }
}
