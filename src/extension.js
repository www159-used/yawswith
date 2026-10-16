const vscode = require('vscode');
const { createSharedStore, collectProjectsFromEditorSettings } = require('./sharedStore');

let sharedStore = null;
let mirroringSettings = false;

class SnapSwitchViewProvider {
  constructor(context) {
    this._context = context;
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: []
    };

    this._render();

    webviewView.webview.onDidReceiveMessage(async message => {
      const config = vscode.workspace.getConfiguration('projectTabs');
      let projects = getPinnedProjects();

      switch (message.command) {
        case 'switchProject': {
          trackLaunch(this._context, message.path);
          const uri = vscode.Uri.file(message.path);
          await vscode.commands.executeCommand('vscode.openFolder', uri, true);
          break;
        }
        case 'addCurrent': {
          await addCurrentProject(this._context);
          this._render();
          break;
        }
        case 'addAny': {
          const uris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Add Project'
          });
          if (uris && uris.length > 0) {
            const path = uris[0].fsPath;
            if (!projects.find(p => p.path === path)) {
              let defaultName = path.substring(path.lastIndexOf('/') + 1);
              if (path.includes('\\')) defaultName = path.substring(path.lastIndexOf('\\') + 1);
              const name = await vscode.window.showInputBox({
                prompt: 'Name for this project tab',
                value: defaultName
              });
              if (name) {
                projects = [...projects, { name, path }];
                await saveProjects(projects);
                this._render();
              }
            } else {
              vscode.window.showInformationMessage('Project already pinned!');
            }
          }
          break;
        }
        case 'removeProject': {
          projects = projects.filter(p => p.path !== message.path);
          await saveProjects(projects);
          this._render();
          break;
        }
        case 'editProject': {
          const project = projects.find(p => p.path === message.path);
          if (project) {
            const newName = await vscode.window.showInputBox({ 
              prompt: 'Project Name', 
              value: project.name 
            });
            if (newName !== undefined) project.name = newName;
            
            const newGroup = await vscode.window.showInputBox({ 
              prompt: 'Group / Category (e.g. Work, Personal). Leave empty for none.', 
              value: project.group || '' 
            });
            if (newGroup !== undefined) project.group = newGroup === '' ? undefined : newGroup;

            const newIcon = await vscode.window.showInputBox({ 
              prompt: 'Codicon Name (e.g. star, code, rocket, browser). Leave empty for none.', 
              value: project.icon || '' 
            });
            if (newIcon !== undefined) project.icon = newIcon === '' ? undefined : newIcon;
            
            await saveProjects(projects);
            this._render();
          }
          break;
        }
        case 'reorder': {
          const { draggedPath, targetPath } = message;
          const fromIdx = projects.findIndex(p => p.path === draggedPath);
          const toIdx = projects.findIndex(p => p.path === targetPath);
          if (fromIdx !== -1 && toIdx !== -1) {
            const [moved] = projects.splice(fromIdx, 1);
            projects.splice(toIdx, 0, moved);
            await saveProjects(projects);
          }
          this._render();
          break;
        }
        case 'setPosition': {
          const pos = ['left', 'right'].includes(message.position) ? message.position : 'left';
          await config.update('position', pos, vscode.ConfigurationTarget.Global);
          this._render();
          break;
        }
      }
    });

    // Re-render when config changes
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('projectTabs')) this._render();
    });
    // This catches both regular folders and .code-workspace files:
    vscode.workspace.onDidChangeWorkspaceFolders(() => this._render());
  }

  _render() {
    if (!this._view) return;
    this._view.webview.html = getHtml(getPinnedProjects(), getActivePath());
  }

  refresh() { this._render(); }
}

function getActivePath() {
  if (vscode.workspace.workspaceFile) return vscode.workspace.workspaceFile.fsPath;
  return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || null;
}

function getActiveName() {
  if (vscode.workspace.workspaceFile) {
    const raw = vscode.workspace.workspaceFile.path;
    return raw.substring(raw.lastIndexOf('/') + 1);
  }
  return vscode.workspace.workspaceFolders?.[0]?.name || null;
}

async function persistProjectsToSettings(projects) {
  const config = vscode.workspace.getConfiguration('projectTabs');
  const current = config.get('projects') || [];
  if (JSON.stringify(current) === JSON.stringify(projects)) return;
  mirroringSettings = true;
  try {
    await config.update('projects', projects, vscode.ConfigurationTarget.Global);
  } finally {
    setTimeout(() => { mirroringSettings = false; }, 80);
  }
}

async function saveProjects(projects) {
  if (sharedStore) sharedStore.setProjects(projects);
  await persistProjectsToSettings(projects);
}

function trackLaunch(_context, projectPath) {
  sharedStore?.trackLaunch(projectPath);
}

async function addCurrentProject(context) {
  const path = getActivePath();
  if (!path) {
    vscode.window.showWarningMessage('No workspace/folder is currently open.');
    return;
  }
  const projects = getPinnedProjects();

  if (projects.find(p => p.path === path)) {
    vscode.window.showInformationMessage('Already pinned!');
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Name for this project tab',
    value: getActiveName()
  });
  if (!name) return;

  await saveProjects([...projects, { name, path }]);
  vscode.window.showInformationMessage(`Pinned "${name}"`);
}

async function switchProjectQuickPick() {
  const projects = getPinnedProjects();
  if (projects.length === 0) {
    vscode.window.showInformationMessage('No pinned projects yet. Use "Pin Current Project" first.');
    return;
  }

  const activePath = getActivePath();
  const picked = await vscode.window.showQuickPick(
    projects.map(p => ({
      label: p.icon ? `$(${p.icon}) ${p.name}` : p.name,
      description: p.group ? `[${p.group}] ${p.path}` : p.path,
      path: p.path,
      picked: p.path === activePath
    })),
    { placeHolder: 'Switch to a pinned project', matchOnDescription: true }
  );
  if (!picked) return;

  const uri = vscode.Uri.file(picked.path);
  await vscode.commands.executeCommand('vscode.openFolder', uri, true);
}

async function focusProjectTabsView() {
  await vscode.commands.executeCommand('workbench.view.extension.snapswitchContainer');
}

function getPinnedProjects() {
  const projects = sharedStore ? sharedStore.getProjects() : [];
  
  // Deduplicate by path just in case
  const seen = new Set();
  return projects.filter(p => {
    if (!p?.path || seen.has(p.path)) return false;
    seen.add(p.path);
    return true;
  });
}

function collectProfileProjects(context) {
  const config = vscode.workspace.getConfiguration('projectTabs');
  const inspect = config.inspect('projects') || {};
  const buckets = [
    config.get('projects'),
    inspect.globalValue,
    inspect.workspaceValue,
    inspect.applicationValue,
    collectProjectsFromEditorSettings(context?.globalStorageUri?.fsPath)
  ];
  const seen = new Set();
  const out = [];
  for (const list of buckets) {
    for (const p of list || []) {
      if (!p?.path || seen.has(p.path)) continue;
      seen.add(p.path);
      out.push(p);
    }
  }
  return out;
}

function initSharedStore(context) {
  sharedStore = createSharedStore(context);
  const alreadyMigrated = context.globalState.get('snapswitch.sharedStoreMigrated');
  if (!alreadyMigrated) {
    sharedStore.hydrateFromProfile({
      projects: collectProfileProjects(context),
      stats: context.globalState.get('snapswitch.projectStats') || {},
      recents: context.globalState.get('snapswitch.recentProjects') || []
    });
    context.globalState.update('snapswitch.sharedStoreMigrated', true);
  }
  return persistProjectsToSettings(sharedStore.getProjects());
}

function getStatusBarMaxItems() {
  const config = vscode.workspace.getConfiguration('projectTabs');
  const n = Number(config.get('statusBarMaxItems'));
  if (!Number.isFinite(n)) return 6;
  return Math.max(0, Math.min(20, Math.floor(n)));
}

class SnapSwitchTreeProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    const projects = getPinnedProjects();
    const activePath = getActivePath();
    
    // Support hierarchical view based on Groups. Very simple implementation:
    if (!element) {
      // Root level - return projects without groups + groups
      const groups = new Set();
      const rootItems = [];
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
        item.contextValue = 'snapswitchGroup';
        return item;
      });
      
      return [...groupItems, ...rootItems];
    } else if (element.contextValue === 'snapswitchGroup') {
      // Return items exactly in this group
      return projects
        .filter(p => p.group === element.label)
        .map(p => this._createProjectItem(p, activePath));
    }
    
    return [];
  }

  _createProjectItem(p, activePath) {
    const item = new vscode.TreeItem(p.name, vscode.TreeItemCollapsibleState.None);
    item.tooltip = p.path;
    item.contextValue = 'snapswitchProject';
    item.command = {
      command: 'snapswitch.openProject',
      title: 'Open Project',
      arguments: [p.path]
    };
    
    let iconName = 'folder';
    if (p.path === activePath) iconName = 'check';
    else if (p.icon) iconName = p.icon;
    
    item.iconPath = new vscode.ThemeIcon(iconName, p.color ? new vscode.ThemeColor(p.color) : undefined);
    
    // Add time/analytics to tooltip if we wanted (omitted for brevity here)
    return item;
  }
}

function activate(context) {
  initSharedStore(context).catch(() => {});

  const provider = new SnapSwitchViewProvider(context);
  const treeProvider = new SnapSwitchTreeProvider();
  const refreshAll = () => {
    provider.refresh();
    treeProvider.refresh();
    refreshProjectStatusBar();
  };

  const statusSwitch = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusSwitch.text = '$(rocket) SnapSwitch';
  statusSwitch.tooltip = 'Switch project (SnapSwitch)';
  statusSwitch.command = 'snapswitch.switchProject';
  statusSwitch.show();

  let projectStatusDisposables = [];
  const refreshProjectStatusBar = () => {
    for (const d of projectStatusDisposables) d.dispose();
    projectStatusDisposables = [];

    const projects = getPinnedProjects();
    const maxItems = getStatusBarMaxItems();
    const activePath = getActivePath();

    for (let i = 0; i < Math.min(maxItems, projects.length); i++) {
      const p = projects[i];
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99 - i);
      const isActive = p.path === activePath;
      const genericIcon = isActive ? '$(rocket)' : '$(folder)';
      item.text = `${p.icon ? '$(' + p.icon + ')' : genericIcon} ${i + 1}: ${p.name}`;
      const shortcutIndex = i + 1;
      const shortcutText = shortcutIndex <= 9 ? ` (Cmd+${shortcutIndex})` : '';
      item.tooltip = `Open ${p.path}${shortcutText}`;
      if (p.color) item.color = new vscode.ThemeColor(p.color);
      item.command = { command: 'snapswitch.openProject', title: 'Open Project', arguments: [p.path] };
      item.show();
      projectStatusDisposables.push(item);
    }
  };
  refreshProjectStatusBar();

  context.subscriptions.push(
    statusSwitch,
    { dispose: () => projectStatusDisposables.forEach(d => d.dispose()) },
    vscode.window.registerWebviewViewProvider('snapswitch.sidebarView', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerTreeDataProvider('snapswitch.projectsTree', treeProvider),
    vscode.commands.registerCommand('snapswitch.addProject', async () => {
      await addCurrentProject(context);
      provider.refresh();
      treeProvider.refresh();
      refreshProjectStatusBar();
    }),
    vscode.commands.registerCommand('snapswitch.switchProject', async () => {
      await switchProjectQuickPick();
    }),
    vscode.commands.registerCommand('snapswitch.focus', async () => {
      await focusProjectTabsView();
    }),
    vscode.commands.registerCommand('snapswitch.openProject', async (path) => {
      if (!path) return;
      trackLaunch(context, path);
      const uri = vscode.Uri.file(path);
      await vscode.commands.executeCommand('vscode.openFolder', uri, true);
    }),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i =>
      vscode.commands.registerCommand(`snapswitch.openProject${i}`, async () => {
        const projects = getPinnedProjects();
        if (projects[i - 1]) {
          trackLaunch(context, projects[i - 1].path);
          const uri = vscode.Uri.file(projects[i - 1].path);
          await vscode.commands.executeCommand('vscode.openFolder', uri, true);
        }
      })
    ),
    vscode.commands.registerCommand('snapswitch.removeProject', async () => {
      const projects = getPinnedProjects();
      const picked = await vscode.window.showQuickPick(
        projects.map(p => ({ label: p.name, description: p.path, path: p.path })),
        { placeHolder: 'Select project to remove' }
      );
      if (!picked) return;
      await saveProjects(projects.filter(p => p.path !== picked.path));
      provider.refresh();
      treeProvider.refresh();
      refreshProjectStatusBar();
    })
  );

  context.subscriptions.push(sharedStore.watch(() => {
    persistProjectsToSettings(sharedStore.getProjects()).catch(() => {});
    refreshAll();
  }));

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('projectTabs')) return;
      if (e.affectsConfiguration('projectTabs.projects') && !mirroringSettings && sharedStore) {
        const fromSettings = vscode.workspace.getConfiguration('projectTabs').get('projects') || [];
        if (JSON.stringify(fromSettings) !== JSON.stringify(sharedStore.getProjects())) {
          sharedStore.setProjects(fromSettings);
        }
      }
      provider.refresh();
      treeProvider.refresh();
      refreshProjectStatusBar();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      provider.refresh();
      treeProvider.refresh();
      refreshProjectStatusBar();
    })
  );
}

function getHtml(projects, activePath) {
  // Grouping logic
  const groups = {};
  const groupKeys = [];
  const ungrouped = [];
  
  projects.forEach(p => {
    if (p.group) {
        if (!groups[p.group]) {
            groups[p.group] = [];
            groupKeys.push(p.group);
        }
        groups[p.group].push(p);
    } else {
        ungrouped.push(p);
    }
  });

  const generateProjectHtml = (p, index) => {
    const isActive = p.path === activePath;
    const shortcutIndex = index + 1;
    const shortcutHtml = shortcutIndex <= 9 ? `<span class="shortcut-n">${shortcutIndex}: </span>` : '';
    const safeName = escapeHtml(p.name);
    const iconChar = p.icon ? p.icon : (isActive ? 'rocket' : 'folder');
    
    // Codicon representation
    const codicon = `<i class="codicon codicon-${iconChar}"></i>`;

    return `
      <div class="tab ${isActive ? 'active' : ''}"
           data-path="${escapeHtml(p.path)}"
           data-action="switch"
           draggable="true"
           title="${escapeHtml(p.path)}">
        <div class="tab-left">
          <div class="icon-wrap ${isActive ? 'active' : ''}">
            ${codicon}
          </div>
          <div class="tab-info">
            <span class="tab-name">${shortcutHtml}${safeName}</span>
          </div>
        </div>
        <div class="tab-actions">
          <span class="tab-btn edit-btn" data-action="edit" data-path="${escapeHtml(p.path)}" title="Edit Tab">✎</span>
          <span class="tab-btn delete-btn" data-action="remove" data-path="${escapeHtml(p.path)}" title="Unpin">✕</span>
        </div>
      </div>`;
  };

  let contentHtml = '';
  
  if (groupKeys.length > 0) {
      groupKeys.forEach(gk => {
          contentHtml += `<div class="group-header">${escapeHtml(gk)}</div>`;
          contentHtml += groups[gk].map(p => generateProjectHtml(p, projects.indexOf(p))).join('');
      });
  }
  if (ungrouped.length > 0) {
     if (groupKeys.length > 0) contentHtml += `<div class="group-header">Pinned</div>`;
     contentHtml += ungrouped.map(p => generateProjectHtml(p, projects.indexOf(p))).join('');
  }

  if (projects.length === 0) {
      contentHtml += `
      <div class="empty">
        <div class="empty-icon">🚀</div>
        <div>No projects pinned yet.</div>
        <div>Open a project and click<br><strong>Pin Current Project</strong></div>
      </div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  
  /* Fallback codicon styles (if you aren't importing codicon css properly) */
  .codicon-folder::before { content: "📁"; }
  .codicon-rocket::before { content: "🚀"; }
  .codicon-history::before { content: "⏳"; }
  .codicon-star::before { content: "⭐"; }
  .codicon-code::before { content: "💻"; }
  .codicon-browser::before { content: "🌐"; }
  .codicon { font-style: normal; font-size: 14px; }

  body {
    font-family: var(--vscode-font-family);
    font-size: 13px;
    color: var(--vscode-foreground);
    background: transparent;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 10px 8px;
  }

  .add-btn {
    flex: 1;
    padding: 7px 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    font-weight: 500;
    justify-content: center;
    transition: opacity 0.15s;
  }
  .add-btn:hover { opacity: 0.85; }

  .divider {
    height: 1px;
    background: var(--vscode-panel-border);
    margin: 0 10px 8px;
  }

  .shell {
    flex: 1;
    padding: 0 8px 8px;
    min-height: 0;
    display: flex;
  }

  .tabs {
    flex: 1;
    display: flex;
    gap: 4px;
    min-width: 0;
    min-height: 0;
  }

  .pos-left .tabs {
    flex-direction: column;
    overflow-y: auto;
  }

  .group-header {
    margin: 12px 2px 4px;
    font-size: 10px;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--vscode-descriptionForeground);
    letter-spacing: 0.5px;
  }

  .tab {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid transparent; /* No border until active or hover */
    transition: all 0.15s;
    background: transparent;
    min-width: 0;
  }
  .tab.dragging {
    opacity: 0.4;
    border: 1px dashed var(--vscode-focusBorder);
  }
  .tab:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .tab.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
    border-color: var(--vscode-focusBorder);
  }

  .pos-left .tab.active { border-left-width: 2px; border-left-color: #4ec9b0; }

  .tab-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  
  .icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    opacity: 0.8;
  }
  .icon-wrap.active {
    background: rgba(78, 201, 176, 0.2);
    border-color: #4ec9b0;
    opacity: 1;
  }

  .tab-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .tab-name {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .shortcut-n {
    opacity: 0.5;
    font-weight: 400;
    margin-right: 2px;
  }
  .tab.active .shortcut-n { opacity: 0.8; }

  .tab-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .tab-btn {
    font-size: 11px;
    padding: 3px 5px;
    border-radius: 4px;
    opacity: 0;
    flex-shrink: 0;
    color: var(--vscode-foreground);
    transition: opacity 0.1s, background 0.1s;
    user-select: none;
  }
  .tab:hover .tab-btn { opacity: 0.5; }
  .tab-btn:hover { opacity: 1 !important; }
  .delete-btn:hover { background: rgba(255,80,80,0.2); color: #ff6b6b; }
  .edit-btn:hover { background: rgba(80, 180, 255, 0.2); color: #329dfa; }

  .empty {
    text-align: center;
    padding: 40px 16px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    line-height: 1.8;
  }
  .empty-icon { font-size: 32px; margin-bottom: 12px; }
  
</style>
</head>
<body>
  <div class="toolbar">
    <button class="add-btn" data-action="addCurrent" title="Pin current workspace">＋ Pin Current</button>
    <button class="add-btn" data-action="addAny" title="Add another project folder">＋ Add Project</button>
  </div>
  <div class="divider"></div>
  <div class="shell pos-left">
    <div class="tabs">
      ${contentHtml}
    </div>
  </div>
<script>
  const vscode = acquireVsCodeApi();

  document.addEventListener('click', (ev) => {
    const target = ev.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const path = target.dataset.path;
    switch (action) {
      case 'addCurrent': vscode.postMessage({ command: 'addCurrent' }); break;
      case 'addAny': vscode.postMessage({ command: 'addAny' }); break;
      case 'switch': if (path) vscode.postMessage({ command: 'switchProject', path }); break;
      case 'edit': ev.stopPropagation(); if (path) vscode.postMessage({ command: 'editProject', path }); break;
      case 'remove': ev.stopPropagation(); if (path) vscode.postMessage({ command: 'removeProject', path }); break;
    }
  });

  document.addEventListener('dragstart', (ev) => {
    const tab = ev.target.closest('.tab[data-action="switch"]');
    if (!tab) return;
    ev.dataTransfer.setData('text/plain', tab.dataset.path || '');
    setTimeout(() => tab.classList.add('dragging'), 10);
  });
  document.addEventListener('dragover', (ev) => {
    if (ev.target.closest('.tab')) ev.preventDefault();
  });
  document.addEventListener('drop', (ev) => {
    const tab = ev.target.closest('.tab[data-action="switch"]');
    if (!tab) return;
    ev.preventDefault();
    const draggedPath = ev.dataTransfer.getData('text/plain');
    const targetPath = tab.dataset.path;
    if (draggedPath && targetPath && draggedPath !== targetPath) {
      vscode.postMessage({ command: 'reorder', draggedPath, targetPath });
    }
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('dragging'));
  });
  document.addEventListener('dragend', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('dragging'));
  });
</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function deactivate() {}
module.exports = { activate, deactivate };
