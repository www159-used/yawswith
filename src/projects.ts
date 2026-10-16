import * as vscode from 'vscode';
import type { ProjectRepository } from './projectRepository';
import type { ProjectAction } from './webview/messages';

export function getActivePath(): string | null {
  return vscode.workspace.workspaceFile?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

function getActiveName(): string | undefined {
  const workspaceFile = vscode.workspace.workspaceFile;
  return workspaceFile
    ? workspaceFile.path.substring(workspaceFile.path.lastIndexOf('/') + 1)
    : vscode.workspace.workspaceFolders?.[0]?.name;
}

export class ProjectActions {
  constructor(private readonly repository: ProjectRepository) {}

  async open(projectPath: string, trackLaunch = true): Promise<void> {
    if (trackLaunch) this.repository.trackLaunch(projectPath);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), true);
  }

  async addCurrent(): Promise<void> {
    const path = getActivePath();
    if (!path) {
      void vscode.window.showWarningMessage('No workspace/folder is currently open.');
      return;
    }
    if (this.repository.getProjects().some(project => project.path === path)) {
      void vscode.window.showInformationMessage('Already pinned!');
      return;
    }
    const name = await vscode.window.showInputBox({ prompt: 'Name for this project tab', value: getActiveName() });
    if (!name) return;
    await this.repository.setProjects([...this.repository.getProjects(), { name, path }]);
    void vscode.window.showInformationMessage(`Pinned "${name}"`);
  }

  async switchProject(): Promise<void> {
    const projects = this.repository.getProjects();
    if (projects.length === 0) {
      void vscode.window.showInformationMessage('No pinned projects yet. Use "Pin Current Project" first.');
      return;
    }
    const picked = await vscode.window.showQuickPick(projects.map(project => ({
      label: project.icon ? `$(${project.icon}) ${project.name}` : project.name,
      description: project.group ? `[${project.group}] ${project.path}` : project.path,
      path: project.path,
      picked: project.path === getActivePath()
    })), { placeHolder: 'Switch to a pinned project', matchOnDescription: true });
    if (picked) await this.open(picked.path, false);
  }

  async remove(projectPath?: string): Promise<void> {
    if (!projectPath) {
      const picked = await vscode.window.showQuickPick(
        this.repository.getProjects().map(project => ({ label: project.name, description: project.path, path: project.path })),
        { placeHolder: 'Select project to remove' }
      );
      if (!picked) return;
      projectPath = picked.path;
    }
    await this.repository.setProjects(this.repository.getProjects().filter(project => project.path !== projectPath));
  }

  async handleMessage(message: ProjectAction): Promise<void> {
    switch (message.command) {
      case 'switchProject': await this.open(message.path); break;
      case 'addCurrent': await this.addCurrent(); break;
      case 'addAny': await this.addAny(); break;
      case 'removeProject': await this.remove(message.path); break;
      case 'editProject': await this.edit(message.path); break;
      case 'reorder': {
        const projects = this.repository.getProjects();
        const from = projects.findIndex(project => project.path === message.draggedPath);
        const to = projects.findIndex(project => project.path === message.targetPath);
        if (from === -1 || to === -1) return;
        const [moved] = projects.splice(from, 1);
        projects.splice(to, 0, moved);
        await this.repository.setProjects(projects);
        break;
      }
    }
  }

  private async addAny(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Add Project'
    });
    if (!uris?.length) return;
    const path = uris[0].fsPath;
    if (this.repository.getProjects().some(project => project.path === path)) {
      void vscode.window.showInformationMessage('Project already pinned!');
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: 'Name for this project tab', value: path.substring(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
    });
    if (name) await this.repository.setProjects([...this.repository.getProjects(), { name, path }]);
  }

  private async edit(projectPath: string): Promise<void> {
    const project = this.repository.getProjects().find(item => item.path === projectPath);
    if (!project) return;
    const name = await vscode.window.showInputBox({ prompt: 'Project Name', value: project.name });
    if (name !== undefined) project.name = name;
    const group = await vscode.window.showInputBox({
      prompt: 'Group / Category (e.g. Work, Personal). Leave empty for none.', value: project.group || ''
    });
    if (group !== undefined) project.group = group || undefined;
    const icon = await vscode.window.showInputBox({
      prompt: 'Codicon Name (e.g. star, code, rocket, browser). Leave empty for none.', value: project.icon || ''
    });
    if (icon !== undefined) project.icon = icon || undefined;
    await this.repository.setProjects(this.repository.getProjects().map(item => item.path === projectPath ? project : item));
  }
}
