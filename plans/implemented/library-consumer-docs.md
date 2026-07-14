# Library Consumer Onboarding Docs — Implementation Plan

## Overview

Two documentation gaps logged by the sqladmin demo app (an external consumer of `@jimka/typescript-ui`) share one theme: onboarding a local/external consumer. This plan adds two pages to the VitePress docs site under [docs/](docs) and wires them into the sidebar/nav and the relevant overview pages.

1. **Constructing components** — a *concept* page that gives the callable-shorthand construction idiom a discoverable, authoritative home and, crucially, states the **definitive rule for which exports are `callable()`-wrapped vs. which require `new`**, grounded in library source. Today the idiom is only partially documented across [docs/recipes/component-options.md](docs/recipes/component-options.md) and [docs/guide/mental-model.md](docs/guide/mental-model.md#L35), and the callable-vs-not distinction appears only as a passing sentence in the recipe ([docs/recipes/component-options.md:219](docs/recipes/component-options.md#L219)).
2. **Local development against the library** — a *recipe* documenting the Vite dev-server config needed to consume a symlinked local checkout (`file:../typescript-ui`), grounded in sqladmin's actual [frontend/vite.config.ts](../sqladmin/frontend/vite.config.ts).

This is a **documentation-only** plan: no source under `src/` changes. The sidebar/nav lives in [docs/.vitepress/config.mts](docs/.vitepress/config.mts).

---

## Architecture Decisions

### Page 1 goes in `concepts/`, not `guide/` or a new recipe

The construction idiom is already covered as a how-to in the `component-options` recipe and as an expression shape in `mental-model`. What is missing is a *conceptual, authoritative* page: why the callable form works (the `callable()` Proxy mechanism preserving `new` / `instanceof` / `extends`) and the exact set of callable vs. non-callable exports. That mechanism-explanation role is exactly what `concepts/` holds ([component-lifecycle](docs/concepts/component-lifecycle.md), [layout-system](docs/concepts/layout-system.md), [dom-seams](docs/concepts/dom-seams.md)). Placing it in `concepts/` keeps the tight 3-page linear Guide (Introduction → Installation → Mental model) intact while giving the idiom a discoverable home. The existing recipe stays the cookbook; this page owns the *rule* and cross-links to the recipe for examples — no duplication of the example gallery.

### Page 1 does not duplicate the recipe's example gallery

`component-options.md` already has an extensive example gallery (naming a panel, styling a label, combo box, listeners, layout managers, data-layer options). Page 1 references it rather than repeating it. Page 1's unique payload is: (a) the `callable()` mechanism, (b) the callable-vs-not table + the source rule for deriving it.

### Page 2 is a recipe, not a guide edit

`guide/installation.md` already has a "Development setup" section — but that is for working *on the framework itself* (clone + `npm run dev`). Consuming a *linked local checkout from another app* is a distinct task-oriented flow, which is what `recipes/` is for. It gets a new recipe file and a new sidebar group.

### The callable-vs-not list is derived from source, not hand-maintained

The authoritative rule (see `## Source of Truth`) is: a class is callable **iff its module wraps it with `callable()`** and re-exports the wrapper under the public name. Every `component/`, `layout/`, `overlay/` class and the core containers do this; the entire `data/` layer never does. The page states the *rule* and lists the categories, so it stays correct as classes are added — rather than enumerating 150+ individual class names that would rot.

---

## Content Outline

### Page 1 — `docs/concepts/construction.md` — "Constructing components"

Title: `# Constructing components`

Sections:

1. **Two ways to construct** — every component/layout can be built with or without `new`; both produce the same instance.
   ```typescript
   const a = Button("Save");      // callable shorthand — no `new`
   const b = new Button("Save");  // classic — identical result
   a instanceof Button;           // true
   ```
   State that the bare-call form is preferred for nested trees because it removes `new` clutter, and link to [mental model — JSX-shaped, without JSX](/guide/mental-model#jsx-shaped-without-jsx) for the expression shape.

2. **The options bag and nesting** — brief: components/layouts/stores take a trailing options object mapping to setters; `layoutManager:` and `components:` (array of children or `{ component, constraints }`) express a tree in one expression. Show ONE compact nested example (Panel + HBox + components), then link to [Construct components from an options object](/recipes/component-options) for the full gallery. Do **not** re-list every option example.
   ```typescript
   Panel({
       layoutManager: HBox({ spacing: 10 }),
       components: [Button("OK"), Text("hello")]
   });
   ```

3. **Which exports are callable** — the load-bearing new content. A table:

   | Category | Callable (`Foo(...)` **or** `new Foo(...)`) | Source location |
   | --- | --- | --- |
   | UI components | ✅ every `Component` subclass — buttons, inputs, display, lists, tables, trees, menus, charts, containers, diagram | `src/typescript/lib/component/**` |
   | Core containers | ✅ `Component`, `Container`, `Panel`, `Form`, `AnimatedDropdown` | `src/typescript/lib/core/` |
   | Overlays | ✅ `Window`, `TabWindow`, `Dialog`, `Drawer`, `Rail`, `Dock`, `Menu`, `Popover`, `Tooltip`, `ButtonGroup`, … | `src/typescript/lib/overlay/` |
   | Layout managers | ✅ `HBox`, `VBox`, `Border`, `Grid`, `Fit`, `Card`, `Tab`, `Split`, `Accordion`, `Absolute`, `Anchor`, `HFlow`, `VFlow` | `src/typescript/lib/layout/` |
   | **Data layer** | ❌ **require `new`** — `Model`, `Field`, `ModelRecord`, `Association`, `Store`, `MemoryStore`, `AjaxStore`, `TreeStore`, `TreeNode`, `Proxy`, `MemoryProxy`, `AjaxProxy`, `WebStorageProxy`, `JsonReader`, `JsonWriter` | `src/typescript/lib/data/**` |

   Concrete contrast the reader will hit:
   ```typescript
   const store = new MemoryStore({ model: PersonModel, data: people }); // `new` REQUIRED — data layer
   const table = Table(store);                                          // callable — Component subclass
   ```

4. **Why it works / how to tell** — one short paragraph: the callable form comes from [`callable()`](/api/core/functions/callable) (a `Proxy` forwarding `[[Call]]` to `Reflect.construct`), which is why `instanceof`, `new`, and `extends` all still work on the wrapped export. The rule for telling whether an export is callable: its module wraps the class and re-exports the wrapper as the public name (the raw class ships as `_Foo`, the callable wrapper as `Foo`). The `data/` layer never applies this wrapper. (Cite [Callable.ts](src/typescript/lib/core/Callable.ts).)

5. **See also** — links to `/recipes/component-options`, `/guide/mental-model#jsx-shaped-without-jsx`, `/concepts/data-binding`.

### Page 2 — `docs/recipes/local-development.md` — "Local development against the library"

Title: `# Local development against a linked library checkout`

Sections:

1. **When you need this** — you are developing your app against a local checkout of `@jimka/typescript-ui` (not the npm release), linked via a `file:` dependency, to test unreleased library changes.

2. **Link the checkout** — in the consuming app's `package.json`:
   ```json
   { "dependencies": { "@jimka/typescript-ui": "file:../typescript-ui" } }
   ```
   State the critical prerequisite: the package's `exports` map points at **built** artifacts (`./dist/lib/*.es.js`), so the linked checkout must be built before the app resolves it — run `npm run build:lib` in the library, and **re-run it after every library source edit** (a plain `npm run build` builds the demo app, not the lib bundles). Link to [Installation → Build commands](/guide/installation#build-commands).

3. **Vite config recipe** — grounded verbatim in sqladmin's [frontend/vite.config.ts](../sqladmin/frontend/vite.config.ts). Present the minimal block and explain each line with the symptom it fixes:
   ```typescript
   import { defineConfig } from "vite";

   export default defineConfig({
       esbuild: { keepNames: true },
       server: { fs: { strict: false } },
       resolve: { dedupe: ["@jimka/typescript-ui"] },
       optimizeDeps: { exclude: ["@jimka/typescript-ui"] },
   });
   ```

   | Setting | Why | Symptom without it |
   | --- | --- | --- |
   | `server.fs.strict: false` | the linked package lives outside the app's project root | Vite refuses to serve files "outside of the workspace root" |
   | `resolve.dedupe: ["@jimka/typescript-ui"]` | force a single instance of the linked ESM package | duplicate instances → `instanceof` checks fail, theme/singletons split |
   | `optimizeDeps.exclude: ["@jimka/typescript-ui"]` | skip dep pre-bundling for the linked source | stale pre-bundle ignores live library edits; double-bundling |
   | `esbuild.keepNames: true` | the library derives CSS classes and Dock serialization keys from `constructor.name`; the minifier must not mangle class names | app renders unstyled / layout save-restore breaks (mirrors the library's own build `keepNames`) |

   Note that `keepNames` matters only for the **production** build (`vite build`), while the other three are dev-server settings — but all four are safe to set unconditionally.

4. **App-specific extras (not part of the recipe)** — call out that sqladmin's config also has a `server.proxy` `/api` → backend entry; that is app-specific request routing, unrelated to linking the library, and is shown only so readers recognise it in the reference config.

5. **See also** — `/guide/installation`, `/concepts/theming` (for why `constructor.name` / CSS scoping matters).

---

## Ordered Implementation Steps

1. **Create `docs/concepts/construction.md`** with the Page 1 outline above. Use root-absolute links without `.md` (site uses `cleanUrls`), e.g. `/recipes/component-options`, `/guide/mental-model#jsx-shaped-without-jsx`, `/api/core/functions/callable`. Match the existing concept-page tone (short, declarative, code-first).

2. **Create `docs/recipes/local-development.md`** with the Page 2 outline above. Keep the Vite block identical in spirit to [sqladmin/frontend/vite.config.ts](../sqladmin/frontend/vite.config.ts); do not invent settings not present there.

3. **Register Page 1 in the sidebar** — [docs/.vitepress/config.mts](docs/.vitepress/config.mts), the `'/concepts/'` sidebar array (lines 45–59). Add `{ text: 'Constructing components', link: '/concepts/construction' }` in the `items` list — place it right after `Component lifecycle` (it is foundational construction knowledge).

4. **Register Page 2 in the sidebar** — same file, the `'/recipes/'` sidebar array (lines 217–241). Add a new group after "Construction patterns":
   ```typescript
   { text: 'Local development', collapsed: false, items: [
       { text: 'Linking a local library checkout', link: '/recipes/local-development' },
   ] },
   ```

5. **Add Page 1 to the Concepts overview** — [docs/concepts/index.md](docs/concepts/index.md), the "Pages" bullet list. Add `- [Constructing components](/concepts/construction) — callable shorthand, options bags, and which exports need \`new\`.` after the lifecycle bullet.

6. **Add Page 2 to the Recipes overview** — [docs/recipes/index.md](docs/recipes/index.md). Add a new `## Local development` section with `- [Linking a local library checkout](/recipes/local-development) — Vite config for consuming a \`file:\` symlinked checkout.`

7. **Add discoverability cross-links (small edits to existing pages):**
   - [docs/guide/mental-model.md](docs/guide/mental-model.md) "Next steps" list (lines 127–132): add `- [Constructing components](/concepts/construction) — callable shorthand and the callable-vs-\`new\` rule.`
   - [docs/recipes/component-options.md](docs/recipes/component-options.md): near the callable-vs-not sentence ([line 219](docs/recipes/component-options.md#L219)) and the "Calling components and layouts without `new`" section ([line 232](docs/recipes/component-options.md#L232)), add a link to `/concepts/construction` as the authoritative reference for which exports are callable.
   - [docs/guide/installation.md](docs/guide/installation.md) "Development setup" section (line 56): add a one-line pointer to `/recipes/local-development` for consumers linking a local checkout into their own app.

8. **Build the docs** — from repo root run `npm run docs:build`; expect success (config has `ignoreDeadLinks: true`, so dead links will not fail the build — nav wiring must therefore be verified manually per `## Verification`).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Create | `docs/concepts/construction.md` |
| Create | `docs/recipes/local-development.md` |
| Modify | `docs/.vitepress/config.mts` (concepts + recipes sidebar entries) |
| Modify | `docs/concepts/index.md` (Pages list) |
| Modify | `docs/recipes/index.md` (new Local development section) |
| Modify | `docs/guide/mental-model.md` (Next steps cross-link) |
| Modify | `docs/recipes/component-options.md` (cross-links to construction concept) |
| Modify | `docs/guide/installation.md` (pointer to local-development recipe) |

---

## Source of Truth

The callable-vs-not content must stay accurate against source. The rule and its verification:

- **Rule:** a class is callable iff its module ends with `const FooCallable = callable(Foo); export { Foo as _Foo, FooCallable as Foo }` (pattern seen in [Button.ts](src/typescript/lib/component/button/Button.ts), [HBox.ts](src/typescript/lib/layout/HBox.ts)). The wrapper is [`callable()`](src/typescript/lib/core/Callable.ts) — a `Proxy` whose `apply` trap calls `Reflect.construct`, preserving `new` / `instanceof` / `extends`.
- **Verify callable set (non-zero):** `grep -rln "callable(" src/typescript/lib/component src/typescript/lib/layout src/typescript/lib/overlay` — 160 files at write time.
- **Verify data layer is NOT callable (must be zero):** `grep -rln "callable(" src/typescript/lib/data/` — 0 matches at write time. If this ever returns matches, the table's "Data layer ❌" row is stale and must be revisited.
- **Non-callable class names** come from the `data/` barrel [src/typescript/lib/data/index.ts](src/typescript/lib/data/index.ts) (`Model`, `Field`, `ModelRecord`, `Association`, `Store`, `MemoryStore`, `AjaxStore`, `TreeStore`, `TreeNode`, `Proxy`, `MemoryProxy`, `AjaxProxy`, `WebStorageProxy`, `JsonReader`, `JsonWriter`).

The Vite recipe's source of truth is [sqladmin/frontend/vite.config.ts](../sqladmin/frontend/vite.config.ts) (the four settings and the inline rationale comments there).

---

## Expected Behaviour

Doc-only; behaviour is documentation correctness and site wiring:

- `docs/concepts/construction.md` and `docs/recipes/local-development.md` exist and render.
- The Concepts sidebar shows "Constructing components"; the Recipes sidebar shows a "Local development" group with "Linking a local library checkout". (Manual — VitePress sidebar.)
- The Concepts overview and Recipes overview pages each link to the new page. (Manual.)
- Cross-links from `mental-model`, `component-options`, and `installation` resolve to the new pages. (Manual — `ignoreDeadLinks` means the build will not catch a wrong slug; click through in `docs:dev`.)
- The callable-vs-not table matches the two `grep` invariants in `## Source of Truth`. (Automatable via grep.)

---

## Verification

- **Docs build:** `npm run docs:build` — completes without error.
- **Nav + links smoke test:** `npm run docs:dev`, then in the browser confirm: (a) Concepts sidebar lists "Constructing components" and it opens `construction`; (b) Recipes sidebar shows the "Local development" group and it opens `local-development`; (c) the overview-page bullets and the three cross-links (mental-model Next steps, component-options, installation) navigate correctly. Manual because `ignoreDeadLinks: true` suppresses build-time link failures.
- **Callable-list accuracy:** run the two greps in `## Source of Truth`; the data-layer grep must return 0, the component/layout/overlay grep must return a large non-zero count. If either flips, the table is wrong.

---

## Critical Files

- [docs/.vitepress/config.mts](docs/.vitepress/config.mts) — sidebar/nav registration (concepts array ~L45, recipes array ~L217).
- [docs/recipes/component-options.md](docs/recipes/component-options.md) — existing construction how-to; Page 1 must complement, not duplicate it.
- [docs/guide/mental-model.md](docs/guide/mental-model.md) — "JSX-shaped" section the concept page links to.
- [src/typescript/lib/core/Callable.ts](src/typescript/lib/core/Callable.ts) — the `callable()` mechanism.
- [src/typescript/lib/component/button/Button.ts](src/typescript/lib/component/button/Button.ts) — canonical `_Foo` + callable export pattern.
- [src/typescript/lib/data/index.ts](src/typescript/lib/data/index.ts) — the non-callable data-layer export surface.
- [sqladmin/frontend/vite.config.ts](../sqladmin/frontend/vite.config.ts) — the exact settings the recipe documents.

---

## Non-Goals

- No changes to library source (`src/`), the `callable()` wrapper, or the export patterns — this documents existing behaviour only.
- Not rewriting or merging the existing `recipes/component-options.md` — it stays the example cookbook; the new concept page links to it.
- No API-reference (`docs/api/`) edits — that tree is TypeDoc-generated.
- Not documenting other bundlers' (Webpack/Rollup) local-linking recipes — the logged gap and the reference config are Vite-specific; other bundlers stay covered by the existing Installation "Bundler setup" section.
