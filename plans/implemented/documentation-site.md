# Documentation Site — Implementation Plan

## Overview

`@jika/typescript-ui` ships as an npm package (ESM + UMD + `.d.ts`) but has no consumer-facing documentation site. The current [README.md](../README.md) is a strong single-page reference and TypeDoc is wired up via `npm run doc`, but a developer installing the package via npm has no getting-started flow, no per-component pages, no live examples, and no searchable API browser.

The goal is to build a complete, hosted documentation site for developers consuming the framework as a dependency. Decisions locked in:

- **Tooling:** VitePress for guides + `typedoc-plugin-markdown` to emit API pages that VitePress renders alongside guides (one unified site).
- **Scope:** Complete coverage — every public component/layout/data class gets a page, plus recipes, accessibility, performance, FAQ, and full API reference.
- **Hosting:** GitHub Pages, deployed via a GitHub Action on push to `master`.

The framework's mental model is unusual (Java Swing-inspired absolute positioning, manual `doLayout()`, no flex/grid), so conceptual docs are load-bearing — without them, the API alone misleads readers used to React/HTML-flow conventions.

---

## Documentation Types In Scope

| Type | Location | Purpose |
|---|---|---|
| Getting started | `docs/guide/` | Install, first app, mental model |
| Conceptual guides | `docs/concepts/` | Lifecycle, layout, sizing, events, theming, data, a11y, perf |
| Component reference | `docs/components/` | One page per public component |
| Layout reference | `docs/layouts/` | One page per `LayoutManager` |
| Data layer | `docs/data/` | Model, Store, Proxy, Binding, Validation, Worker |
| Recipes / cookbook | `docs/recipes/` | Task-oriented end-to-end snippets |
| API reference | `docs/api/` | Auto-generated from TSDoc via TypeDoc |
| Reference | `docs/reference/` | Glossary, FAQ, troubleshooting, browser support, migration, changelog |

---

## Tooling Setup

### VitePress + TypeDoc plugin

- New `docs/` directory at repo root with VitePress project (`docs/.vitepress/config.ts`, `docs/.vitepress/theme/`).
- New devDependencies in [package.json](../package.json): `vitepress`, `typedoc-plugin-markdown`, `typedoc-vitepress-theme` (or equivalent).
- New `typedoc.json` at repo root: entry `src/typescript/Base/index.ts`, `plugin: typedoc-plugin-markdown`, exclude private members, group via TSDoc `@category` tags, output to `docs/api/`.
- VitePress `base` config set to `/<repo-name>/` for GitHub Pages subpath.

### `package.json` script changes

```json
"scripts": {
    "docs:api":     "typedoc",
    "docs:dev":     "vitepress dev docs",
    "docs:build":   "npm run docs:api && vitepress build docs",
    "docs:preview": "vitepress preview docs"
}
```

Replace the existing `doc` script with `docs:api` (or keep both during transition).

### GitHub Pages deploy

- New `.github/workflows/docs.yml` runs `npm ci && npm run docs:build` on push to `master`, deploys `docs/.vitepress/dist` via `actions/deploy-pages`.
- Repository **Settings → Pages** must be set to "GitHub Actions" source.

---

## TSDoc Pass on Public Surface

The public surface (everything re-exported from [src/typescript/Base/index.ts](../src/typescript/Base/index.ts), 156 lines) currently has minimal JSDoc. To produce a useful API reference:

- One-line summary `/** ... */` on every exported class.
- `@param`, `@returns`, `@example` on non-trivial public methods (constructors, side-effecting setters, event listeners).
- `@category` tags so TypeDoc groups output: `Core`, `Component`, `Layout`, `Data`, `Theme`, `Validation`, `Util`.
- `@internal` on public-but-not-user-facing methods. `Component` exposes ~95 methods — many should drop out of generated docs.

Estimated ~50–80 files touched, each touch small. Largest single line-item by effort.

Prioritise based on `graphify-out/GRAPH_REPORT.md` god nodes: `Component` (140 edges), `Text` (35), `Table` (30), `Insets` (25), `Button` (24), `ModelRecord` (22), `ComboBox` (22), `Header` (18), `Cell` (18), `Label` (17).

---

## Site Information Architecture

VitePress sidebar groups in this order:

```
- Guide          (getting started, first app, mental model)
- Concepts       (lifecycle, layout, sizing, events, theming, data, a11y, performance)
- Components     (alphabetised within sub-groups)
- Layouts        (one per LayoutManager)
- Data           (model, store, proxy, binding, validation, worker)
- Recipes        (task-oriented)
- API Reference  (auto-generated)
- Reference      (glossary, FAQ, troubleshooting, browser support, changelog, migration)
```

Top navbar: Guide · Components · API · GitHub.

---

## Page Inventory

### Guide (`docs/guide/`)

- `index.md` — what the framework is, when to use it, when not to.
- `installation.md` — `npm install @jika/typescript-ui`, FontAwesome peer dep, `moduleResolution: "bundler"` requirement, Vite/Webpack/Rollup notes.
- `first-app.md` — bootstrap `Body`, attach a `Window` with a `Button`, run dev server. Output screenshot.
- `mental-model.md` — **critical**: absolute positioning, the component tree, `doLayout()`, deferred DOM via `getElement()`, why this is not React.

### Concepts (`docs/concepts/`)

- `component-lifecycle.md` — construction → `addComponent()` → `getElement()` → `render()` → `doLayout()` → `dispose()`/`destructor()`.
- `layout-system.md` — `LayoutManager` constraint resolution, fill/anchor, `placeComponent()`, when to call `doLayout()` manually.
- `sizing.md` — preferred/min/max size, `setSize()` vs `setPreferredSize()`, why pixel units matter.
- `events.md` — the `Event` class, `addListener` vs `addSubtreeListener`, hover events (mouseover/out, not enter/leave).
- `theming.md` — promote and expand the existing README theming section.
- `data-binding.md` — Model/Store/Proxy/ModelRecord overview; the `Bindable` interface; `Binding` class.
- `accessibility.md` — `Aria.ts`, `RovingTabIndex.ts`, keyboard nav patterns, ARIA per component.
- `performance.md` — `pauseLayout`/`resumeLayout`, virtual scrolling in `Table.Body` and `Tree`, `dispose()` to detach theme listeners, avoiding O(N²) CSS `insertRule` patterns.

### Components (`docs/components/`)

Every public component gets a page with: one-line summary, screenshot, code example, common-props table, events, a11y notes, gotchas, link to API page. Grouped as sidebar sections:

- **Core:** Component, BaseObject, Body, Window, Dialog, ContextMenu, Tooltip, Notification.
- **Buttons:** Button, ToggleButton, RadioButton, ButtonGroup, SpinButton, TabCloseButton.
- **Inputs:** TextField, TextArea, PasswordField, Input, TextInput, Checkbox, ComboBox, AutoCompleteField, DateField, TimeField, NumberSpinner, Slider.
- **Display:** Label, Header, Text, Image, FontAwesomeIcon, FieldSet, Legend.
- **Lists:** List, ListItem, MultiSelectList, BulletedList, NumberedList, Option.
- **Menus:** MenuBar, MenuBarButton, MenuItem, MenuPanel, MenuSeparator, ContextMenuItem, ContextMenuSeparator.
- **Layout primitives:** SplitGutter, WindowBorder, WindowHeader, AccordionHeader, DialogBackdrop.
- **Table:** Table, table.Body, table.Header, table.Footer, table.Row, cells (Boolean, Number, String, Header), editors, renderers.
- **Tree:** Tree, TreeNode, TreeRow.

### Layouts (`docs/layouts/`)

One page per layout manager with visual diagram, code example, constraints reference: `Absolute`, `Accordion`, `Border`, `Card`, `Column`, `Fit`, `Grid`, `HBox`, `Row`, `Split`, `Tab`, `Table`, `VBox`. Plus a shared concepts page covering `LayoutConstraints`, `AnchorType`, `FillType`, `Placement`.

### Data (`docs/data/`)

- `model.md` — defining schemas via `Model` and `AbstractModel`; field types; `mapping`.
- `store.md` — `Store`, `AbstractStore`, `MemoryStore`, sort/filter/find, events.
- `proxy.md` — `Proxy`, `MemoryProxy`, `AjaxProxy`, custom proxies.
- `record.md` — `ModelRecord`, dirty tracking, `commit`/`reject`.
- `binding.md` — `Binding`, `Bindable`, explicit accessors, listener callbacks.
- `validation.md` — `Validator`, `ValidationRule`, `FieldDecorator`, `ValidationResult`, error display patterns.
- `worker.md` — `StoreWorker`/`StoreWorkerClient`.

### Recipes (`docs/recipes/`)

- `crud-table.md` — full CRUD with `Table` + `Store` + `AjaxProxy`.
- `bind-form.md` — bind a record to a form, validate, commit.
- `custom-theme.md` — build a brand theme from `DefaultTheme`.
- `floating-window.md` — draggable/resizable `Window` with custom content.
- `keyboard-shortcuts.md` — wire `MenuBar` accelerators.
- `virtualized-list.md` — large datasets with `Tree` / `Table.Body`.
- `right-click-menu.md` — `ContextMenu.show(x, y, items)`.
- `notifications.md` — toast patterns.
- `custom-cell.md` — custom `Cell` editor + renderer.
- `dialog-modal.md` — `Dialog.show()` / async result.

### Reference (`docs/reference/`)

- `glossary.md` — Component, Body, BaseObject, LayoutManager, Bindable, Proxy, Store, ModelRecord, Theme, Insets, etc.
- `faq.md` — `moduleResolution: "bundler"`, missing `px` units in custom CSS, Safari support, why no flexbox.
- `troubleshooting.md` — common runtime errors, layout diagnostics (`pauseLayout` debugging).
- `browser-support.md` — Chrome/Firefox tested, Safari unverified per [README.md](../README.md).
- `migration.md` — version-to-version breaking changes (empty for v1).
- `changelog.md` — generated or hand-written per release.

---

## Live Examples

Every component / layout page should have a runnable code block. For v1, code blocks are **static markdown** — embedding live demos via VitePress' Vue components is a future enhancement (would require shimming the framework's absolute-positioning model into a constrained iframe). Static screenshots come from the existing demo panels (`*Panel.ts`).

---

## Suggested Implementation Order

1. **Infra** — VitePress + TypeDoc plugin scaffold, scripts, GH Action skeleton (deploy a stub site). Confirms hosting end-to-end before content scaling.
2. **Migrate README** — split README into concept pages so the site has real content immediately. Trim README to a short overview that links to the doc site.
3. **TSDoc pass** — annotate public surface; first generated API pages land.
4. **Component pages** — one batch per group (Core → Buttons → Inputs → Display → Lists → Menus → Table → Tree). Each batch independently shippable.
5. **Layouts pages** — one per `LayoutManager`.
6. **Data layer pages** — Model/Store/Proxy/Binding/Validation/Worker.
7. **Recipes** — task-oriented examples, drawn from demo panels.
8. **Reference & polish** — glossary, FAQ, troubleshooting, browser support.
9. **Search** — VitePress built-in local search; optionally swap for Algolia DocSearch later.

---

## Existing Utilities To Reuse

- `npm run doc` is already wired to TypeDoc — replace its output target rather than introducing a parallel pipeline.
- [README.md](../README.md) already documents architecture, layouts, components, theming, and data layer in prose form. Migrate sections rather than rewriting from scratch.
- `graphify-out/GRAPH_REPORT.md` lists god nodes — useful for prioritising which classes need the most thorough TSDoc.
- Demo panels (`*Panel.ts`) are working code examples for every layout and several components — extract their snippets into recipe pages.

---

## Critical Files

- [package.json](../package.json) — add `docs:*` scripts and devDependencies.
- [src/typescript/Base/index.ts](../src/typescript/Base/index.ts) — TypeDoc entry point; the public surface lives here.
- New `typedoc.json` at repo root — TypeDoc config.
- New `docs/.vitepress/config.ts` — VitePress site config (sidebar, navbar, base path).
- New `.github/workflows/docs.yml` — GitHub Pages deploy.
- [README.md](../README.md) — trim to a short overview that links to the doc site.
- Public-surface source files for TSDoc additions (~50–80 files under `src/typescript/Base/`).

---

## Verification

- `npm run docs:dev` serves the site on a local port; sidebar navigation works, code blocks highlight, internal links resolve.
- `npm run docs:build` produces `docs/.vitepress/dist` with no broken-link warnings (VitePress flags these by default).
- TypeDoc-generated API pages render under `/api/` with no missing-export warnings.
- The GitHub Action runs end-to-end on a feature branch (manual `workflow_dispatch`) before being wired to `master`.
- Manual smoke test: walk the getting-started flow against a fresh `npm install @jika/typescript-ui` in a scratch project — every code snippet should compile and run.
- Spot-check three component pages and three recipes by copying their code into the demo and confirming behaviour matches description.
- Run `npm run typecheck` after the TSDoc pass — comments must not break the build.

---

## Out of Scope For v1

- Live in-browser playground (would need iframe sandboxing for the absolute-positioning model).
- Versioned docs (single version for now; revisit when v2 lands).
- i18n / translated docs.
- Algolia DocSearch (start with VitePress' built-in local search).
- Contributor / internals guide (this plan targets framework-consumer perspective only).
