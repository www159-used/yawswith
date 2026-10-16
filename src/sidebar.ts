import * as vscode from 'vscode';
import { join } from 'node:path';
import { getActivePath, ProjectActions } from './projects';
import { ProjectRepository, reportError } from './projectRepository';
import { getHtml } from './webview/html';
import { isSidebarMessage } from './webview/messages';
import type { HostMessage } from './webview/messages';

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private ready = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly repository: ProjectRepository, private readonly actions: ProjectActions) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.dispose();
    this.view = view;
    const scripts = vscode.Uri.file(join(__dirname, 'webview-ui'));
    const styles = vscode.Uri.file(join(__dirname, '../media'));
    view.webview.options = { enableScripts: true, localResourceRoots: [scripts, styles] };
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: unknown) => {
        if (!isSidebarMessage(message)) return;
        if (message.command === 'ready') {
          this.ready = true;
          this.refresh();
        } else {
          void this.actions.handleMessage(message).catch(reportError);
        }
      }),
      view.onDidDispose(() => this.dispose()),
      view.onDidChangeVisibility(() => { if (view.visible) this.refresh(); })
    );
    view.webview.html = getHtml(
      view.webview.asWebviewUri(vscode.Uri.joinPath(scripts, 'sidebar.js')).toString(),
      view.webview.asWebviewUri(vscode.Uri.joinPath(styles, 'sidebar.css')).toString(),
      view.webview.cspSource
    );
  }

  refresh(): void {
    if (!this.view || !this.ready || !this.view.visible) return;
    const message: HostMessage = {
      command: 'state', projects: this.repository.getProjects(), activePath: getActivePath()
    };
    void Promise.resolve(this.view.webview.postMessage(message)).catch(reportError);
  }

  dispose(): void {
    this.view = undefined;
    this.ready = false;
    this.disposables.splice(0).forEach(disposable => disposable.dispose());
  }
}
