import * as vscode from 'vscode';
import { ProjectRepository, reportError } from './projectRepository';
import { ProjectActions } from './projects';
import { SidebarProvider } from './sidebar';
import { ProjectsTreeProvider, ProjectStatusBar } from './views';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const repository = new ProjectRepository(context);
  context.subscriptions.push(repository);
  await repository.initialize();

  const actions = new ProjectActions(repository);
  const sidebar = new SidebarProvider(repository, actions);
  const tree = new ProjectsTreeProvider(repository);
  const statusBar = new ProjectStatusBar(repository);
  const refresh = () => {
    sidebar.refresh();
    tree.refresh();
    statusBar.refresh();
  };
  const register = (name: string, action: () => Promise<unknown>) =>
    vscode.commands.registerCommand(name, () => action().catch(reportError));

  context.subscriptions.push(
    sidebar, tree, statusBar,
    vscode.window.registerWebviewViewProvider('yawswith.sidebarView', sidebar, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerTreeDataProvider('yawswith.projectsTree', tree),
    register('yawswith.addProject', () => actions.addCurrent()),
    register('yawswith.switchProject', () => actions.switchProject()),
    register('yawswith.removeProject', () => actions.remove()),
    register('yawswith.focus', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.yawswithContainer');
    }),
    vscode.commands.registerCommand('yawswith.openProject', (path: unknown) => {
      if (typeof path === 'string' && path) return actions.open(path).catch(reportError);
      return undefined;
    }),
    ...Array.from({ length: 9 }, (_, index) => register(`yawswith.openProject${index + 1}`, async () => {
      const project = repository.getProjects()[index];
      if (project) await actions.open(project.path);
    })),
    repository.onDidChange(refresh),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('projectTabs.statusBarMaxItems')) statusBar.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh)
  );
  refresh();
}
