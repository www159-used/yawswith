import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInThisContext } from 'node:vm';
import type { Project } from '../model';
import type { HostMessage } from '../webview/messages';

class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();
  readonly event = (listener: (value: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  };
  fire(value: T): void { this.listeners.forEach(listener => listener(value)); }
  dispose(): void { this.listeners.clear(); }
  get size(): number { return this.listeners.size; }
}

interface Disposable { dispose(): void }
interface ConfigEvent { affectsConfiguration(key: string): boolean }
interface TestView {
  resolveWebviewView(view: unknown): void;
}
interface TestTree {
  getChildren(element?: unknown): { label: string }[];
  onDidChangeTreeData(listener: () => void): Disposable;
}

/** A small editor host for exercising the compiled extension with real file I/O. */
export function createEditor(storageDir: string, initialProjects: Project[] = [], extensionFile = join(__dirname, '../extension.js')) {
  const configEvents = new Emitter<ConfigEvent>();
  const workspaceEvents = new Emitter<void>();
  const messages = new Emitter<unknown>();
  const viewDisposal = new Emitter<void>();
  const visibility = new Emitter<void>();
  const outgoing = new Emitter<HostMessage>();
  const posted: HostMessage[] = [];
  let visible = true;
  const settings: Record<string, unknown> = { projects: initialProjects, statusBarMaxItems: 6 };
  const state = new Map<string, unknown>();
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const views = new Map<string, TestView>();
  const trees = new Map<string, TestTree>();
  const statuses = new Set<{ text: string; dispose(): void }>();
  const opened: unknown[][] = [];
  const errors: string[] = [];
  const inputs: (string | undefined)[] = [];
  const subscriptions: Disposable[] = [];
  const webview = {
    options: {}, html: '', onDidReceiveMessage: messages.event,
    cspSource: 'https://webview.test',
    asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => `https://webview.test${uri.fsPath}` }),
    postMessage: async (message: HostMessage) => {
      posted.push(message);
      outgoing.fire(message);
      return true;
    }
  };
  let mirrorWrites = 0;
  let quickPickOptions: unknown;
  const fireConfig = (key: string) => configEvents.fire({
    affectsConfiguration: section => section === 'projectTabs' || section === `projectTabs.${key}`
  });
  const api = {
    EventEmitter: Emitter,
    Uri: {
      file: (path: string) => ({ fsPath: path, path }),
      joinPath: (base: { fsPath: string }, name: string) => ({ fsPath: join(base.fsPath, name) })
    },
    ConfigurationTarget: { Global: 1 },
    StatusBarAlignment: { Left: 1 },
    TreeItemCollapsibleState: { None: 0, Expanded: 2 },
    TreeItem: class { constructor(public label: string, public collapsibleState: number) {} },
    ThemeIcon: class { constructor(public id: string) {} },
    ThemeColor: class { constructor(public id: string) {} },
    workspace: {
      workspaceFolders: [{ name: 'Current', uri: { fsPath: '/current' } }],
      onDidChangeConfiguration: configEvents.event,
      onDidChangeWorkspaceFolders: workspaceEvents.event,
      getConfiguration: () => ({
        get: (key: string) => settings[key],
        inspect: (key: string) => ({ globalValue: settings[key] }),
        update: async (key: string, value: unknown) => {
          mirrorWrites++;
          settings[key] = value;
          fireConfig(key);
        }
      })
    },
    window: {
      showInputBox: async () => inputs.shift(),
      showQuickPick: async (items: unknown[], options: unknown) => {
        quickPickOptions = options;
        return items[0];
      },
      showOpenDialog: async () => [{ fsPath: '/other' }],
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async (message: string) => { errors.push(message); },
      createStatusBarItem: () => {
        const item = { text: '', show() {}, dispose() { statuses.delete(item); } };
        statuses.add(item);
        return item;
      },
      registerWebviewViewProvider: (id: string, view: TestView) => {
        views.set(id, view);
        return { dispose: () => { views.delete(id); } };
      },
      registerTreeDataProvider: (id: string, tree: TestTree) => {
        trees.set(id, tree);
        return { dispose: () => { trees.delete(id); } };
      }
    },
    commands: {
      registerCommand: (id: string, callback: (...args: unknown[]) => unknown) => {
        commands.set(id, callback);
        return { dispose: () => { commands.delete(id); } };
      },
      executeCommand: async (...args: unknown[]) => { opened.push(args); }
    }
  };

  // Load each extension module in an isolated cache; only the editor API is replaced.
  const cache = new Map<string, { exports: unknown }>();
  function load(filename: string): unknown {
    const cached = cache.get(filename);
    if (cached) return cached.exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const localRequire = createRequire(filename);
    const injectedRequire = (id: string): unknown => {
      if (id === 'vscode') return api;
      return id.startsWith('.') ? load(localRequire.resolve(id)) : localRequire(id);
    };
    const wrapper = runInThisContext(`(function(exports, require, module, __filename, __dirname) {\n${readFileSync(filename, 'utf8')}\n})`, { filename });
    wrapper(module.exports, injectedRequire, module, filename, dirname(filename));
    return module.exports;
  }
  const extension = load(extensionFile) as { activate(context: unknown): Promise<void> };
  const context = {
    subscriptions,
    globalStorageUri: { fsPath: storageDir },
    globalState: {
      get: (key: string) => state.get(key),
      update: async (key: string, value: unknown) => { state.set(key, value); }
    }
  };
  return {
    settings, state, commands, views, trees, statuses, opened, errors, inputs, webview, posted,
    activate: () => extension.activate(context),
    resolveSidebar: () => views.get('yawswith.sidebarView')?.resolveWebviewView({
      webview, onDidDispose: viewDisposal.event, onDidChangeVisibility: visibility.event,
      get visible() { return visible; }
    }),
    onHostMessage: outgoing.event,
    setVisible: (value: boolean) => { visible = value; visibility.fire(); },
    sendMessage: (message: unknown) => messages.fire(message),
    updateSetting: (key: string, value: unknown) => { settings[key] = value; fireConfig(key); },
    get mirrorWrites() { return mirrorWrites; },
    get quickPickOptions() { return quickPickOptions; },
    get listenerCount() { return configEvents.size + workspaceEvents.size + messages.size + viewDisposal.size + visibility.size; },
    dispose: () => subscriptions.splice(0).reverse().forEach(disposable => disposable.dispose())
  };
}
