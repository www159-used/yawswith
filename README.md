# Yawswith

A local VS Code extension for switching pinned projects from the sidebar, status bar, or keyboard. Built with TypeScript and SolidJS.

## Install

```bash
npm ci
npm test
npm run package
# Then: Command Palette → Extensions: Install from VSIX...
```

For local installation into VSCodium (including its local profiles) on this Mac, run `make install`. This builds the VSIX first. The Makefile only supports local development and installation:

| Command | Action |
|---|---|
| `make check` | Check extension and sidebar types |
| `make test` | Compile and run tests |
| `make build` | Build the local VSIX |
| `make install` | Build and install into VSCodium profiles |
| `make clean` | Remove compiled output and VSIX files |

`@vscode/vsce` and the `vscode:prepublish` npm script are still needed for VSIX packaging: `vsce package` runs that script to compile the extension before creating the package.

Use Node.js 24 LTS (24.15 or newer) for development. The extension still supports VS Code 1.75 and newer.

## Development

The extension is written in TypeScript with strict type checking, and its sidebar uses SolidJS. Run `npm run check` to check both the extension and UI, or `npm test` to compile and run tests. For development, run `npm run watch` for the extension and `npm run watch:webview` in another terminal for the sidebar. `make test` and `make build` use the same npm scripts. Packaging compiles both parts automatically.

- `src/extension.ts` registers commands and connects the views.
- `src/projectRepository.ts` owns profile migration, settings mirroring, and change notifications; `src/sharedStore.ts` handles the existing `state.json` format and file watching.
- `src/projects.ts` handles project actions; `src/sidebar.ts` and `src/views.ts` render the sidebar, tree, and status bar.
- `src/webview/` contains the Solid components (`App`, `ProjectList`, and `ProjectItem`), the HTML shell, and typed messages. Sidebar styles live in `media/sidebar.css`.

Compiled extension code goes into `out/`; Vite bundles Solid and the sidebar into `out/webview-ui/sidebar.js`. The sidebar loads local assets once, signals when it is ready, and receives subsequent state updates through messages. Rows are reconciled by project path to preserve focus and scroll position during updates.

The VSIX includes the compiled runtime, bundled UI, and styles; sources, tests, and `node_modules` are excluded. Tests cover storage and migration, extension behavior with a simulated editor API and real file I/O, and the production Solid bundle in a jsdom browser environment. They do not launch an editor GUI.

## Usage

| Action | How |
|---|---|
| Pin current project | Command Palette → **Yawswith: Pin Current Project** |
| Switch project (one click) | Click a project button in the Status Bar |
| Switch project (shortcut) | **Cmd + <Number>** (1-9) for pinned projects |
| Switch project (picker) | **Cmd+Alt+P** or Command Palette → **Yawswith: Switch Project** |
| Switch project (side bar) | Open **Pinned Projects** view and click a project |

## How It Works

Pinned projects, recents, and launch stats are stored in an application-wide file (outside any single Profile) and mirrored to `projectTabs.projects` as an application-scoped setting. Switching Profiles therefore keeps the same project list.  
Clicking a tab runs `vscode.openFolder` — same as File → Open Folder — switching full context.

## Settings

- `projectTabs.statusBarMaxItems`: number of pinned projects to show as one-click Status Bar buttons (0–20)

## Migrating from SnapSwitch

Yawswith uses the extension ID `www159-used.yawswith` and command IDs beginning with `yawswith.`. Disable the old SnapSwitch extension in VSCodium before enabling Yawswith to avoid duplicate UI and shortcuts. Existing `projectTabs` settings are retained; the shared project list, launch stats, and recents are copied from SnapSwitch on first use.

## License

Yawswith is licensed under [GNU AGPL v3](LICENSE) (`AGPL-3.0-only`). It is derived from SnapSwitch; the original MIT copyright and permission notice is retained in [LICENSES/SnapSwitch-MIT.txt](LICENSES/SnapSwitch-MIT.txt).
