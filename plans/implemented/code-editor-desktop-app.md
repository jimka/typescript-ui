---
touches-shared:
  - packages/lib/src/typescript/lib/layout/Tab.ts
  - packages/lib/src/typescript/lib/component/container/TabBar.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Loom — Desktop Code Editor Implementation Plan

## Overview

Build a local desktop code editor: open a project folder, browse it in a file tree, open files into tabs, edit them with syntax highlighting, track unsaved changes per tab, and save to disk. The editing surface is the library's [`CodeEditor`](packages/lib/docs/components/CodeEditor.md); the window is a Tauri native webview shell.

The work spans two repositories.

**This repository** gains two small additions to the `Tab` layout manager — renaming a live tab, and vetoing a user-initiated tab close. Both are required by the app's stated scope and neither exists today.[^why-library-first]

**A new sibling repository** at `/home/jika/typescript/loom` holds the app itself, scaffolded with [`packages/create-app`](packages/create-app/index.js#L113) and consuming `@jimka/typescript-ui` as an ordinary npm dependency — the same arrangement as [`../../sqladmin/frontend`](../../sqladmin/frontend/package.json). Throughout this plan, an unprefixed path such as `src/main.ts` is relative to that new repository; a path starting `packages/` is relative to this one.

---

## Architecture Decisions

### Two library additions ship first, in this repository

`Tab` gets `setTabName(content, name)` and a cancelable `"beforetabclose"` event. The rename lets a tab label carry an unsaved-changes marker — without it a label is frozen at creation. The veto lets a tab's ✕ ask before the tab closes — without it the tab is gone by the time the app hears about it.[^why-library-first]

The veto mirrors [`Drawer`](packages/lib/src/typescript/lib/overlay/Drawer.ts#L381)'s existing `"beforeclose"` + `DrawerCloseController` shape exactly — same controller-with-`preventDefault()` object, same "emit, check the flag, return early" body. No new pattern is introduced.

### The app is a new sibling repository, scaffolded by `create-tsui-app`

`npx @jimka/create-tsui-app@latest loom`, run from `/home/jika/typescript/`, produces the whole starter: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `.gitignore`. The plan then edits those generated files rather than writing them from scratch.[^scaffold-then-edit]

The app's own conventions follow [`../../sqladmin/frontend/COMPONENT_CONVENTIONS.md`](../../sqladmin/frontend/COMPONENT_CONVENTIONS.md): class-first components that `extend` a library base, children built as locals before `super()`, callbacks as arrow-function fields, and each class exported through `callable()`.

### Tauri is a window plus two official plugins

`src-tauri/` registers `tauri_plugin_fs` and `tauri_plugin_dialog`, opens a window, and does nothing else. There is no sidecar process, no custom URI scheme, no bearer token, and no custom Rust command.[^tauri-minimal] The webview calls `@tauri-apps/plugin-fs` and `@tauri-apps/plugin-dialog` directly.

The app is Tauri-only. `src/data/workspace.ts` imports the plugins statically and there is no browser fallback, so development runs through `npm run tauri:dev`.[^tauri-only]

### `TabPanel` for the editor tabs, not `Dock`

Open files live in a [`TabPanel`](packages/lib/src/typescript/lib/component/container/TabPanel.ts#L139) whose wrapped `Tab` manager the app reaches through [`getTab()`](packages/lib/src/typescript/lib/component/container/TabPanel.ts#L182).[^tabpanel-not-dock]

### One `CodeEditor` per open file

Each open file owns its own `CodeEditor` instance, built when the file is opened and destroyed when its tab closes. A single shared editor swapped with [`setValue`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L347) is not used.[^editor-per-file]

Each editor is wrapped in a `FileEditor` — an app `Container` with a `Fit` layout that owns the file's path, its dirty flag, and its `"change"` wiring. `FileEditor` is the component the tab holds, so `Tab` operations (`setTabName`, `closeTab`, `getActiveContent`) all address it.[^fileeditor-earns-its-class]

### The file tree loads one directory per expansion

`FileTree` is a [`Tree`](packages/lib/docs/components/Tree.md) subclass. Every directory node is declared `hasChildren: true` with a `loadChildren` loader that calls `readDir` for exactly that directory. Nothing is read ahead of an expansion.[^lazy-tree]

### Dirty state is a boolean flag on `FileEditor`

`FileEditor` sets `_dirty = true` on the editor's first `"change"` after a load or save, and back to `false` on save. It is not derived by comparing the document against the text last written.[^dirty-flag]

### The unsaved-changes prompt is a three-button `Dialog`

[`Dialog`](packages/lib/docs/components/Dialog.md) already covers it; no new component is needed. `DialogResult` has only three values, so the three-way answer is captured in a closure through each button's [`onClick`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L90) guard rather than through the resolved result.[^three-way-dialog]

### Shortcuts are a chord registry plus one `window` keydown listener

The library's `MenuItemConfig.shortcut` is a display hint that binds nothing (see [`packages/lib/docs/recipes/keyboard-shortcuts.md`](packages/lib/docs/recipes/keyboard-shortcuts.md)). `src/shell/shortcuts.ts` holds the display strings and one `isXChord(event)` matcher per chord, and `installAccelerators` registers a single `window` `keydown` listener that dispatches them — mirroring [`../../sqladmin/frontend/src/shell/queryShortcuts.ts`](../../sqladmin/frontend/src/shell/queryShortcuts.ts) and [`SqlAdminShell.ts:168`](../../sqladmin/frontend/src/shell/SqlAdminShell.ts#L168).

---

## Public API

The two additions to this repository. Nothing else in the library changes.

`packages/lib/src/typescript/lib/component/container/TabBar.ts`:

```typescript
/**
 * Replaces the display label of the cell with `id`, updating the strip
 * button's text and re-laying out the strip. No-op for an unknown id.
 */
setEntryName(id: string, name: string): this;
```

`packages/lib/src/typescript/lib/layout/Tab.ts`:

```typescript
export type TabEvent =
    "tabclose" | "beforetabclose" | "empty" | "detach" | "select"
    | "activate" | "dock" | "exception" | "busychange";

/**
 * Controller handed to a `"beforetabclose"` listener. Calling
 * `preventDefault()` aborts the close the user just requested.
 */
export interface TabCloseController {
    /** Aborts the close that is about to run. */
    preventDefault(): void;
}

export interface TabOptions extends LayoutManagerOptions {
    listeners?: {
        tabclose?: (component: Component) => void;
        beforetabclose?: (component: Component, controller: TabCloseController) => void;
        empty?: () => void;
        exception?: (error: unknown, label: string) => void;
        busychange?: (busy: boolean, label: string) => void;
    };
    // …existing fields unchanged
}

class Tab extends LayoutManager {
    /**
     * Replaces the label of the tab hosting `content`.
     *
     * @returns `true` when a matching tab was found, `false` otherwise.
     */
    setTabName(content: Component, name: string): boolean;

    on(event: "beforetabclose",
       listener: (content: Component, controller: TabCloseController) => void): this;
    off(event: "beforetabclose",
        listener: (content: Component, controller: TabCloseController) => void): this;

    protected emit(event: "beforetabclose",
                   content: Component, controller: TabCloseController): void;
}
```

`"beforetabclose"` fires only on the **user** close path — the ✕, the right-click menu's *Close*, and every bulk-close row, all of which reach [`Tab._onBarTabClose`](packages/lib/src/typescript/lib/layout/Tab.ts#L1081). The programmatic [`closeTab(content)`](packages/lib/src/typescript/lib/layout/Tab.ts#L1169) is **not** guarded, so a listener that vetoes a close can later complete it by calling `closeTab` without re-triggering itself.[^veto-user-path-only]

A tab whose content has not materialized yet (a deferred lazy tab) has no component to hand a listener, so no `"beforetabclose"` fires for it and it closes normally.

---

## Internal Structure

### Extension → language id

`src/editor/languages.ts` exports `languageForPath(path: string): string | null`. The extension is everything after the **last** dot in the file's base name, lowercased; a base name whose only dot is its first character has no extension.

| path | extension | language id |
|---|---|---|
| `/p/src/main.ts` | `.ts` | `javascript` |
| `/p/src/app.tsx` | `.tsx` | `javascript` |
| `/p/README.md` | `.md` | `markdown` |
| `/p/style.CSS` | `.css` | `css` |
| `/p/.gitignore` | *(none)* | `null` |
| `/p/Makefile` | *(none)* | `null` |
| `/p/data.bin` | `.bin` | `null` |

Full map:

| language id | extensions | source |
|---|---|---|
| `javascript` | `js` `jsx` `mjs` `cjs` `ts` `tsx` `mts` `cts` | library built-in |
| `json` | `json` | library built-in |
| `html` | `html` `htm` | library built-in |
| `sql` | `sql` | library built-in |
| `markdown` | `md` `markdown` | library built-in |
| `css` | `css` | registered by the app |
| `python` | `py` | registered by the app |

The two app-registered languages go through [`registerLanguage`](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L48), called once at module scope in `src/editor/languages.ts`, with no `loadFormatter` (so `format()` falls back to re-indenting for them):

```typescript
registerLanguage({
    id: 'css',
    label: 'CSS',
    loadExtension: async () => {
        const { css } = await import('@codemirror/lang-css');

        return css();
    },
});
```

### Tab label and window title

`FileEditor.getLabel()` returns the file's base name, with `" •"` appended while dirty:

| file | dirty | tab label | window title |
|---|---|---|---|
| — | — | — | `Loom` |
| `/p/src/main.ts` | no | `main.ts` | `main.ts — Loom` |
| `/p/src/main.ts` | yes | `main.ts •` | `• main.ts — Loom` |

### Directory listing order

`sortDirEntries(items)` takes `{ name, isDir }`-shaped items and returns them with directories before files, each group ordered by name case-insensitively, with ties broken by the raw name so the order is stable:

| input (`name`, `isDir`) | output order |
|---|---|
| `README.md` f, `src` d, `a.ts` f, `Docs` d | `Docs`, `src`, `a.ts`, `README.md` |

### The close sequence

`EditorController` wires both close events on the same `Tab`:

```typescript
// The user asked to close. Dirty files stop here and finish asynchronously.
tab.on('beforetabclose', this.handleBeforeTabClose);

// The close actually happened (clean ✕, or our own closeTab below).
tab.on('tabclose', this.handleTabClose);
```

`handleBeforeTabClose(content, controller)` returns immediately when the file is clean. When it is dirty it calls `controller.preventDefault()` and starts `confirmThenClose(file)`, which awaits the prompt and then:

| choice | action |
|---|---|
| Cancel (also Escape, backdrop, dialog ✕) | nothing — the tab stays open, still dirty |
| Don't Save | `tab.closeTab(file)` |
| Save | `await this.save(file)`; on success `tab.closeTab(file)`, on a failed write show `Dialog.error` and leave the tab open |

Every open file has a real path, so `save(file)` always writes to that path and never falls back to the save dialog.

`handleTabClose(content)` drops the file from the registry and then schedules the active-state resync with `queueMicrotask`. The deferral is required: `Tab` emits `"tabclose"` from inside [`closeEntry`](packages/lib/src/typescript/lib/layout/Tab.ts#L1097) *before* it selects the next tab, so reading `getActiveContent()` synchronously in the listener returns the tab that is being closed. `"activate"` does not fire for a post-close reselection either, so this microtask is the only place the resync can happen.

### App module map

| module | holds |
|---|---|
| `src/main.ts` | `Body.init`, glyph registration, build controller, mount shell |
| `src/appIdentity.ts` | `APP_NAME`, `APP_FAVICON` |
| `src/EditorController.ts` | the `TabPanel`, the `StatusBar`, the open-file registry, every command |
| `src/shell/EditorShell.ts` | `Border`: menu bar NORTH, `Split` CENTER, status bar SOUTH |
| `src/shell/shortcuts.ts` | chord display strings, `isXChord` matchers, `installAccelerators` |
| `src/shell/unsavedPrompt.ts` | `promptUnsavedChanges(label): Promise<UnsavedChoice>` |
| `src/explorer/FileTree.ts` | `Tree` subclass over the project folder |
| `src/editor/FileEditor.ts` | one open file: path, dirty flag, its `CodeEditor` |
| `src/editor/languages.ts` | `languageForPath`, the two extra `registerLanguage` calls |
| `src/data/paths.ts` | `baseName`, `extensionOf`, `joinPath`, `sortDirEntries` — pure, no imports |
| `src/data/workspace.ts` | the only module importing `@tauri-apps/*` |

---

## Ordered Implementation Steps

### Phase 1 — the library additions (this repository)

1. **`packages/lib/src/typescript/lib/component/container/TabBar.ts`** — add `setEntryName(id, name)` beside [`getEntryName`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1447). Look the entry up with the existing `entryById`; when found, assign `entry.name = name`, call `entry.button.setText(name)`, and `this.scheduleLayout()` so a width-mode strip re-measures. Return `this`.

2. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — add `"beforetabclose"` to the `TabEvent` union at [line 55](packages/lib/src/typescript/lib/layout/Tab.ts#L55), export the `TabCloseController` interface next to it, and add the `beforetabclose` field to `TabOptions.listeners`.

3. **`Tab.ts`** — add the `on` / `off` overloads and the `protected emit` overload for `"beforetabclose"`, in the same positions the existing `"tabclose"` overloads occupy.

4. **`Tab.ts`** — add the veto to [`_onBarTabClose`](packages/lib/src/typescript/lib/layout/Tab.ts#L1081). Resolve the entry for `id`; when it has a live `component`, build a `{ preventDefault }` controller over a local `prevented` flag, `emit("beforetabclose", component, controller)`, and return without calling `closeEntry` when `prevented` is true. Leave [`closeEntry`](packages/lib/src/typescript/lib/layout/Tab.ts#L1097) and [`closeTab`](packages/lib/src/typescript/lib/layout/Tab.ts#L1169) untouched.

5. **`Tab.ts`** — add `setTabName(content, name)`: find the entry whose `component === content`, forward to `this._bar.setEntryName(entry.id, name)`, return `true`; return `false` when no entry matches. Model it on `closeTab`'s lookup.

6. **Create `packages/lib/tests/layout/Tab.renameAndVeto.test.ts`**, modelled on [`packages/lib/tests/layout/Tab.closeDisposal.test.ts`](packages/lib/tests/layout/Tab.closeDisposal.test.ts) — same `installTestDOM(CONFIG)` setup, same `hostTab()` helper, same private-field reach for `_bar._entries`. Cover the five cases in `## Expected Behaviour` § *Library*.

7. Run `cd packages/lib && npm run typecheck && npm test` — clean, and the new file's cases pass.

8. Update the docs: `packages/lib/docs/layouts/Tab.md` (add a `beforetabclose` row to the *Events* table at line 48, a paragraph stating that it fires only on the user close path, and a *Renaming a tab* note for `setTabName`); `packages/lib/docs/components/TabPanel.md` (extend *Close hooks* with the `getTab().on("beforetabclose", …)` guard example); `packages/lib/docs/reference/changelog/next.md` (a `### Layouts` subsection under the existing `## Added` heading).

9. Run `cd packages/lib && npm run docs:api` — must finish with **zero** warnings.

10. Run `cd packages/lib && npm run build:lib`. This is what publishes the new APIs into `packages/lib/dist/`, which the app links against in step 14. `dist/` is gitignored, so this must be re-run after any later change to Phase 1's code.

### Phase 2 — scaffold the app repository and get a window

11. From `/home/jika/typescript/`, run `npx @jimka/create-tsui-app@latest loom`. Then `cd loom && git init && git add -A && git commit -m "Scaffold"`.

12. Edit the generated `package.json`: set `"license": "PolyForm-Noncommercial-1.0.0"`, `"author": "Jimmy Karlsson"`, `"description": "A local desktop code editor built on @jimka/typescript-ui."`, and add `"test": "vitest run"`, `"tauri:dev": "tauri dev"`, `"tauri:build": "tauri build"` to `scripts`. Change `"dev"` to `"tsc --noEmit && vite"` and `"build"` to `"tsc --noEmit && vite build"`, matching [`../../sqladmin/frontend/package.json`](../../sqladmin/frontend/package.json).

13. Install dependencies:
    - `npm i @tauri-apps/api @tauri-apps/plugin-fs @tauri-apps/plugin-dialog @codemirror/lang-css @codemirror/lang-python`
    - `npm i -D @tauri-apps/cli vitest`

    Check that the three `@tauri-apps/*` packages resolved to a `2.x` major.

14. Point the app at the locally-built library so Phase 1's APIs are visible: delete `node_modules/@jimka/typescript-ui` and symlink it to the `packages/lib` directory of the checkout you built in step 10. Verify: `readlink node_modules/@jimka/typescript-ui` names that checkout, and `ls node_modules/@jimka/typescript-ui/dist/lib/core.es.js` exists.

15. Edit `vite.config.ts` — keep the generated `build.rollupOptions.output.minify` block exactly as scaffolded (it is what keeps `constructor.name` intact, which the library's CSS scoping depends on) and add:

    ```typescript
    server: {
        port: 1420,
        strictPort: true,
        fs: { strict: false },
    },
    resolve: {
        dedupe: [
            '@jimka/typescript-ui',
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/language',
        ],
    },
    optimizeDeps: {
        exclude: ['@jimka/typescript-ui'],
    },
    ```

16. Create `vitest.config.ts` with `test: { include: ["tests/**/*.test.ts"], environment: "node" }`, copying [`../../sqladmin/frontend/vitest.config.ts`](../../sqladmin/frontend/vitest.config.ts) minus its `define` block. Extend `tsconfig.json`'s `include` to `["src", "tests", "vite.config.ts", "vitest.config.ts"]` and its `compilerOptions.lib` to `["ES2022", "DOM", "DOM.Iterable"]`.

17. Scaffold the Tauri shell: `npx tauri init` from the repo root, answering `../dist` for the frontend build output and `http://localhost:1420` for the dev-server URL. That produces `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, and `src-tauri/icons/`. Append `src-tauri/target/` to `.gitignore`.

18. In `src-tauri/tauri.conf.json` set `productName` to `"Loom"`, `identifier` to `"com.jimka.loom"`, `build.beforeDevCommand` to `"npm run dev"`, `build.beforeBuildCommand` to `"npm run build"`, `build.devUrl` to `"http://localhost:1420"`, `build.frontendDist` to `"../dist"`, and the window's `title` to `"Loom"` with a `width` of `1200` and `height` of `800`.

19. Add the two plugin crates: from `src-tauri/`, `cargo add tauri-plugin-fs tauri-plugin-dialog`. In `src-tauri/src/lib.rs`, chain `.plugin(tauri_plugin_fs::init())` and `.plugin(tauri_plugin_dialog::init())` onto the builder. Check: `cargo check` from `src-tauri/` succeeds.

20. Replace `src-tauri/capabilities/default.json`'s `permissions` array with:

    ```json
    [
      "core:default",
      "dialog:default",
      "fs:default",
      "fs:allow-read-text-file",
      "fs:allow-write-text-file",
      "fs:allow-read-dir",
      "fs:allow-stat",
      { "identifier": "fs:scope", "allow": [{ "path": "$HOME/**" }] }
    ]
    ```

    A plugin's `*:default` set does not grant every command, and a missing grant fails at **runtime** with a permission error while Rust and TypeScript both compile cleanly — so this must be confirmed by actually opening a folder in step 40, not by a build passing.

21. Run `npm run tauri:dev`. Manual-verify: a native window opens showing the scaffold's `Hello from typescript-ui` header. Stop here and fix the toolchain if it does not — every later step's smoke test runs through this command.

### Phase 3 — pure modules, test-first

22. Create `tests/paths.test.ts` covering `baseName`, `extensionOf`, `joinPath`, and `sortDirEntries` against the tables in `## Expected Behaviour` § *Pure modules*. Then create `src/data/paths.ts` to make them pass. It imports nothing.

23. Create `tests/languages.test.ts` covering `languageForPath` against the extension table in `## Internal Structure`. Then create `src/editor/languages.ts` with the map, `languageForPath`, and the two `registerLanguage` calls, to make them pass.

24. Run `npm test` — both files green.

### Phase 4 — the filesystem seam

25. Create `src/data/workspace.ts`. It is the **only** module in the app that imports `@tauri-apps/*`, and it exports:

    - `pickProjectFolder(): Promise<string | null>` — `open({ directory: true, multiple: false })`.
    - `pickSaveTarget(defaultPath: string): Promise<string | null>` — `save({ defaultPath })`.
    - `listDirectory(dir: string): Promise<DirectoryItem[]>` — `readDir(dir)`, mapped to `{ name, path: joinPath(dir, name), isDir: entry.isDirectory }` and passed through `sortDirEntries`. `readDir` returns entry **names**, not paths, so the join is mandatory.
    - `readFileText(path: string): Promise<string>` — `stat(path)` first; throw a plain `Error` naming the file and the limit when `size` exceeds `MAX_OPEN_BYTES` (5 × 1024 × 1024), otherwise `readTextFile(path)`. A plain `Error` is enough because the single caller only shows its message.
    - `writeFileText(path: string, text: string): Promise<void>` — `writeTextFile(path, text)`.
    - `setWindowTitle(title: string): Promise<void>` — `getCurrentWindow().setTitle(title)` from `@tauri-apps/api/window`.

### Phase 5 — components

26. Create `src/editor/FileEditor.ts`: `class FileEditor extends Container`, exported through `callable()`. Constructor takes `{ path, text, onDirtyChange }`. It builds the `CodeEditor` as a **local before `super()`** (`new CodeEditor(text, { language: languageForPath(path) })`), calls `super({ layoutManager: new Fit(), components: [editor] })`, then assigns its fields and wires `editor.on("change", this.handleChange)`. `handleChange` is an **arrow-function field**; it returns early when `_dirty` is already true, otherwise sets it and calls `this._onDirtyChange(this)`.

    Public surface: `getPath()`, `setPath(path)` (also calls `editor.setLanguage(languageForPath(path))`), `getEditor()`, `isDirty()`, `markClean()` (clears `_dirty` and notifies), `getLabel()` (`baseName(path)`, plus `" •"` while dirty).

27. Create `src/explorer/FileTree.ts`: `class FileTree extends Tree`, exported through `callable()`. Constructed with `{ expandTrigger: "click", rowOverflow: "scroll" }` and an `onOpenFile: (path: string) => void` callback. It sets an `IconLabelTreeNodeRenderer` factory whose resolver reads the node's `data.isDir` and returns `"folder"` or `"file-code"`. `setProjectRoot(root)` calls `listDirectory(root)` and `setNodes(...)`; a directory item becomes `{ label: name, hasChildren: true, loadChildren: () => this.loadInto(path), data: { path, isDir: true } }` and a file becomes `{ label: name, data: { path, isDir: false } }`. Its `"selection"` listener is an arrow field that calls `onOpenFile` when the selected node's `data.isDir` is false.

28. Create `src/shell/unsavedPrompt.ts`, exporting `type UnsavedChoice = "save" | "discard" | "cancel"` and `promptUnsavedChanges(label)`. Declare `let choice: UnsavedChoice = "cancel"` before the `Dialog.show` call, give each of the three buttons an `onClick` that assigns `choice` and returns `true`, and return `choice` after the awaited `show`. Escape, the backdrop, and the dialog's own ✕ bypass `onClick`, which is exactly why the initial value is `"cancel"`.

29. Create `src/shell/shortcuts.ts` with the display constants and matchers from `## Expected Behaviour` § *Shortcuts*, plus an exported `AcceleratorActions` interface of six zero-argument callbacks (`onOpenFolder`, `onSave`, `onSaveAs`, `onCloseFile`, `onFormat`, `onToggleExplorer`) and `installAccelerators(actions: AcceleratorActions)`. The module imports nothing from the controller, so no import cycle can form. Follow [`../../sqladmin/frontend/src/shell/queryShortcuts.ts`](../../sqladmin/frontend/src/shell/queryShortcuts.ts): one exported `const X_SHORTCUT = "Ctrl/Cmd+S"` display string per chord, one `isXChord(event)` predicate per chord, and a single `window` `keydown` listener that `preventDefault()`s **only** when a chord matched.

### Phase 6 — controller and shell

30. Create `src/EditorController.ts`. It owns two **public readonly** fields the shell arranges — `tabs: TabPanel` (constructed with `tabOptions: { widthMode: "content", maxWidth: 200, scrollable: true, reorderable: true }`) and `statusBar: StatusBar` — plus the private `_openFiles: Map<string, FileEditor>` and `_languageText: Text` (added to the status bar with `addRight`). Its constructor wires `"beforetabclose"`, `"tabclose"`, and `"activate"` on `this.tabs.getTab()`, each to an arrow-function field. Public ownership of `tabs` and `statusBar` mirrors `controller.dock` / `controller.statusBar` in [`SqlAdminShell.ts:129`](../../sqladmin/frontend/src/shell/SqlAdminShell.ts#L129).

    The controller never holds the tree or the split — both belong to the shell. It exposes `setProjectRootListener(fn: (root: string) => void)` and calls that listener from `openProjectFolder()`, mirroring how `SqlAdminShell` injects `controller.setStartToggle` / `controller.setShowQueriesView` at [`SqlAdminShell.ts:145`](../../sqladmin/frontend/src/shell/SqlAdminShell.ts#L145).

31. Add the commands to `EditorController`, exactly as specified in `## Internal Structure` § *The close sequence* and `## Expected Behaviour`:
    `openProjectFolder()`, `openFile(path)`, `saveActive()`, `saveAs(file)`, `save(file)`, `closeActive()`, `formatActive()`, plus the predicates `hasActiveFile()` and `isActiveDirty()` the menu providers read, the private `syncActive()` (sets the window title through `setWindowTitle` and the status bar's language text), and `handleDirtyChange(file)` (calls `this.tabs.getTab().setTabName(file, file.getLabel())`, then `syncActive()`). Toggling the explorer is **not** a controller command — the `Split` belongs to the shell, which supplies that callback itself (step 35).

32. `openFile(path)`: when `_openFiles` already has `path`, call `getTab().setActiveContent(existing)` and return. Otherwise `await readFileText(path)`, build `new FileEditor({ path, text, onDirtyChange: this.handleDirtyChange })`, `addTab(file, file.getLabel(), { closeable: true })`, register it in `_openFiles`, and `setActiveContent(file)`. A rejected read shows `Dialog.error` and opens nothing.

33. Create `src/shell/EditorShell.ts`: `class EditorShell extends Container`, exported through `callable()`. It builds three locals before `super()` — the `FileTree` (constructed with `onOpenFile: path => controller.openFile(path)`), the `MenuBar`, and a horizontal `Split` — then calls `super({ layoutManager: new BorderLayout({ spacing: 0 }), components: [...] })` with the menu bar `NORTH`, the split body `CENTER`, and `controller.statusBar` `SOUTH` — the same shape as [`SqlAdminShell`](../../sqladmin/frontend/src/shell/SqlAdminShell.ts#L82). The tree pane is added with `{ weight: 0 }` and given `setMinSize({ width: 160, height: 0 })`; `controller.tabs` is added with `{ weight: 1 }` so it absorbs the slack.

    After `super()` returns, the constructor calls `controller.setProjectRootListener(root => tree.setProjectRoot(root))` and then `installAccelerators(...)` with the same six callbacks it gave the menu bar — the post-`super()` placement [`SqlAdminShell.ts:145`](../../sqladmin/frontend/src/shell/SqlAdminShell.ts#L145) uses for exactly these two kinds of wiring.

34. Add `buildMenuBar(actions)` and a `MenuBarActions` interface to `EditorShell.ts`, modelled on [`SqlAdminShell.ts:372`](../../sqladmin/frontend/src/shell/SqlAdminShell.ts#L372) and its own `MenuBarActions` at line 327. `MenuBarActions` is `AcceleratorActions` plus the two predicates `hasActiveFile()` and `isActiveDirty()`. Each menu's `items` is a **provider function**, so enablement is recomputed every time the menu opens:

    | menu | item | shortcut hint | enabled when |
    |---|---|---|---|
    | File | Open Folder… | `Ctrl/Cmd+O` | always |
    | File | Save | `Ctrl/Cmd+S` | a file is active **and** dirty |
    | File | Save As… | `Ctrl/Cmd+Shift+S` | a file is active |
    | File | Close File | `Ctrl/Cmd+W` | a file is active |
    | Edit | Format Document | `Alt+Shift+F` | a file is active |
    | View | Toggle Explorer | `Ctrl/Cmd+B` | always |

35. Wire *Toggle Explorer* to `split.setPaneCollapsed(0, !split.isPaneCollapsed(0))` — the explorer is pane index 0.

36. Rewrite `src/main.ts`: register every glyph the app names in one `Glyph.register(...)` call (`folder`, `file_code`, `floppy_disk`, `times`, `pen_to_square`, `eye`, `bars`, `code`), `Body.init({ layoutManager: Fit(), favicon: APP_FAVICON })`, construct the controller, then `Body.getInstance().addComponent(EditorShell(controller))`. Accelerators are installed by `EditorShell`'s own constructor (step 33), not here. Create `src/appIdentity.ts` with `APP_NAME = "Loom"` and an `APP_FAVICON` data URI, following [`../../sqladmin/frontend/src/appIdentity.ts`](../../sqladmin/frontend/src/appIdentity.ts).

37. Update `index.html`'s `<title>` to `Loom` and its script `src` to `/src/main.ts`.

### Phase 7 — verification

38. `npm run typecheck && npm test` — clean.

39. `grep -rn "@tauri-apps/" src/ --include=*.ts` — every match is in `src/data/workspace.ts`.

40. `npm run tauri:dev` and walk the whole manual checklist in `## Verification`.

41. `npm run tauri:build` — produces a bundle under `src-tauri/target/release/bundle/`. Launch it and confirm the folder picker and a save both work outside the dev server.

---

## Files to Create / Modify / Delete

### This repository (`/home/jika/typescript/typescript-ui`)

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Create | `packages/lib/tests/layout/Tab.renameAndVeto.test.ts` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/components/TabPanel.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

### The new repository (`/home/jika/typescript/loom`)

| Action | File |
|---|---|
| Create | `package.json` *(scaffolded, then edited)* |
| Create | `tsconfig.json` *(scaffolded, then edited)* |
| Create | `vite.config.ts` *(scaffolded, then edited)* |
| Create | `index.html` *(scaffolded, then edited)* |
| Create | `.gitignore` *(scaffolded, then edited)* |
| Create | `README.md` *(scaffolded)* |
| Create | `vitest.config.ts` |
| Create | `src/main.ts` *(scaffolded, then rewritten)* |
| Create | `src/appIdentity.ts` |
| Create | `src/EditorController.ts` |
| Create | `src/shell/EditorShell.ts` |
| Create | `src/shell/shortcuts.ts` |
| Create | `src/shell/unsavedPrompt.ts` |
| Create | `src/explorer/FileTree.ts` |
| Create | `src/editor/FileEditor.ts` |
| Create | `src/editor/languages.ts` |
| Create | `src/data/paths.ts` |
| Create | `src/data/workspace.ts` |
| Create | `tests/paths.test.ts` |
| Create | `tests/languages.test.ts` |
| Create | `src-tauri/Cargo.toml` *(scaffolded, then edited)* |
| Create | `src-tauri/tauri.conf.json` *(scaffolded, then edited)* |
| Create | `src-tauri/build.rs` *(scaffolded)* |
| Create | `src-tauri/src/main.rs` *(scaffolded)* |
| Create | `src-tauri/src/lib.rs` *(scaffolded, then edited)* |
| Create | `src-tauri/capabilities/default.json` *(scaffolded, then edited)* |
| Create | `src-tauri/icons/` *(scaffolded)* |

---

## Expected Behaviour

### Library (unit-testable, in `packages/lib/tests/layout/Tab.renameAndVeto.test.ts`)

1. **Rename updates the strip.** After `tab.setTabName(content, "renamed")`, `tab.getActiveTabLabel()` is `"renamed"` and the entry's button reports `"renamed"`.
2. **Rename on an unknown component.** `tab.setTabName(neverAdded, "x")` returns `false` and changes no entry.
3. **A veto keeps the tab.** With a `"beforetabclose"` listener that calls `preventDefault()`, driving the user close path — invoking the private `_onBarTabClose(entryId)`, the handler the ✕ and the context menu both reach — leaves the content still parented to the host and the entry still in `_bar._entries`; no `"tabclose"` fires.
4. **No veto closes normally.** With a `"beforetabclose"` listener that does nothing, the same `_onBarTabClose(entryId)` call removes the entry and fires `"tabclose"` exactly once.
5. **`closeTab` is unguarded.** With a listener that always vetoes, `tab.closeTab(content)` still removes the tab and fires `"tabclose"` — the veto never sees the programmatic path.

### Pure modules (unit-testable, in the app repository)

`baseName` and `extensionOf` split on **both** separators, so a Windows path works:

| input | `baseName` | `extensionOf` |
|---|---|---|
| `/p/src/main.ts` | `main.ts` | `ts` |
| `C:\p\src\main.ts` | `main.ts` | `ts` |
| `/p/.gitignore` | `.gitignore` | `""` |
| `/p/Makefile` | `Makefile` | `""` |
| `/p/a.b.CSS` | `a.b.CSS` | `css` |

`joinPath` uses the separator already present in the parent, defaulting to `/`:

| parent | name | result |
|---|---|---|
| `/p/src` | `main.ts` | `/p/src/main.ts` |
| `C:\p\src` | `main.ts` | `C:\p\src\main.ts` |
| `/p/src/` | `main.ts` | `/p/src/main.ts` |

`sortDirEntries` and `languageForPath` behave as tabled in `## Internal Structure`.

### Shortcuts (manual-verify)

Each chord matches only its exact modifier set, so `Ctrl+Shift+S` never fires the `Ctrl+S` action:

| chord | action |
|---|---|
| `Ctrl/Cmd+O` | Open Folder… |
| `Ctrl/Cmd+S` | Save the active file |
| `Ctrl/Cmd+Shift+S` | Save As… |
| `Ctrl/Cmd+W` | Close the active file |
| `Alt+Shift+F` | Format the active document |
| `Ctrl/Cmd+B` | Toggle the explorer pane |

### App behaviour (manual-verify — a live CodeMirror view, native dialogs, and real files, none of which the offline harness can exercise)

1. **Open a folder.** *File → Open Folder…* shows the native directory picker. Choosing a folder replaces the tree with that folder's immediate children, directories first. Cancelling leaves the tree untouched.
2. **Lazy expansion.** Expanding a directory reads only that directory. Collapsing and re-expanding does not re-read it (`Tree` caches loaded children).
3. **Open a file.** Clicking a file row opens a tab labelled with its base name, focused, with highlighting matching the extension table. Clicking a directory row expands or collapses it and opens nothing.
4. **Re-open an open file.** Clicking a file that already has a tab activates that tab; no second tab appears and the document is not re-read from disk.
5. **Dirty marking.** Typing in the editor changes the tab label to `name •` and the window title to `• name — Loom`. Further typing changes nothing further.
6. **Save.** `Ctrl+S` writes the file, drops the `•` from both the tab and the title, and shows `Saved <name>` in the status bar for about two seconds. The file on disk matches the editor.
7. **Save with no changes.** `Ctrl+S` on a clean file is a no-op; the *Save* menu item is disabled.
8. **Save As.** *File → Save As…* opens the native save dialog defaulted to the current path. On confirm the file is written to the new path, the tab relabels to the new base name, the editor's language re-resolves from the new extension, and the file is tracked under the new path. Cancelling writes nothing and leaves the file dirty.
9. **Save As onto an already-open path** is refused with a `Dialog.error` telling the user to close that tab first. Nothing is written.
10. **Close a clean tab.** The ✕ closes it immediately with no prompt.
11. **Close a dirty tab.** The ✕ shows the *Unsaved changes* dialog. *Cancel* (and Escape, the backdrop, and the dialog's ✕) leaves the tab open and still dirty. *Don't Save* closes it and discards the edits. *Save* writes the file and then closes it.
12. **Close the last tab.** After the last tab closes, the tab area is empty, the window title is `Loom`, and the status bar's language text is blank.
13. **Close a background tab.** Closing a non-active tab leaves the active tab active and its title unchanged.
14. **A too-large file** (over 5 MB) is refused with a `Dialog.error` and opens no tab.
15. **A file that cannot be read as text** shows a `Dialog.error` naming the file and opens no tab.
16. **Format.** *Edit → Format Document* reformats a JavaScript, JSON, HTML, SQL, or Markdown file and leaves the document untouched when the formatter rejects. A CSS or Python file re-indents instead, because the app registers no formatter for them.
17. **Toggle Explorer** collapses the tree pane and restores it, with the editor absorbing the freed width.
18. **Theme.** Toggling the theme recolours the editor chrome immediately, with no reload.

---

## Verification

**In this repository:**

- `cd packages/lib && npm run typecheck && npm test` — clean, including the five new `Tab.renameAndVeto` cases.
- `cd packages/lib && npm run docs:api` — zero warnings.
- `cd packages/lib && npm run lint` — no new findings.
- `grep -rn "beforetabclose" packages/lib/src packages/lib/docs` — matches in `Tab.ts`, `docs/layouts/Tab.md`, `docs/components/TabPanel.md`, and `docs/reference/changelog/next.md`.

**In the app repository:**

- `npm run typecheck` — clean.
- `npm test` — `tests/paths.test.ts` and `tests/languages.test.ts` green.
- `grep -rn "@tauri-apps/" src/ --include=*.ts` — every match in `src/data/workspace.ts`.
- `cd src-tauri && cargo check` — clean.
- `npm run tauri:dev` — the window opens, and the whole `## Expected Behaviour` § *App behaviour* checklist passes. Exercise it against this repository's own checkout as the project folder: it has deep nesting and files covering `ts`, `json`, `md`, `mjs`, and extensionless names (`LICENSE`). It contains no `.css` or `.py` file, so confirm the two app-registered languages against a folder that has one of each.
- `npm run tauri:build` — a bundle appears under `src-tauri/target/release/bundle/`; the installed app opens a folder and saves a file with no dev server running.

---

## Documentation Impact

Only this repository's docs change; the app repository has no published API.

- `packages/lib/docs/layouts/Tab.md` — the canonical `Tab` page. Add `beforetabclose` to the *Events* table, a paragraph stating that it fires only for a user-initiated close (so `closeTab` can complete a vetoed close), and a short *Renaming a tab* section for `setTabName`.
- `packages/lib/docs/components/TabPanel.md` — its *Close hooks* section documents `tabclose`; add the `getTab().on("beforetabclose", …)` guard alongside it, since `TabPanel` deliberately mirrors no per-setter forwarder and `getTab()` is the documented route.
- `packages/lib/docs/reference/changelog/next.md` — a `### Layouts` subsection under the existing `## Added` heading, naming `Tab.setTabName` and the `"beforetabclose"` event.
- `packages/lib/llms.txt` is generated by `npm run docs:llms` and lists capabilities, not methods. No new exported component appears, so it is not regenerated.

Both new members are public on an exported class, so they need full JSDoc. Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), that JSDoc may only `{@link}` symbols that appear in the public API docs — `TabCloseController` is exported from `layout`, so linking it is fine; describe `_onBarTabClose`'s role in prose rather than naming it.

---

## Potential Challenges

- **A second copy of `@codemirror/state` silently breaks highlighting.** CodeMirror requires exactly one instance of its state package; the symlinked library plus the app's own `@codemirror/lang-*` packages make two copies possible. The `resolve.dedupe` list in step 15 is the guard — if grammars never apply, check `find node_modules -name "@codemirror" -maxdepth 4` for a nested duplicate.
- **The library APIs are unreleased while the app is built.** The app's `@jimka/typescript-ui` range stays `^0.8.0` and the symlink from step 14 is what supplies `setTabName` and `"beforetabclose"`. Move the range to the release that carries them once it ships; until then a clean `npm install` in the app repository re-installs the registry copy and must be re-symlinked.
- **A stale `packages/lib/dist/`.** `dist/` is gitignored and the symlink resolves through it, so a Phase 1 edit is invisible to the app until `npm run build:lib` re-runs. A `setTabName is not a function` at runtime means exactly this.
- **A missing Tauri permission fails at runtime, not at build time.** Rust compiles and TypeScript typechecks; only the actual call rejects. Step 40's folder-open is the real check for step 20's capability file.
- **Folders outside `$HOME` cannot be opened** under the scope in step 20. Picking one succeeds and every subsequent read fails. Widen the scope entry, or extend it at runtime from Rust, if that becomes a real limitation.
- **`readDir` returns names, not paths.** Tauri v2's `DirEntry` dropped v1's `path` field. Building child paths without `joinPath` yields a tree that expands into nothing.
- **No display server, no window.** Under WSL2, `npm run tauri:dev` builds but shows nothing without WSLg or an X server. Confirm `$DISPLAY` is set and a trivial X client renders before blaming Tauri — the same prerequisite [`plans/tauri-desktop-prototype.md`](plans/tauri-desktop-prototype.md) records.
- **`Ctrl+S` reaching the accelerator.** CodeMirror's default keymap does not bind it, so the `window` listener sees it while the caret is in the document. If a future keymap change swallows a chord, bind that chord inside the editor instead, as [`../../sqladmin/frontend`](../../sqladmin/frontend/src/shell/queryShortcuts.ts) does for its editor-scoped keys.

---

## Critical Files

Read before implementing.

**This repository:**

- [`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) — `TabEvent` (line 55), `TabOptions.listeners` (line 135), `_onBarTabClose` (line 1081), `closeEntry` (line 1097), `closeTab` (line 1169), `createTab`'s label resolution (line 1452), `getActiveContent` (line 2012), `setActiveContent` (line 2061), and the `on`/`off`/`emit` overload blocks at the bottom.
- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) — `getEntryName` (line 1447), `createBarEntry` (line 1547), and `openTabMenu` (line 1760), which shows every user close route emitting the same bar-level `"tabclose"`.
- [`packages/lib/src/typescript/lib/overlay/Drawer.ts`](packages/lib/src/typescript/lib/overlay/Drawer.ts) — `DrawerCloseController` (line 43) and `close()` (line 381). **The precedent the veto copies.**
- [`packages/lib/tests/layout/Tab.closeDisposal.test.ts`](packages/lib/tests/layout/Tab.closeDisposal.test.ts) — the harness template for the new test file.
- [`packages/lib/docs/components/CodeEditor.md`](packages/lib/docs/components/CodeEditor.md) — live-only behaviour, the language registry, `format()` semantics, and the `dispose()` contract.
- [`packages/lib/docs/components/Tree.md`](packages/lib/docs/components/Tree.md) — lazy loading, `expandTrigger`, `rowOverflow`, and `IconLabelTreeNodeRenderer`.
- [`packages/lib/docs/components/Dialog.md`](packages/lib/docs/components/Dialog.md) and [`packages/lib/src/typescript/lib/overlay/Dialog.ts`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L90) — the `onClick` guard the three-way prompt depends on.
- [`packages/lib/docs/recipes/keyboard-shortcuts.md`](packages/lib/docs/recipes/keyboard-shortcuts.md) — the library's own answer for accelerators.
- [`packages/lib/llms.txt`](packages/lib/llms.txt) — the capability index; check it before building any piece of UI this plan names.
- [`packages/create-app/index.js`](packages/create-app/index.js#L113) and [`packages/create-app/template/`](packages/create-app/template/vite.config.ts) — exactly what step 11 generates.
- [`plans/tauri-desktop-prototype.md`](plans/tauri-desktop-prototype.md) — the `src-tauri` layout and `tauri.conf.json` build-hook wiring this plan reuses, minus its sidecar machinery.

**Sibling repositories:**

- [`../../sqladmin/frontend/src/shell/SqlAdminShell.ts`](../../sqladmin/frontend/src/shell/SqlAdminShell.ts) — the shell shape (line 82), the work-area `Split` (line 210), `installAccelerators` (line 168), and `buildMenuBar` (line 372). **The precedent `EditorShell` mirrors.**
- [`../../sqladmin/frontend/COMPONENT_CONVENTIONS.md`](../../sqladmin/frontend/COMPONENT_CONVENTIONS.md) — class-first components, the super-cascade rule, arrow-field handlers, and the `callable()` export shape.
- [`../../sqladmin/frontend/src/shell/queryShortcuts.ts`](../../sqladmin/frontend/src/shell/queryShortcuts.ts) — the chord-constant plus `isXChord` matcher pattern.
- [`../../sqladmin/frontend/vite.config.ts`](../../sqladmin/frontend/vite.config.ts) and [`vitest.config.ts`](../../sqladmin/frontend/vitest.config.ts) — the symlinked-library dev-server accommodations and the node-environment test config.
- [`../../finance-tracker/plans/personal-finance-app-v1.md`](../../finance-tracker/plans/personal-finance-app-v1.md) — its Phase 10 (steps 73–75) is the worked `tauri init` + capabilities sequence for a no-backend Tauri app in this ecosystem.

---

## Non-Goals

Each is deliberately out of this phase.

- **IntelliSense, LSP, or any language service.** `CodeEditor` is documented as explicitly not providing one; adding it would mean a whole subsystem outside the library.
- **Search — across files or within one.** `CodeEditor` builds its CodeMirror extension set by hand and includes no search extension, so there is no in-file find/replace to expose either.
- **Git integration** of any kind, including a dirty-vs-committed indicator in the tree.
- **An extension or plugin system.**
- **Split-pane multi-file view.** `TabPanel` does not provide it; `Dock` would, and is the natural upgrade if it is ever wanted.[^tabpanel-not-dock]
- **New / untitled files.** Every open file has a real path, which keeps `FileEditor.getPath()` non-nullable. *Save As* covers saving a copy.
- **Filesystem watching.** The tree does not react to changes made outside the app; there is not even a manual refresh in this phase.
- **Hidden-file or `.gitignore`-aware filtering.** The tree shows every entry `readDir` returns.
- **Persisting session state** — open tabs, expanded tree nodes, the split ratio, or the last project folder — across restarts.
- **A browser build.** The app calls the Tauri plugins directly with no fallback.
- **Opening folders outside `$HOME`,** which the capability scope in step 20 excludes.
- **Code signing, auto-update, and a multi-platform bundle matrix.** `npm run tauri:build` produces an unsigned local bundle only.

---

## Implementation Notes

**No typed `off("beforetabclose", …)` overload.** The Public API section lists an `off` overload for `"beforetabclose"` alongside `on` and `emit`, but `Tab` has no per-event `off` overloads for *any* of its existing events — `off(event: TabEvent, listener: Function): this` is the sole, untyped catch-all, the same shape `Drawer.off` (the cited precedent) uses. Adding a single typed overload just for `"beforetabclose"` would be inconsistent with every other `Tab` event and would shadow, rather than complement, the existing catch-all signature. `TabEvent` already includes `"beforetabclose"`, so `off("beforetabclose", fn)` type-checks against the catch-all exactly like `off("tabclose", fn)` does. No `off` overload was added; the catch-all covers it.

**`EditorController.saveActiveAs()` (loom repository).** `AcceleratorActions.onSaveAs` and the File menu's *Save As…* item are both zero-argument, but `saveAs(file)` — the command step 31 calls for — takes a `FileEditor`, and `EditorController` exposes no public accessor for "the active file" (only the `hasActiveFile()` / `isActiveDirty()` predicates the plan names). `saveActiveAs(): Promise<void>` was added as a thin wrapper — resolve the active file, then call `saveAs(file)` — mirroring the `save`/`saveActive` pairing the plan already specifies. `EditorShell`'s `onSaveAs` action, the *Save As…* item, and the `Ctrl/Cmd+Shift+S` accelerator all call it.

**Re-clicking an already-open file's tree row does not re-activate its tab (loom repository).** Expected Behaviour § *App behaviour* item 4 asks for this, and step 27 wires it through `Tree`'s `"selection"` event exactly as specified — but `Tree._notifySelectionChange` fires only on a *change* to the selected-node set, so re-clicking a row that is already the sole selection (e.g. after switching to another tab via the strip, then clicking the first file's row again) emits nothing and `FileTree` never learns of it. `Tree` does expose a lower-level activation signal — `"dblclick"`, documented as "layered on top of selection" and emitted unconditionally, with no selection-set comparison — but it fires on a *double*-click, not the single click Expected Behaviour item 4 describes, so wiring it would not close this specific gap (it would only add a *different*, unrequested double-click-to-reopen affordance). Closing the literal gap needs either a `Tree` API change (a click-level, not just selection-level, event — out of scope for this plan's two library additions) or a deliberately-scoped exception to reach past `Tree`'s own event surface, which `ARCHITECTURE.md`'s event-handling rule reserves for named carve-outs `FileTree` is not one of. Left as a known limitation rather than worked around here.

---

## Notes

[^why-library-first]: Both additions were reached only after checking that the app could do without them. `TabBar` bakes a tab's label into a `TabButton` at [`createBarEntry`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1547) and exposes `getEntryName` but no setter, and `Tab` reads the label once in [`createTab`](packages/lib/src/typescript/lib/layout/Tab.ts#L1452) — nothing anywhere re-reads `Component.getName()`, so a live tab cannot be relabelled at all. Separately, the whole close path is unconditional: `Tab.closeEntry` removes the cell and the content and only *then* emits `"tabclose"`, so a listener learns about a close it can no longer stop. Two workarounds were weighed and rejected. Re-adding the content from inside `"tabclose"` (which does suppress the disposal, since the component has an owner again by the destroy check) sends the tab to the end of the strip and loses its position — unacceptable for an editor. Making editor tabs non-`closeable` removes the ✕ *and* greys out the context menu's *Close*, leaving the menu as the only way to close a file. The two additions together are about sixty lines and both copy a shape the library already has.

[^scaffold-then-edit]: `scaffold()` refuses a non-empty target directory and substitutes the package name from the directory name, so running it into a fresh `loom/` is the whole setup. Writing the five starter files by hand instead would drift from the template the moment it changes — most visibly in `vite.config.ts`, whose `keepNames` block encodes a hard requirement (the library derives every CSS class from `constructor.name`) whose current correct spelling depends on the Vite major the template targets.

[^tauri-minimal]: The two hardened follow-ups to [`plans/tauri-desktop-prototype.md`](plans/tauri-desktop-prototype.md) build a random-port handshake, a per-launch bearer token, a frozen sidecar binary, and a CORS allowlist. Every one of those exists to defend a **network-exposed local HTTP backend** that other processes on the machine could reach. This app has no backend, opens no socket, and makes no HTTP request, so none of that machinery has anything to protect. Its whole attack surface is which paths the webview may read and write, which Tauri's own capability file already expresses. Deliberately doing less than those plans is the point, not an oversight.

[^tauri-only]: A browser fallback was considered and dropped. `../../finance-tracker/plans/personal-finance-app-v1.md` needs one because that app genuinely ships two ways — a desktop build and a cloud deployment — and picks between them with `isTauri()`. This app has exactly one deployment. A browser mode would need a whole second filesystem implementation (the File System Access API, or an in-memory stub) that no user ever runs, to make `npm run dev` in a tab do something. Development goes through `npm run tauri:dev` instead, which starts the same Vite dev server and gives hot reload inside the real window.

[^tabpanel-not-dock]: `Dock` was the other candidate and would hand split-pane editing over for free, since it composes `Split` and `Tab` already. It was rejected for this phase because it also brings tear-off floating windows, a panel registry keyed on stable serializable ids, `DockRegion` edge-drop targets, and layout save/restore — none of which phase one uses, all of which have to be reasoned about anyway. It also widens the close guard: `Dock`'s own `close` event fires *after* the panel is destroyed, so the veto would have to be threaded through `Dock` as well as `Tab`. `TabPanel` needs neither. If split-pane editing is wanted later, swapping `TabPanel` for `Dock` is a contained change: the controller already addresses tabs by their `FileEditor` component, which is what `Dock` registers as panel content.

[^editor-per-file]: `setValue` [dispatches an ordinary transaction](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L347) against the same `EditorState`, so a shared editor would carry one undo history across every file — `Ctrl+Z` after a tab switch would undo an edit made in a different file. Cursor position and scroll offset would be lost on every switch for the same reason. Those are not cosmetic gaps in a code editor. The cost of the chosen design is one live CodeMirror view per open file, which is what any tabbed editor pays.

[^fileeditor-earns-its-class]: ARCHITECTURE.md's *Compose before specializing* asks whether a new component removes more complexity than it adds. A bare `CodeEditor` as tab content would arguably work — `Tab` sizes its content to the region — but `CodeEditor`'s own documentation asks for a sized host (a `Fit` panel or an explicit preferred size), so a wrapper is the documented arrangement anyway. Given a wrapper exists, `FileEditor` is where the file's path, its dirty flag, and its `"change"` subscription belong: that is coordination, not arrangement, and putting it there keeps the controller from maintaining a parallel side-map keyed by component. It extends `Container` rather than `Panel` because `Panel` carries a 4px content inset that would frame the editor — the same reason `ActivityBar` extends `Container` in [`../../sqladmin/frontend/COMPONENT_CONVENTIONS.md`](../../sqladmin/frontend/COMPONENT_CONVENTIONS.md).

[^lazy-tree]: Reading a whole project tree up front is unbounded work on a folder containing `node_modules`, `target`, or `.git`, and every byte of it is thrown away for the directories the user never opens. `Tree` supports lazy children natively — `hasChildren: true` renders the caret before the children exist, the row shows a spinner during `loadChildren`, and the resolved children are cached so a collapse/re-expand never refetches — so this costs no extra machinery.

[^dirty-flag]: Deriving dirtiness by comparing the document against the last-written text would clear the marker when a user undoes back to the saved state, which is marginally nicer. It also runs a full string comparison on every keystroke, which is linear in file size — the wrong trade on the multi-megabyte files this editor is expected to open. The flag is one boolean, set once per dirty run.

[^three-way-dialog]: [`DialogResult`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L46) is exactly `'confirm' | 'cancel' | 'close'`, so three buttons cannot each resolve to a distinct value. Mapping *Don't Save* onto `'close'` was considered and rejected outright: `'close'` is also what Escape, a backdrop click, and the title-bar ✕ produce, so pressing Escape would silently discard the user's edits. The `onClick` guard is a supported field whose documented purpose is to run before the dialog closes; assigning a closure variable from it and returning `true` leaves the resolved `DialogResult` unused and makes every non-button dismissal fall through to the `"cancel"` initial value, which is the safe default.

[^veto-user-path-only]: Guarding `closeEntry` instead would guard everything, including `closeTab` — and then a listener that vetoes a close and later calls `closeTab` to complete it would re-enter its own veto forever. Splitting them at `_onBarTabClose` is not a compromise: `closeTab` is already documented as *the programmatic entry point for a tree owner such as `Dock` to close a panel*, so the two paths already mean different things. Every user route converges on the bar's `"tabclose"` emit — the ✕ button, the context menu's *Close* row, and all four bulk-close rows, as [`openTabMenu`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1760) shows — so one gate at `_onBarTabClose` covers them all. Note the consequence for bulk close: a *Close all* over several dirty files fires one veto per file and would stack several prompts, so the app answers the first and leaves the rest open; sequencing bulk closes is not in this phase.
