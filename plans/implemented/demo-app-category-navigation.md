---
depends-on: [card-deferred-child-keys]
touches-shared:
  - packages/lib/src/typescript/main.ts
  - packages/lib/src/typescript/lib/diagnostics/StyleAuditView.ts
  - packages/lib/src/typescript/lib/diagnostics/StyleAuditOverlay.ts
  - packages/lib/llms.txt
  - packages/lib/docs/guide/installation.md
  - packages/lib/docs/components/StyleAuditOverlay.md
---

# Demo-app category navigation — Implementation Plan

## Overview

The library's own demo app puts all 32 demo panels into one `Tab` layout mounted straight on the `Body` ([`main.ts:48`](packages/lib/src/typescript/main.ts#L48)), so 32 tab buttons share one strip and a panel is hard to find. This plan replaces that strip with a two-level category `Tree` on the left and the selected panel on the right, divided by a draggable `Split` gutter.

Nothing inside any demo panel changes. The work is confined to the demo app's entry point and five new sibling modules beside it: the label-to-slug transform, the table of categories and sections, the nav `Tree`, the content pane, and a `localStorage` helper for the divider position. Three JSDoc comments and two doc pages call the Style Audit panel a "tab" and are reworded; `packages/lib/llms.txt` is regenerated because one of those comments feeds it.

The 32 URL slugs stay exactly as they are today, so every bookmark keeps working. What changes underneath is which library capability builds the panels lazily: `Tab`'s built-in lazy tab ([`Tab.addLazyTab`](packages/lib/src/typescript/lib/layout/Tab.ts#L1833)) gives way to `Card`'s keyed deferred child, which `plans/card-deferred-child-keys.md` lands first. **That plan is a hard prerequisite** — every registration here goes through the `key` constraint and `Card.setVisibleKey` it adds, and none of those symbols exists on `master`.

---

## The Section Taxonomy

Seven categories, derived from what each panel actually demonstrates.[^taxonomy] The `Label` column is verbatim today's `addSection` label ([`main.ts:66-97`](packages/lib/src/typescript/main.ts#L66)) and must not be edited — the `Slug` column is what `slugify` derives from it, and it is the app's URL.

| Category | Label | Slug |
|---|---|---|
| **Box & Flow Layouts** (8) | `HBox` | `hbox` |
| | `VBox` | `vbox` |
| | `Row` | `row` |
| | `Column` | `column` |
| | `Justify` | `justify` |
| | `AlignSelf` | `alignself` |
| | `HFlow` | `hflow` |
| | `VFlow` | `vflow` |
| **Regions & Grids** (5) | `Border` | `border` |
| | `Split` | `split` |
| | `Grid` | `grid` |
| | `Fit` | `fit` |
| | `Layout I/O` | `layout-i-o` |
| **Containers & Bars** (4) | `Accordion` | `accordion` |
| | `Tab` | `tab` |
| | `MenuBar` | `menubar` |
| | `ToolBar` | `toolbar` |
| **Data & Lists** (5) | `Binding` | `binding` |
| | `Property Grid` | `property-grid` |
| | `Rotated` | `rotated` |
| | `MultiSelect` | `multiselect` |
| | `Marker Lists` | `marker-lists` |
| **Editors & Visuals** (5) | `Markdown` | `markdown` |
| | `MD Editor` | `md-editor` |
| | `CodeEditor` | `codeeditor` |
| | `Charts` | `charts` |
| | `Diagram` | `diagram` |
| **Diagnostics** (3) | `Baseline` | `baseline` |
| | `Content Box` | `content-box` |
| | `Style Audit` | `style-audit` |
| **Showcase** (2) | `Misc.` | `misc` |
| | `Complex` | `complex` |

Category order is the order above; section order within a category is the order above. Sizes run 2 to 8, so no category is a singleton and none swallows a third of the list.

---

## Architecture Decisions

### The nav is a `Tree`, not a list

The nav pane holds a `Tree` whose roots are the seven categories and whose leaves are the 32 sections. A category node carries no `data` payload, which is what makes it non-navigable; a leaf carries its slug.[^tree-not-list]

The precedent is [`DocsSidebar`](packages/docs/src/shell/DocsSidebar.ts#L45) in this same repo — a `Tree` whose leaf payloads are route paths, wired to a `Router` through `on("selection")` and reflected back from the URL by a `select(path)` method. This plan mirrors that shape, with two stated deviations and three additions:

- **Deviation:** `DemoNavigator` extends `Container`, not `Panel`. `Tree` virtual-scrolls itself so no `autoScroll` is needed, and `Container`'s zero default insets remove the explicit `Insets(0, 0, 0, 0)` `DocsSidebar` has to pass. `Container` already overrides `clampsToContentSize()` to `false` ([`Container.ts:49`](packages/lib/src/typescript/lib/core/Container.ts#L49)), which is what lets the gutter shrink the pane.
- **Deviation:** `select(slug)` is synchronous — `expandNode` then `selectNode` against a slug-keyed node map — where `DocsSidebar.select` awaits `revealByPredicate`. That await exists because the docs tree has lazily-loaded API branches; this tree is fully built at construction, so there is nothing to await.[^sync-select]
- **Addition:** `expandTrigger: "click"` ([`Tree.ts:158`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L158)), so a single click on a category row toggles it. Without it a category row needs a double-click, and a single click on one would do nothing at all.
- **Addition:** `rowOverflow: "clip"`, so a narrow pane ellipsises a long label instead of growing a horizontal scrollbar. The library's own guidance names a TOC-style outline as the case for it ([`Tree.ts:31-35`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L31)).
- **Addition:** `backgroundColor: "transparent"`, as `DocsSidebar` also passes. `Tree` defaults to the input fill `var(--ts-ui-input-bg, …)` ([`Tree.ts:176`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L176)), which would make the nav pane read as a text field rather than as part of the page.

### The content pane is a `Card`, and `Card` owns the lazy build

The content pane is a `Container` whose layout manager is `Card` — the show-one-child manager, which drops every inactive child out of the render tree with `display: none` and captures its scroll offset on the way out ([`Card.ts:192`](packages/lib/src/typescript/lib/layout/Card.ts#L192)). That is the same treatment `Tab` gives an inactive tab page today. `Container` rather than `Panel`: every demo panel already configures its own `autoScroll`, so the pane itself must not add a second scroll host, and `Container` clips instead.

Each of the 32 sections is registered as an unbuilt keyed page — `this.addComponent(section.factory, { key: section.slug })` — and shown with `card.setVisibleKey(slug)`, which runs that slug's factory on the first selection and never again. Both come from `plans/card-deferred-child-keys.md`; the demo app keeps no record of its own.[^lazy-via-card-keys]

Two rules fall out of that API and the demo app owns both:

- **The key is the slug.** A registration whose key were the label or an index would leave `setVisibleKey(slug)` resolving nothing, and `Card` would fall back to its first live child.
- **`show` pre-flights with `hasKey`.** An unknown key is `Card`'s fall-back-to-first-child path, not a no-op, so the router must not hand one over. `hasKey` answers for a pending slot and for an already-built one alike, which is what makes it usable on every visit rather than only the first.

Those two rules are why `DemoSectionDeck` stays a class of its own rather than a `Container({ layoutManager: Card() })` built inline in `main.ts`: both are demo-app mistakes that no library test can catch, and a class is the only seam a unit test can reach. `main.ts` cannot be imported by a test — it is a top-level-`await` module that mounts the `Body` and pulls in all 32 panels.

### The root is a two-pane `Split` on the `Body`, with an 8px `spacing` gap

`Body.init` takes a horizontal `Split` in place of today's `Tab`, and the nav pane and content pane are the `Body`'s only two children. The gutter's visible divider is the `Split`'s own `spacing` gap, set to `8` — the value the layout's own documentation uses ([`docs/layouts/Split.md:51`](packages/lib/docs/layouts/Split.md#L51)). No divider component, border or inset is added.[^spacing-is-the-divider]

The `Split`'s gutters are raw-appended to the container's element rather than added as container children, so `Split` sees exactly the two panes and nothing else.[^body-children]

### The nav pane is `weight: 0`, the content pane `weight: 1`

The nav pane is added with `{ weight: 0 }` so it keeps a fixed pixel width when the window resizes, and the content pane with `{ weight: 1 }` so it absorbs the whole delta. The content pane's positive weight is required, not decorative: an unweighted pane would drag the split back toward an equal division on resize. The nav pane also gets `setMinSize({ width: NAV_MIN_WIDTH, height: 0 })` as a drag floor.[^weights]

`Split` divides equally between panes that have no stored size ([`Split.ts:2526`](packages/lib/src/typescript/lib/layout/Split.ts#L2526)), so the starting geometry is seeded through the `paneSizes` option rather than left to that default.

### Every section keeps its current label, so every URL keeps working

The slug is still derived from the label by the same `slugify` two-regex transform, and every label in the taxonomy table is byte-identical to today's. `/#/property-grid`, `/#/layout-i-o` and the other 30 routes therefore resolve to the same panels they do now. The route patterns stay `"/"` and `"/:section"` — one flat segment per section, with the category carried nowhere in the URL.[^flat-routes]

`slugify` moves into its own module, `demoSlug.ts`, holding nothing else. That is what lets its transformation table be unit-tested without a test importing 32 panel modules.[^slug-module]

### Selection already survives a reload; the `Split` ratio is made to as well

Selection survives a reload today through the URL fragment, and this plan changes nothing about that: the router is still the single source of truth for which section shows, and a tree click navigates rather than switching the pane directly.[^url-first]

The divider position is new persisted state. `Split` already ships the surface for it — `getPaneSizes()` is documented as the cross-session persistence capture ([`Split.ts:1284`](packages/lib/src/typescript/lib/layout/Split.ts#L1284)), the `paneSizes` option is its restore, and `on("paneresize")` hands back exactly the array to store. A new `demoLayoutStore.ts` reads and writes one `localStorage` key, mirroring the docs app's [`apiPreferences.ts`](packages/docs/src/content/apiPreferences.ts#L8) one-key module. Validation is split the way the library intends: the store checks only *shape* (a real array of well-formed `LayoutSize` entries), and the library's `isRestorableSizes` ([`LayoutSizes.ts:114`](packages/lib/src/typescript/lib/layout/LayoutSizes.ts#L114)) checks *fit* against the live panes and discards a stale array whole.

Nothing else persists — not which categories are expanded, not whether the nav pane is collapsed.[^persist-scope]

### No panel changes, except `BaselinePanel`'s tab-bar comment

No panel reads its parent container, a tab index, or a `Tab` event; no panel serialises the app's own layout.[^no-tab-coupling] One panel refers to the container in a comment: `BaselinePanel` declares `ROW_TOP_OFFSET = 40` as the "gap from the tab bar" ([`BaselinePanel.ts:27-28`](packages/lib/src/typescript/BaselinePanel.ts#L27)) and applies it to "drop the row clear of the tab bar above" ([`BaselinePanel.ts:96-97`](packages/lib/src/typescript/BaselinePanel.ts#L96)). After this change there is no tab bar above it. The value stays at 40 — the ruler still needs clearance from the pane's top edge to be readable, and re-picking the number is a visual judgement — and only the two comments naming the tab bar are reworded.

---

## Public API

None of this is published library API: every new symbol lives in the demo app under `packages/lib/src/typescript/`, which `packages/lib/src/typescript/lib/**` never imports. Signatures below are the contract the implementer writes to.

`packages/lib/src/typescript/demoSlug.ts`:

```typescript
/**
 * Slugifies a section label into a stable URL segment: lower-cased, every run
 * of non-alphanumeric characters collapsed to one `-`, and a leading or
 * trailing `-` stripped.
 */
export function slugify(label: string): string;
```

`packages/lib/src/typescript/demoSections.ts`:

```typescript
export interface DemoSection {
    /** The tree leaf's text, and the string `slug` is derived from. */
    readonly label:   string;
    /** The section's URL segment, derived from `label` by `slugify`. */
    readonly slug:    string;
    /** Builds the section's panel; called at most once, on first selection. */
    readonly factory: () => Component;
}

export interface DemoCategory {
    readonly title:    string;
    readonly sections: readonly DemoSection[];
}

export const DEMO_CATEGORIES: readonly DemoCategory[];

/** The slug `/` lands on: `"misc"`, which is the panel tab index 0 opened before this change. */
export const DEFAULT_SECTION_SLUG: string;

/** Every section, flattened in category order then in-category order. */
export function allSections(): readonly DemoSection[];
```

`packages/lib/src/typescript/DemoNavigator.ts`:

```typescript
class DemoNavigator extends Container {
    constructor(router: Router, options?: ContainerOptions);

    /** Expands `slug`'s category and selects its leaf. No-op for an unknown slug. */
    select(slug: string): this;
}
// callable-wrapped and exported as `_DemoNavigator` / `DemoNavigator`.
```

`packages/lib/src/typescript/DemoSectionDeck.ts`:

```typescript
class DemoSectionDeck extends Container {
    /** Registers every section as an unbuilt keyed page on an internal `Card`. */
    constructor(sections: readonly DemoSection[], options?: ContainerOptions);

    /**
     * Shows `slug`'s panel. `Card` builds that panel on the first call for the
     * slug and reuses it afterwards.
     *
     * @returns `true` when `slug` names a registered section, `false` (having
     *   left the card untouched) when it does not.
     */
    show(slug: string): boolean;
}
// callable-wrapped and exported as `_DemoSectionDeck` / `DemoSectionDeck`.
```

`packages/lib/src/typescript/demoLayoutStore.ts`:

```typescript
/** The saved pane sizes, or `fallback` when none is saved, unparseable, or malformed. */
export function loadPaneSizes(fallback: LayoutSize[]): LayoutSize[];

/** Persists the pane sizes a completed gutter drag settled on. */
export function savePaneSizes(sizes: LayoutSize[]): void;
```

---

## Internal Structure

### `demoSections.ts` — the table

Each entry is built through one helper so the slug is never written by hand, which is what keeps the label and the URL from drifting:

```typescript
function section(label: string, factory: () => Component): DemoSection {
    return { label, slug: slugify(label), factory };
}

export const DEMO_CATEGORIES: readonly DemoCategory[] = [
    {
        title: "Box & Flow Layouts",
        sections: [
            section("HBox",      () => new HBoxPanel()),
            section("VBox",      () => new VBoxPanel()),
            // … the rest of the category, in taxonomy-table order
        ],
    },
    // … the remaining six categories
];

export const DEFAULT_SECTION_SLUG = slugify("Misc.");
```

`allSections()` flattens `DEMO_CATEGORIES` and returns the result; it may recompute on each call (it is called once, at startup, and once per test).

### `DemoSectionDeck` — registration and selection

The whole class, now that `Card` holds the pending factories:

```typescript
class DemoSectionDeck extends Container {

    private readonly _card: Card;

    constructor(sections: readonly DemoSection[], options?: ContainerOptions) {
        super(options, { layoutManager: new Card() });

        this._card = this.getLayoutManager() as Card;

        // The `key` is what makes each factory deferrable: Card declines a
        // keyless factory, and Component.addComponent would then build all 32
        // panels here. The key is the slug, so `show` can pass a URL segment
        // straight through.
        for (const section of sections) {
            this.addComponent(section.factory, { key: section.slug });
        }
    }

    show(slug: string): boolean {
        // Asked before told: an unregistered key is Card's fall-back-to-first-
        // child path, so a mistyped URL segment would silently open the wrong
        // panel rather than being reported back to the router.
        if (!this._card.hasKey(slug)) {
            return false;
        }

        this._card.setVisibleKey(slug);

        return true;
    }
}
```

The `Card` is already attached by the time the constructor body runs — `Container`'s `applyOptions` dispatches `setLayoutManager` during `super()` — so each `addComponent` reaches `Card.addDeferredComponent` with a container to schedule against. Casting `getLayoutManager()` mirrors [`TabPanel.getTab`](packages/lib/src/typescript/lib/component/container/TabPanel.ts#L182). The `{ key: … }` object literal is assignable to the `LayoutConstraints` parameter because every field on that class is optional, which is the same call style the demo panels already use for `{ placement: …, collapsible: … }`.

### `DemoNavigator` — the node map and the two handlers

Everything below except `SlugNodes` is a member of the class; the constructor that ties them together is spelled out in step 7.

```typescript
/** One section's tree nodes: the leaf to select, and the category to expand first. */
interface SlugNodes {
    readonly category: TreeNode;
    readonly leaf:     TreeNode;
}

private readonly _nodesBySlug: Map<string, SlugNodes> = new Map();

// Stable reference so Tree.off would find the same identity; delegates to the
// named handler below — mirrors DocsSidebar's own handleSelection idiom.
private readonly handleSelection: (nodes: TreeNode[]) => void = (nodes) => this.onSelection(nodes);

private buildNodes(): TreeNode[] {
    const roots: TreeNode[] = [];

    for (const category of DEMO_CATEGORIES) {
        const leaves: TreeNode[] = category.sections.map(s => ({ label: s.label, data: s.slug }));
        const node:   TreeNode   = { label: category.title, children: leaves };

        for (let idx = 0; idx < leaves.length; idx += 1) {
            this._nodesBySlug.set(category.sections[idx].slug, { category: node, leaf: leaves[idx] });
        }

        roots.push(node);
    }

    return roots;
}

private onSelection(nodes: TreeNode[]): void {
    const node = nodes[0];

    // A category row carries no slug payload: its click has already toggled its
    // own expansion, and there is nothing to navigate to.
    if (!node || typeof node.data !== "string") {
        return;
    }

    this._router.navigate("/" + node.data);
}

select(slug: string): this {
    const entry = this._nodesBySlug.get(slug);

    if (entry) {
        // Expanded first: selectNode no-ops for a node whose ancestor is
        // collapsed, so the leaf has to be in the flattened row set already.
        this._tree.expandNode(entry.category);
        this._tree.selectNode(entry.leaf);
    }

    return this;
}
```

`Tree.selectNode` deliberately does **not** emit `"selection"` ([`Tree.ts:636-640`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L636)), so `select` cannot re-enter the router and no loop guard is needed.

### `demoLayoutStore.ts` — shape validation only

```typescript
const PANE_SIZES_KEY = "tsui-demo.shell.paneSizes";

function isLayoutSize(value: unknown): value is LayoutSize {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const size = value as Partial<LayoutSize>;

    return (size.unit === "px" || size.unit === "ratio")
        && typeof size.value === "number"
        && Number.isFinite(size.value);
}

export function loadPaneSizes(fallback: LayoutSize[]): LayoutSize[] {
    const raw = localStorage.getItem(PANE_SIZES_KEY);

    if (raw === null) {
        return fallback;
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch {
        return fallback;
    }

    if (!Array.isArray(parsed)) {
        return fallback;
    }

    const entries: unknown[] = parsed;

    if (!entries.every(isLayoutSize)) {
        return fallback;
    }

    // Every entry passed the guard above; `Array.every` does not narrow the
    // array's element type, so the assertion stands in for what it proved.
    return entries as LayoutSize[];
}
```

### `main.ts` — the new root

```typescript
// Starting nav width in px, sized for the widest category label ("Box & Flow
// Layouts") plus its chevron and the row's own padding. The gutter is draggable
// and the result is persisted, so a reader who wants another width sets it once.
const NAV_DEFAULT_WIDTH = 220;

// Drag floor, so a gutter drag cannot crush the nav pane to nothing.
const NAV_MIN_WIDTH = 120;

// The visible divider between the panes is this gap; see `Split`'s `spacing`.
const GUTTER_SPACING = 8;

// Pane 0 carries `weight: 0` so it persists as px; pane 1 is the only weighted
// pane, so its ratio is the whole remainder.
const DEFAULT_PANE_SIZES: LayoutSize[] = [
    { unit: "px",    value: NAV_DEFAULT_WIDTH },
    { unit: "ratio", value: 1 },
];

DOM.source.getScrollBarWidth();
(window as any).bench = Benchmark;

FocusHistory.enable();
SpatialNavigation.enable();

const split = new Split({
    orientation: "horizontal",
    spacing:     GUTTER_SPACING,
    paneSizes:   loadPaneSizes(DEFAULT_PANE_SIZES),
    listeners:   { paneresize: savePaneSizes },
});

const body = await Body.init({ layoutManager: split });

// Both handlers are driven by the router rather than by the tree directly: the
// URL names the section the moment its row is clicked, so the location field
// never trails the visible panel — the same reason the old tab strip drove
// "select" rather than "activate".
function showDefaultSection(): void {
    deck.show(DEFAULT_SECTION_SLUG);
    demoNav.select(DEFAULT_SECTION_SLUG);
}

// An unknown slug falls back to the default section and leaves the URL alone,
// matching what the old tab strip did: an unmatched slug simply left the
// container on its first entry.
function showSection(params: RouteParams): void {
    if (!deck.show(params.section)) {
        showDefaultSection();
        return;
    }

    demoNav.select(params.section);
}

const router = new Router({
    routes: {
        "/":         showDefaultSection,
        "/:section": showSection,
    },
});

const demoNav = new DemoNavigator(router);
const deck    = new DemoSectionDeck(allSections());

demoNav.setMinSize({ width: NAV_MIN_WIDTH, height: 0 });

body.addComponent(demoNav, { weight: 0 });
body.addComponent(deck,    { weight: 1 });

router.start();

// … today's lines 128-149 — the PersonModel / MemoryStore console block and the
// `if (false) { Benchmark.benchAll(); }` guard — continue here unchanged.
```

`router.start()` applies the current route synchronously, so the routed panel is already mounted and visible when the first layout pass runs.

The function declarations sit above `router`, `demoNav` and `deck` but read them only when `router.start()` runs on the last line, so both `const`s are initialised by then. That is the same arrangement today's `syncHashToTab` uses, where the handler closes over a `router` declared below it.

---

## Ordered Implementation Steps

1. **Create `packages/lib/src/typescript/demoSlug.ts`.** SPDX header, then the exported `slugify` with the two-regex body lifted verbatim from [`main.ts:55-57`](packages/lib/src/typescript/main.ts#L55) and a JSDoc stating the transform. Import nothing. → verify: `grep -c "^import" packages/lib/src/typescript/demoSlug.ts` prints `0`.

2. **Create `packages/lib/tests/unit/demo/slugify.test.ts`.** Import `slugify` from `../../../src/typescript/demoSlug.js` and assert every row of `## Expected Behaviour` case 1. No DOM harness is needed — `slugify` is pure and its module imports nothing. → verify: `npm test`, run from the worktree root, passes. Never pass a bare `--root` to vitest.

3. **Create `packages/lib/src/typescript/demoSections.ts`.** SPDX header; the `DemoSection` / `DemoCategory` interfaces; the module-private `section` helper; `DEMO_CATEGORIES` transcribed from the `## The Section Taxonomy` table in exactly that order; `DEFAULT_SECTION_SLUG = slugify("Misc.")`; `allSections()`. Cut all 32 panel `import` lines out of `main.ts` and paste them here verbatim — this file is `main.ts`'s own directory sibling, so every `./XPanel.js` specifier is unchanged. Import `slugify` from `./demoSlug.js` and `Component` from `@jimka/typescript-ui/core` as a type. → verify: `grep -c 'section("' packages/lib/src/typescript/demoSections.ts` prints `32`.

4. **Create `packages/lib/src/typescript/DemoSectionDeck.ts`.** Exactly four import statements, so the module pulls in no panel at runtime:

   ```typescript
   import { callable, Container } from '@jimka/typescript-ui/core';
   import type { ContainerOptions } from '@jimka/typescript-ui/core';
   import { Card } from '@jimka/typescript-ui/layout';
   import type { DemoSection } from "./demoSections.js";
   ```

   `DemoSection` appears only in a type position, so its import is `import type` and is erased — that is what keeps the deck, and its test, free of the 32 panel modules. Write the constructor and `show` exactly as `## Internal Structure` gives them, SPDX header first. `callable`-wrap and export under the `_DemoSectionDeck` / `DemoSectionDeck` alias pair like every demo panel. → verify: `grep -n 'key: section.slug' packages/lib/src/typescript/DemoSectionDeck.ts` matches, and `grep -c "hasKey" packages/lib/src/typescript/DemoSectionDeck.ts` prints `1`.

5. **Create `packages/lib/tests/component/demo/DemoSectionDeck.test.ts`.** Copy the harness preamble from [`tests/component/layout/Card.test.ts:1-16`](packages/lib/tests/component/layout/Card.test.ts#L1) — the `installTestDOM` import, the `CONFIG` bag, the `afterEach` teardown — then write cases 2 through 5 of `## Expected Behaviour`. Two helpers carry every case:

   ```typescript
   // Label and slug are separate parameters on purpose: every case registers at
   // least one section whose label differs from its slug, which is what makes a
   // `key: section.label` mix-up observable.
   function stubSection(label: string, slug: string, built: string[], panels: Map<string, Component>): DemoSection {
       return {
           label,
           slug,
           factory: () => {
               built.push(slug);

               const panel = new Component({ preferredSize: { width: 10, height: 10 } });
               panels.set(slug, panel);

               return panel;
           },
       };
   }

   // The deck keeps its Card private; the cases read the selection off the
   // manager, the same cast TabPanel.getTab uses for its own Tab.
   function cardOf(deck: DemoSectionDeck): Card {
       return deck.getLayoutManager() as Card;
   }
   ```

   `cardOf` needs `Card` imported from `~/layout/Card` and `Component` from `~/core/Component`, both of which the copied preamble already brings in. Give the deck an element with `deck.getElement(true)` before the first `show`, as `Card.test.ts`'s own `hostCard` helper does — `Card.buildDeferredChild` returns `false` with no attached container. → verify: `npm test` passes, then run the mutation sweep in `## Verification`.

6. **Create `packages/lib/src/typescript/demoLayoutStore.ts`.** SPDX header, the key constant, `isLayoutSize`, `loadPaneSizes`, `savePaneSizes`, and the comment recording that the store owns shape while the library owns fit. → verify: `npm test` passes (`typecheck:test` covers this file).

7. **Create `packages/lib/src/typescript/DemoNavigator.ts`.** SPDX header, then:

   ```typescript
   import { callable, Container } from '@jimka/typescript-ui/core';
   import type { ContainerOptions } from '@jimka/typescript-ui/core';
   import { Fit } from '@jimka/typescript-ui/layout';
   import { Tree } from '@jimka/typescript-ui/component/tree';
   import type { TreeNode } from '@jimka/typescript-ui/component/tree';
   import { Router } from '@jimka/typescript-ui/router';
   import { DEMO_CATEGORIES } from "./demoSections.js";
   ```

   Constructor: `super(options, { layoutManager: Fit() })`, store `router` into `this._router`, then `this._tree = Tree({ backgroundColor: "transparent", expandTrigger: "click", rowOverflow: "clip", listeners: { selection: this.handleSelection } })`, then `this._tree.setNodes(this.buildNodes())`, then `this.addComponent(this._tree)`. Then `buildNodes`, `onSelection` and `select` exactly as `## Internal Structure` gives them. `callable`-wrap and export as the `_DemoNavigator` / `DemoNavigator` pair. → verify: `npm run lint` reports no new finding — the `options` parameter must reach `super()` or `local/forward-super-options` errors, and that rule covers `src/**/*.ts`, demo files included.

8. **Rewrite `packages/lib/src/typescript/main.ts`.** Replace lines 1 through 126 with the module shown in `## Internal Structure`, whose imports are:

   ```typescript
   import { Body, DOM, FocusHistory, SpatialNavigation } from '@jimka/typescript-ui/core';
   import { Split } from '@jimka/typescript-ui/layout';
   import type { LayoutSize } from '@jimka/typescript-ui/layout';
   import { MemoryStore, Model } from '@jimka/typescript-ui/data';
   import { Router, type RouteParams } from '@jimka/typescript-ui/router';
   import { DemoNavigator } from "./DemoNavigator.js";
   import { DemoSectionDeck } from "./DemoSectionDeck.js";
   import { allSections, DEFAULT_SECTION_SLUG } from "./demoSections.js";
   import { loadPaneSizes, savePaneSizes } from "./demoLayoutStore.js";
   import { Benchmark } from "./perf/Benchmark.js";
   ```

   Dropped: the `Tab` import, the `Component` import, all 32 panel imports (now in `demoSections.ts`), `slugify`, the `slugs` array, `addSection`, and the `layoutManager.on("select", …)` wiring. Kept verbatim: `DOM.source.getScrollBarWidth()`, `(window as any).bench = Benchmark;`, `FocusHistory.enable()`, `SpatialNavigation.enable()`, and — untouched — lines 128 to 149, the `PersonModel` / `MemoryStore` console-logging block and the `if (false) { Benchmark.benchAll(); }` guard, which is why `MemoryStore` and `Model` stay in the import list. → verify: `grep -n "Tab\b" packages/lib/src/typescript/main.ts` — zero matches.

9. **Regression sweep for orphans.** `grep -rn "addSection\|slugs\[" packages/lib/src/typescript/` — expect zero matches. `grep -rl "FlowDemoPanel\|LayoutTestPanel" packages/lib/src/typescript/*.ts | wc -l` — expect `9`, the same nine files as before the change (`FlowDemoPanel.ts`, `LayoutTestPanel.ts`, `HBoxPanel.ts`, `VBoxPanel.ts`, `RowPanel.ts`, `ColumnPanel.ts`, `HFlowPanel.ts`, `VFlowPanel.ts`, and `ToolBarPanel.ts`, which only names them in a comment). Both base classes are still extended by registered panels, so this change orphans nothing and deletes nothing.

10. **Reword `BaselinePanel`'s two tab-bar comments.** [`BaselinePanel.ts:27`](packages/lib/src/typescript/BaselinePanel.ts#L27) becomes `/** Vertical gap from the pane's top edge to the control row, in pixels. */`, and the two comment lines at [`BaselinePanel.ts:96-97`](packages/lib/src/typescript/BaselinePanel.ts#L96) drop the tab-bar reference while keeping the reason the offset exists (the ruler tracks the row's Y and needs clearance from the pane edge). Change no code. → verify: `grep -n "tab bar" packages/lib/src/typescript/BaselinePanel.ts` — expect zero matches.

11. **Reword `StyleAuditPanel`'s JSDoc.** [`StyleAuditPanel.ts:9`](packages/lib/src/typescript/StyleAuditPanel.ts#L9): "Demo tab wrapping" becomes "Demo section wrapping".

12. **Reword the two library JSDoc sites.** [`StyleAuditView.ts:23`](packages/lib/src/typescript/lib/diagnostics/StyleAuditView.ts#L23) and [`StyleAuditOverlay.ts:17`](packages/lib/src/typescript/lib/diagnostics/StyleAuditOverlay.ts#L17): `the demo app's own "Style Audit" tab` becomes `the demo app's own "Style Audit" section`. Change nothing else in either file. → verify: `grep -rn '"Style Audit" tab' packages/lib/src/` — expect zero matches. The same phrase also sits in `packages/lib/docs/api/`, which is generated and gitignored; it clears when step 14 regenerates it.

13. **Update the two hand-authored doc pages.** [`docs/components/StyleAuditOverlay.md:36`](packages/lib/docs/components/StyleAuditOverlay.md#L36): "tab" becomes "section". [`docs/guide/installation.md:80`](packages/lib/docs/guide/installation.md#L80): replace "The demo app renders a tabbed showcase of every layout manager and component." with a sentence describing the category tree beside the selected demo. Do **not** touch the Build commands table below it — it is mirrored from the README.

14. **Regenerate the API docs, then `llms.txt`.** `npm run docs:api`, then `npm run docs:llms:check`, then `npm run docs:llms`. `packages/lib/llms.txt` is a tracked file and its `StyleAuditOverlay` summary is derived from the JSDoc changed in step 12, so the regenerated copy is part of the change. → verify: `git diff --stat packages/lib/llms.txt` shows the one reworded line; `npm run docs:api` finishes with no more than the 14 pre-existing warnings.

15. **Full offline gate.** From the worktree root: `npm run typecheck`, `npm run lint`, `npm test`, `npm -w packages/lib run build`. Then walk `## Verification`'s manual list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/demoSlug.ts` |
| Create | `packages/lib/src/typescript/demoSections.ts` |
| Create | `packages/lib/src/typescript/DemoNavigator.ts` |
| Create | `packages/lib/src/typescript/DemoSectionDeck.ts` |
| Create | `packages/lib/src/typescript/demoLayoutStore.ts` |
| Create | `packages/lib/tests/unit/demo/slugify.test.ts` |
| Create | `packages/lib/tests/component/demo/DemoSectionDeck.test.ts` |
| Modify | `packages/lib/src/typescript/main.ts` |
| Modify | `packages/lib/src/typescript/BaselinePanel.ts` (comments only) |
| Modify | `packages/lib/src/typescript/StyleAuditPanel.ts` (JSDoc only) |
| Modify | `packages/lib/src/typescript/lib/diagnostics/StyleAuditView.ts` (JSDoc only) |
| Modify | `packages/lib/src/typescript/lib/diagnostics/StyleAuditOverlay.ts` (JSDoc only) |
| Modify | `packages/lib/docs/components/StyleAuditOverlay.md` |
| Modify | `packages/lib/docs/guide/installation.md` |
| Modify | `packages/lib/llms.txt` (regenerated) |

Nothing is deleted. `main.ts`'s `slugify`, `slugs` and `addSection` move rather than vanish, and no demo-app helper is orphaned — `FlowDemoPanel` and `LayoutTestPanel` remain the base classes of six registered panels.

---

## Expected Behaviour

Cases 1 through 5 are unit-testable. Cases 6 through 12 need a browser and are prescribed as manual steps in `## Verification`.

The division of labour with `plans/card-deferred-child-keys.md` is deliberate. That plan's `Card.deferred.test.ts` owns everything about *how* a keyed page behaves — build-once across repeated selection, switching's display and undisplay arms, the unbuilt slot contributing no size, an async or throwing factory, a duplicate key. None of that is restated here: the demo app cannot make those claims any stronger, and a second copy would only go stale.[^division-of-labour] What is left for the demo app is the three things only it can get wrong: registering a factory with no key at all, keying it by something other than its slug, and handing `Card` a slug it does not have.

**1. `slugify` collapses and trims (unit).** `demoSlug.ts`, no panels imported.

| Input | Output |
|---|---|
| `"Misc."` | `"misc"` |
| `"Layout I/O"` | `"layout-i-o"` |
| `"Property Grid"` | `"property-grid"` |
| `"MD Editor"` | `"md-editor"` |
| `"HBox"` | `"hbox"` |
| `"  Leading & trailing  "` | `"leading-trailing"` |

Catches: dropping the trailing-`-` strip (`"Misc."` → `"misc-"`, breaking `/#/misc`); dropping `toLowerCase()` (`"Misc."` → `"isc"`, because `M` then falls into the replaced class); dropping the leading-`-` strip (the last row → `"-leading-trailing"`).

Every unit case below registers the same three stubs, whose labels and slugs deliberately differ: `("Property Grid", "property-grid")`, `("MD Editor", "md-editor")`, `("Misc.", "misc")`.

**2. A new deck registers 32 pages and mounts none (unit).** After `new DemoSectionDeck([...three stubs])` on a hosted deck: `getComponents()` is empty, `built` is `[]`, and `cardOf(deck).hasKey("property-grid")` is `true`. Catches: dropping the `{ key: section.slug }` argument. Without a key `Card` declines the factory, `Component.addComponent` builds it on the spot, and all 32 panels construct at startup — the regression this plan exists to prevent. The `hasKey` arm is what distinguishes "registered, unbuilt" from "never registered at all"; on its own the empty-`getComponents()` assertion would also pass for a constructor that registered nothing.

**3. `show` builds exactly the requested page and makes it visible (unit).** `show("md-editor")` returns `true`; `built` is exactly `["md-editor"]`; `getComponents()` has length `1`; `cardOf(deck).getVisibleComponent()` is `panels.get("md-editor")`; `cardOf(deck).getVisibleKey()` is `"md-editor"`. Catches: registering under `section.label`, which leaves `hasKey("md-editor")` false so `show` returns `false` and nothing is built or displayed. Asserting the exact `built` array rather than membership is what also catches a registration that keyed every section identically.

**4. A slug whose label differs is reachable by slug and not by label (unit).** `show("property-grid")` returns `true` and mounts that stub; on a fresh deck, `show("Property Grid")` returns `false`, `built` is `[]`, `getComponents()` is empty, and `getVisibleKey()` is `null`. Catches the same label-for-slug mix-up as case 3 from the other side: a deck keyed by label passes `show("Property Grid")` and fails `show("property-grid")`, so the two arms together pin the direction rather than merely the fact that one of them works.

**5. An unknown slug is declined and leaves the card untouched (unit).** After `show("misc")`, `show("nope")` returns `false`, `built` is still `["misc"]`, `getComponents()` still has length `1`, and `getVisibleKey()` is still `"misc"`. Catches: dropping the `hasKey` pre-flight and calling `setVisibleKey` unconditionally, which stores the unknown key, resolves nothing, logs `Card`'s unresolved-key warning and falls the card back to its first live child — so a mistyped URL would silently display whichever panel happened to be built first. The `getVisibleKey()` assertion is the load-bearing one: `built` and `getComponents()` are both unchanged under that mutation, and only the stored selection exposes it.

**6. Loading `/#/property-grid` shows the Property Grid panel with its leaf selected and `Data & Lists` expanded (manual).** Every other category is collapsed.

**7. Loading `/` shows `Misc.` (manual).** Same panel as index 0 today.

**8. Loading `/#/nonexistent` shows `Misc.` and leaves the URL alone (manual).** Same as today, where an unmatched slug left the `Tab` on index 0.

**9. Clicking a leaf navigates; clicking a category toggles it and takes the highlight (manual).** A leaf click updates the location field and swaps the content pane. A category click expands or collapses that category, moves the selection highlight to the category row, and leaves the content pane unchanged — intended, not a defect.

**10. Dragging the gutter resizes the panes, and the width survives a reload (manual).** The nav pane also holds its pixel width when the window is resized, while the content pane absorbs the delta. A drag cannot shrink the nav pane below 120px.

**11. Switching away from a scrolled panel and back restores its scroll offset (manual).** `Card` captures the offset on undisplay and restores it on the next layout after the switch.

**12. `MiscPanel`'s viewport-anchored overlays still work (manual).** `Rail`, `Drawer`, `Window`, `Dialog` and `Notification` are `Position.FIXED` and mount through the `LayerManager`, so they float over the whole viewport — the nav pane included — exactly as they floated over the tab strip before.

---

## Verification

Run every command from the worktree root. A fresh worktree needs `npm install` first.

**Offline gate**

1. `npm run typecheck` — the lib only; it does not cover the demo app.
2. `npm test` — starts with `typecheck:test`, whose `tsconfig.test.json` includes `src/typescript/**`, so this is the command that type-checks the new demo modules. It then runs the new `slugify.test.ts` and `DemoSectionDeck.test.ts`.
3. `npm run lint` — `eslint src`, which covers `src/typescript/**`. `local/forward-super-options` and `local/require-subclass-defaults` apply to the demo app, so a constructor that drops its `options` parameter is an error.
4. `npm run docs:api` — no new warnings beyond the 14 pre-existing ones.
5. `npm run docs:llms:check` then `npm run docs:llms`.
6. `npm -w packages/lib run build` — the demo app's production bundle still builds.
7. `grep -rn '"Style Audit" tab' packages/lib/src/ packages/lib/docs/` — zero matches.
8. `grep -rn "addSection\|slugs\[" packages/lib/src/typescript/` — zero matches.

**Mutation proof for the deck cases**

Before trusting cases 2 through 5, prove each one can fail. Three mutations cover them; apply one, run `npm test`, confirm the listed cases are red, then revert it before the next.

| Mutation of `DemoSectionDeck` | Must turn red |
|---|---|
| Drop the `{ key: section.slug }` argument, leaving `addComponent(section.factory)` | 2, 3, 4 |
| Register under the label — `{ key: section.label }` | 3, 4 |
| Delete the `if (!this._card.hasKey(slug)) return false;` pre-flight | 5 |

Other cases may go red too, which is fine — the table names the minimum. Note what the first two mutations do *not* break: neither changes how many panels a single `show` builds, or whether a switched-away page is undisplayed, because `Card` owns both. That is why no row here points at those properties, and why `Card.deferred.test.ts` rather than this file is where they are pinned. A case that stays green under its own mutation is not testing what it claims; fix the case, not the mutation.

**Manual steps — the user runs these, not the implementer**

Start the demo app however you normally do and open it. Then:

1. Visit `/#/property-grid`. The Property Grid panel shows; the nav has `Data & Lists` expanded with `Property Grid` highlighted; the other six categories are collapsed. (Case 6.)
2. Visit `/` — `Misc.` shows. Visit `/#/nonexistent` — `Misc.` shows and the location field still reads `nonexistent`. (Cases 7, 8.)
3. Click `Editors & Visuals`, then `CodeEditor`. The category expands on the single click; the leaf click swaps the pane and updates the URL to `/#/codeeditor`. Click `Editors & Visuals` again — it collapses, the highlight moves to it, and the CodeEditor panel stays on screen. (Case 9.)
4. Drag the gutter left and right. Confirm the nav pane stops at roughly 120px and the content pane follows. Reload — the dragged width comes back. Resize the browser window — the nav keeps its width while the content pane takes the whole change. (Case 10.)
5. Open `/#/misc`, scroll it down, switch to `/#/binding`, switch back. The scroll position is where you left it. (Case 11.)
6. On `/#/misc`, open the `Rail`, a `Drawer`, a `Window`, a `Dialog` and a `Notification`. Each floats over the viewport, including over the nav pane, and each closes normally. (Case 12.)
7. Open `/#/baseline`. The control row still sits clear of the pane's top edge and the red baseline ruler still runs through the controls' text baseline. The pane has no tab strip above it any more, so confirm the 40px gap reads as deliberate breathing room rather than a stranded offset; if it does not, say so rather than changing it here.
8. Keep the browser console open across steps 1 to 7. No `Card:` warning may appear. `Card: key "…" already names a slot on this card; this registration is discarded.` means two sections share a slug, which is a duplicate label in the taxonomy table; `Card: key "…" is carried by a live child of this container; the factory registered under it is discarded unbuilt.` means the same collision reached the build rather than the registration, which this app has no route to and would mean a panel was added eagerly; `Visible key is specified but no matching component was found.` means a key was selected that no slot carries, which after this plan can only come from a `setVisibleKey` that bypassed `show`.

`plans/card-deferred-child-keys.md` ends with its own manual step against this same app — three section clicks and a return to the first — because nothing in `Card`'s new surface is visible on its own. Step 5 above subsumes it; running the two separately is duplicated effort, not extra coverage.

---

## Documentation Impact

The demo app is not published API, so nothing enters the component catalog or the API reference. What changes is prose that describes the app's shape:

- **`packages/lib/src/typescript/lib/diagnostics/StyleAuditView.ts:23`** and **`StyleAuditOverlay.ts:17`** — JSDoc naming the demo app's "Style Audit" *tab*. Reword to *section*. Both are public, documented symbols, so `npm run docs:api` regenerates `packages/lib/docs/api/diagnostics/classes/StyleAuditView.md` and `StyleAuditOverlay.md`. Those files are gitignored and generated; regenerate them so `docs:llms:check` passes, and do not hand-edit them.
- **`packages/lib/llms.txt`** — tracked, generated by `npm run docs:llms`. Its `StyleAuditOverlay` row summary comes from that class's JSDoc, so the regenerated file carries the reworded sentence and is part of the commit. `packages/lib/tests/unit/llms-generate.test.ts` covers the generator, so run `npm test` after regenerating.
- **`packages/lib/docs/components/StyleAuditOverlay.md:36`** — hand-authored; "tab" becomes "section".
- **`packages/lib/docs/guide/installation.md:80`** — hand-authored; the "tabbed showcase" sentence is replaced. Leave the Build commands table untouched: `packages/lib/tests/unit/readme-mirror.test.ts` pins the two READMEs against each other and that table is the README's content.

No symbol is renamed or removed, so there is no old-name sweep to do.

---

## Potential Challenges

- **This plan does not build on `master`.** `LayoutConstraints.key`, `Card.setVisibleKey` and `Card.hasKey` all arrive with `plans/card-deferred-child-keys.md`. Start from the branch that lands it, not from `master`, or step 4 fails to compile.
- **A keyless registration is silent at compile time and catastrophic at runtime.** `key` is an optional constraint, so `addComponent(section.factory)` type-checks; `Card` then declines the factory and `Component.addComponent` builds all 32 panels during the deck's constructor. Nothing warns. Case 2 is the guard.
- **A test that imports `demoSections.ts` pulls in 32 panel modules**, including CodeMirror, Lexical and elkjs. That is why `slugify` lives in its own module and `DemoSectionDeck` imports `DemoSection` with `import type`. If a later test needs the real table, give it its own file rather than widening either of the two new tests.
- **A stale persisted pane-size array falls back to an equal split, not to the default width.** `isRestorableSizes` discards a whole array whose per-index units no longer match the live panes, and `Split` then divides equally. The only realistic trigger is a future change to the panes' `weight` constraints; if that happens, change `PANE_SIZES_KEY` in the same edit so old entries are simply not found.
- **`BaselinePanel`'s 40px offset may now read as odd.** The value is kept deliberately (see `## Architecture Decisions`); manual step 7 asks the user to judge it rather than having the implementer guess at a new number.
- **`Body` hosting the `Split` means the two panes are the `Body`'s only children.** Adding a third child to the `Body` anywhere would silently become a third pane. Nothing does today — overlays mount through the `LayerManager`, not as `Body` components — but a future header or status bar belongs inside a root container, not beside the panes.
- **`demoLayoutStore.ts` calls `localStorage` directly, and that is correct here.** The `local/no-raw-dom` rule that forces every DOM read and write through the `DOM` seam is scoped to `src/typescript/lib/**` and does not reach the demo app; `localStorage` is not part of the seam's surface in any case. Do not invent a `DOM.source` route for it. The docs app's `apiPreferences.ts` reads and writes `localStorage` the same way.
- **A blank pane on `/` means `DEFAULT_SECTION_SLUG` names no section.** A typo in the `slugify("Misc.")` argument produces a slug `deck.show` cannot resolve, and `showDefaultSection` then shows nothing rather than looping. No guard is added for a one-literal mistake; manual verification step 2 is what catches it, and the symptom is named here so it is recognised on sight.

---

## Critical Files

Read before starting:

- [`plans/card-deferred-child-keys.md`](plans/card-deferred-child-keys.md) — **the prerequisite.** Its `## Public API` is the surface `DemoSectionDeck` is written against, and its `## Expected Behaviour` is the set of claims this plan deliberately does not restate. Read at least those two sections plus `## Internal Structure`'s `setVisibleKey` and `hasKey`.
- [`packages/lib/src/typescript/main.ts`](packages/lib/src/typescript/main.ts) — the file being rewritten: the 32 registrations, `slugify`, and the existing `Router` wiring whose behaviour must be preserved.
- [`packages/docs/src/shell/DocsSidebar.ts`](packages/docs/src/shell/DocsSidebar.ts) — **the precedent.** A `Tree` nav whose leaf payloads are routes, wired to a `Router` through `on("selection")` and reflected back by `select(path)`. `buildNodes` / `onSelection` / `select` are the three methods `DemoNavigator` mirrors. Read only; this plan does not modify `packages/docs`.
- [`packages/docs/src/shell/DocsShell.ts:73-107`](packages/docs/src/shell/DocsShell.ts#L73) and [`packages/docs/src/main.ts`](packages/docs/src/main.ts) — how that app composes its sidebar beside its content pane and wires the router's synchronous first apply.
- [`packages/docs/src/content/apiPreferences.ts`](packages/docs/src/content/apiPreferences.ts) — the in-repo precedent for a one-key `localStorage` module.
- [`packages/lib/src/typescript/lib/layout/Card.ts`](packages/lib/src/typescript/lib/layout/Card.ts) — `syncVisible`'s resolution and first-sync loop, and the capture-then-undisplay pairing the deck relies on. Read it **after** the prerequisite lands, so `setVisibleKey`, `hasKey` and `addDeferredComponent` are present in the file rather than only in a plan.
- [`packages/lib/src/typescript/lib/layout/LayoutConstraints.ts`](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts) — where `key` lands, and confirmation that every field is optional, which is what makes the `{ key: slug }` object literal assignable.
- [`packages/lib/src/typescript/lib/layout/Split.ts:77-110`](packages/lib/src/typescript/lib/layout/Split.ts#L77), [`:1284`](packages/lib/src/typescript/lib/layout/Split.ts#L1284), [`:1318`](packages/lib/src/typescript/lib/layout/Split.ts#L1318), [`:2526`](packages/lib/src/typescript/lib/layout/Split.ts#L2526) — the `spacing` / `paneSizes` / `listeners` options, the persistence pair, and the equal-division default the seed overrides.
- [`packages/lib/src/typescript/lib/layout/LayoutSizes.ts`](packages/lib/src/typescript/lib/layout/LayoutSizes.ts) — `LayoutSize` and `isRestorableSizes`, the library half of the validation split.
- [`packages/lib/src/typescript/lib/component/tree/Tree.ts:153-181`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L153), [`:399`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L399), [`:646`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L646), [`:1357`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1357) — `TreeOptions`, `setNodes`, `selectNode`'s no-emit contract, `expandNode`.
- [`packages/lib/src/typescript/lib/component/tree/TreeNode.ts`](packages/lib/src/typescript/lib/component/tree/TreeNode.ts) — the `data` payload contract the slug rides in.
- [`packages/lib/src/typescript/lib/layout/Tab.ts:1776-1839`](packages/lib/src/typescript/lib/layout/Tab.ts#L1776) and [`packages/lib/src/typescript/lib/layout/LayoutManager.ts:93`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L93) — the lazy-factory mechanism being left behind, and why only `Tab` has it.
- [`packages/lib/tests/component/layout/Card.test.ts`](packages/lib/tests/component/layout/Card.test.ts) — the harness preamble the new deck test copies.
- [`packages/lib/eslint.config.js`](packages/lib/eslint.config.js) and [`packages/lib/tsconfig.test.json`](packages/lib/tsconfig.test.json) — which checks reach the demo app, and which do not.
- [`packages/lib/llms.txt`](packages/lib/llms.txt) — the capability manifest; `Split`, `Card`, `Tree`, `Container` and `Router` are the entries this plan builds from.

---

## Non-Goals

- **Adding, widening or testing `Card`'s keyed-page surface.** The gap this plan first hit — `Card` could name a visible child only by component id, which an unbuilt child does not have — is closed, not deferred: `plans/card-deferred-child-keys.md` adds `LayoutConstraints.key`, `setVisibleKey` / `getVisibleKey` / `hasKey`, the `visibleKey` option and the `addDeferredComponent` override, and lands first. This plan consumes that API and changes nothing under `packages/lib/src/typescript/lib/`. Its `Card.deferred.test.ts` owns the build-once, switching and failure-path cases; do not restate them here.
- **Hiding a `Tab`'s strip.** `TabOptions` has no such option, and adding one to drive a strip-less `Tab` from a tree would be a library change in service of suppressing the very component's identity.
- **Renaming any section label.** The labels are the URLs. A relabelling pass is a separate, deliberate break.
- **A search field in the nav.** `DocsSidebar` has one because it indexes hundreds of pages; 32 entries under seven headings do not need one.
- **Persisting the expanded-category set or a collapsed nav pane.** The route already reveals the one category that matters on load, and a collapsed nav returning expanded after a reload is the safe direction.
- **App chrome.** No `Header`, `MenuBar` or `StatusBar` is added, and no glyphs are put on the tree rows.
- **Touching `packages/docs` or `packages/qa`.** Both are read here as references only.
- **Removing `main.ts`'s trailing `PersonModel` / `MemoryStore` console block or its `if (false) { Benchmark.benchAll(); }` guard.** Neither is orphaned by this change, and the repo's own rule is to mention pre-existing dead code rather than delete it. It is mentioned here.
- **Reformatting or improving any demo panel.** `BaselinePanel` and `StyleAuditPanel` get comment-only edits and nothing else.

---

## Notes

[^taxonomy]: The cut follows the library's own capability manifest sections ([`packages/lib/llms.txt:13-138`](packages/lib/llms.txt#L13)) wherever the demos support it, then splits the one section that would otherwise dominate. A single `Layouts` category would hold twelve of the 32 panels — more than a third of the list under one heading, which defeats the point of grouping. The twelve divide cleanly along the library's own class hierarchy: `HBox`, `VBox`, `Row`, `Column`, `Justify` and `AlignSelf` exercise `BoxLayout`, and `HFlow` / `VFlow` exercise `FlowLayout`, so those eight are one family; `Border`, `Split`, `Grid` and `Fit` are the region-and-track managers. `Layout I/O` joins the second group because `LayoutSerializationPanel` serialises split / tab / window topologies, which is a layout concern rather than a data one. At the other end, `Misc.` and `Complex` are the only two panels that demonstrate no single component — `MiscPanel` is the 104KB kitchen sink of themes, overlays, buttons and inputs, and `ComplexUIPanel` is seven nested-layout compositions — so they pair as `Showcase` rather than either being forced under a component heading or left as a singleton. `Baseline`, `Content Box` and `Style Audit` are grouped as `Diagnostics` because none demonstrates a component for a consumer to use: they are measurement views for developing the library, which is how their own file comments describe them.

[^tree-not-list]: Both were live options. The deciding evidence is what each does with a two-level structure. A `Tree` category node expresses "not navigable" by carrying no `data` payload, and the selection handler's `typeof node.data !== "string"` guard — already the shape [`DocsSidebar.onSelection`](packages/docs/src/shell/DocsSidebar.ts#L320) uses for its grouping-only API nodes — skips it for free. `AbstractSelectableList` is flat, so a category would have to be a real item made inert with the row-level `setEnabled(false)`; that leaves seven header items inside the list's own index space, so `getSelectedIndex()` no longer maps onto the section list and every lookup needs an offset table. The `Tree` also brings expand/collapse, which is the whole point of grouping 32 entries — a reader can fold away the six categories they are not working in — and it virtual-scrolls itself, so the pane needs no scroll wrapper. The second, weaker consideration is that `Tree.selectNode` does not emit `"selection"` ([`Tree.ts:636`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L636)), so reflecting the URL into the nav cannot re-enter the router; `AbstractSelectableList.setSelectedIndex` emits `"change"` but not `"action"`, which is also loop-safe, so this one does not decide it.

[^sync-select]: [`DocsSidebar.select`](packages/docs/src/shell/DocsSidebar.ts#L118) is `async` and awaits `Tree.revealByPredicate`, which walks the tree loading lazy branches on the way down — necessary there because the docs app's API subtree is built from `loadChildren`. `DocsShell.showPath` then has to call it fire-and-forget (`void this._sidebar.select(path)`) so the router's synchronous first apply is not blocked. The demo tree has no `loadChildren` anywhere: all seven categories and all 32 leaves exist the moment `setNodes` runs. Holding a slug-keyed map of `{ category, leaf }` therefore lets `select` do the same job with two synchronous calls, and removes the fire-and-forget promise along with it. `expandNode` has to come first because `selectNode` no-ops for a node whose ancestor is collapsed.

[^lazy-via-card-keys]: An earlier draft of this plan kept the pending factories in the demo app, because `Card` could then name a visible child only by its component id and an unbuilt child has no id. That gap is now closed upstream instead, by `plans/card-deferred-child-keys.md`, which lands first — the right outcome for a library whose demo app exists to exercise it, and the reason this plan carries a `depends-on`. What the demo app gives up is worth naming: the per-slug `{ factory, component }` map, the `if (entry.component === null)` build guard, and the add-then-select ordering rule, all of which now live inside `Card.buildDeferredChild`. It also gives up a trap it had to document — reading the built panel's auto-generated id instead of calling `Component.setId`, because a `Panel` registers its `autoScroll` wheel listener under its id at construction and `setId` does not re-register it. A caller-supplied key never touches the component's id, so that trap no longer arises and the deck needs no comment about it.

[^division-of-labour]: Restating `Card`'s cases against a demo-app stub would not make them stronger, and it has a specific failure mode: the two files would drift, and the demo app's copy — written against three stubs rather than the twenty-two-case matrix `Card.deferred.test.ts` uses — would be the weaker one left standing if `Card`'s behaviour ever changed. The dependency also runs one way, so `Card`'s suite is guaranteed to have run before this plan's does. The prerequisite plan reaches the same conclusion from its own side: the footnote hanging off its overview checks its API against this consumer, lists what the demo app stops owing, and ends with the one thing it keeps — resolving the slug before selecting, since an unknown key falls back to `Card`'s first live child rather than doing nothing. Case 5 is that claim.

[^spacing-is-the-divider]: `Split`'s `spacing` reserves the pixel gap the gutter sits in ([`Split.ts:79-84`](packages/lib/src/typescript/lib/layout/Split.ts#L79)); at the default `0` the panes touch and the gutter element straddles the boundary, 5px into each neighbour. The layout's own documentation states that the visible divider is the `spacing` gap plus each neighbour's unpainted facing inset, and its worked example uses `spacing: 8` ([`docs/layouts/Split.md:47-56`](packages/lib/docs/layouts/Split.md#L47)). Both panes are `Container`s with zero insets that paint no background of their own, so the 8px gap *is* the divider, with no border, inset or divider component involved.

[^body-children]: `Split` creates its gutters as `SplitGutter` components and raw-appends their elements to the container's element ([`Split.ts:2184`](packages/lib/src/typescript/lib/layout/Split.ts#L2184)); it never adds them through `addComponent`, so `container.getComponents()` returns only the panes. Nothing else adds itself to the `Body` either: the overlay family (`Window`, `Dialog`, `Drawer`, `Rail`, `Notification`, `Menu`, `Tooltip`) mounts through `LayerManager.mount` ([`AbstractWindow.ts:793`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L793)), and no module in `packages/lib/src/typescript/lib/` calls `Body.getInstance().addComponent`. Independent confirmation from the current app: `Tab.syncUntabbedChildren` mints a tab for any container child no content entry owns, and today's demo app shows no phantom tab, so the `Body` has exactly the children the app adds.

[^weights]: Two facts force the weights. First, `Split` divides the container equally among panes with no stored size ([`Split.ts:2526`](packages/lib/src/typescript/lib/layout/Split.ts#L2526)), which would open the app with a 50% nav pane — hence the `paneSizes` seed. Second, `getPaneSizes` reports `px` for a pane explicitly pinned with `weight: 0` and `ratio` for every other pane ([`Split.ts:1259-1284`](packages/lib/src/typescript/lib/layout/Split.ts#L1259)), so `weight: 0` on the nav is also what makes the persisted entry an absolute width — correct for a nav pane, whose labels do not get longer when the window does. The content pane needs a positive weight rather than no weight at all, or it is not the resize absorber and the split drifts back toward an equal division. SQLAdmin — the library's other worked example, a sibling checkout rather than part of this repo — records that requirement in exactly these terms in `frontend/src/shell/SqlAdminShell.ts`'s `buildWorkArea`, where the sidebar takes `{ weight: 0, collapsible: false }`, the Dock takes `{ weight: 1 }`, and a comment states that "a bare, unweighted Dock would report no preferred size and steal the sidebar's seed back toward an equal split". `applyPendingSizes` runs immediately after `recalculateSizes` inside `doLayout` ([`Split.ts:2190-2191`](packages/lib/src/typescript/lib/layout/Split.ts#L2190)), so the seed overwrites the equal division rather than being overwritten by it.

[^flat-routes]: Putting the category in the URL (`/#/layouts/split`) would break every existing bookmark and every route named in the plans under `plans/implemented/`, several of which cite specific demo routes as verification handles. The category is presentation: it decides which tree row the leaf hangs under and nothing else. Keeping `"/:section"` also means `showSection` stays a one-segment lookup, and the "URL names the section the moment its row is clicked" ordering that today's `on("select")` comment records ([`main.ts:111-116`](packages/lib/src/typescript/main.ts#L111)) carries over unchanged.

[^slug-module]: `demoSections.ts` has to import all 32 panel modules to hold their factories, which transitively pulls in CodeMirror, Lexical, d3 and elkjs. A unit test for `slugify` has no business loading any of that, and the transform is worth pinning: two regexes decide all 32 URLs, and the trailing-dash strip is the single character standing between `/#/misc` and `/#/misc-`. A module holding only `slugify` and importing nothing keeps that test free. `DemoSectionDeck` stays panel-free for the same reason, by importing `DemoSection` as a type only — `import type` is erased, so the deck test loads `Container`, `Card` and `Component` and nothing else.

[^url-first]: The question of whether selection should survive a reload is already answered in the affirmative by the current app, and the answer is the URL fragment rather than persisted state: `router.start()` applies the current hash synchronously before the first layout pass, so a reload of `/#/codeeditor` re-opens `CodeEditor` with no flash of another panel. Keeping the router as the single source of truth is what makes that work — the tree's `"selection"` handler navigates instead of switching the pane itself, so there is exactly one path into `deck.show`. A second, persisted "last section" store would compete with the URL on every load and is not added.

[^persist-scope]: The expanded-category set is deliberately not persisted: `select(slug)` expands the routed section's category on every load, so the one category a reader is working in is already open, and the other six starting collapsed is what makes the nav compact. A collapsed nav pane is not persisted either — a reload returning it expanded is recoverable in one gesture, whereas a persisted collapse plus a lost or stale pane-size entry could open the app with no visible nav at all.

[^no-tab-coupling]: Checked rather than assumed. `grep` across every demo-app file for `getParent`, `activeIndex`, `ActiveTab`, `onActivate`, `"activate"`, `isRendered`, `tab bar`, `tabBar` and `TabBar` returns five hits outside `main.ts`, none of them a dependency. [`LayoutSerializationPanel.ts:35`](packages/lib/src/typescript/LayoutSerializationPanel.ts#L35)'s `activeIndex: 1` belongs to a `LayoutState` literal describing that panel's own three inner content panels, not the app's container — so the `Tab.activeIndex` handling in `layout/LayoutSerialization.ts` is untouched by this change, and no demo serialises the app's own layout. [`ContentBoxPanel.ts:172`](packages/lib/src/typescript/ContentBoxPanel.ts#L172) and `:186` name `TabBar` only as prose analogies in comments. [`BaselinePanel.ts:27`](packages/lib/src/typescript/BaselinePanel.ts#L27) and `:96` are the cosmetic offset handled above. No panel subscribes to a `Tab` event, reads a tab index, or is constructed with an index-keyed argument. Every registered factory is synchronous (`() => new XPanel()`), so `Tab`'s spinner placeholder and async-factory rejection paths were never exercised and nothing is lost by leaving them behind.


---

## Implementation Notes

Implemented as planned: the `Split`-hosted category `Tree`, the `Card`-keyed
deck, the five new modules, and all 32 slugs unchanged. The label set and the
label→panel mapping were diffed against the pre-change `main.ts` and are
byte-identical, so every one of the 32 bookmarks resolves to the same panel it
did before. What follows is what the plan said that turned out not to hold, and
the places the implementation went beyond it.

### Deviations

**A third test file was added: `packages/lib/tests/unit/demo/demoLayoutStore.test.ts`.**
The plan's file list names two test files and gives step 6 the verification
"`npm test` passes (`typecheck:test` covers this file)" — which type-checks the
store but asserts nothing about it. `loadPaneSizes` is documented as falling
back "when none is saved, unparseable, or malformed", and none of those three
branches is reachable by any prescribed test or by any manual step: manual step
4 drags the gutter and reloads, which exercises only the happy round trip. The
new file pins the round trip plus the absent, unparseable, non-array and six
malformed-entry cases, and leaves *fit* to `isRestorableSizes` exactly as the
plan's validation split intends.

**A fourth test file was added: `packages/lib/tests/component/demo/DemoNavigator.test.ts`.**
The plan lists only cases 1 to 5 as unit-testable and routes the nav's own
behaviour to manual steps 1 and 3. That was too pessimistic: three of the
plan's `## Architecture Decisions` claims about `DemoNavigator` are reachable
offline, so a manual step was not an acceptable substitute for them.

Two seams make it work, both with precedent in this suite. `vi.mock` on
`./demoSections.js` supplies stub categories, so the real 32-panel table —
and CodeMirror, Lexical and elkjs behind it — is never imported; the file runs
in about a second, and `tests/component/diagram/ElkLayoutEngine.test.ts` mocks
a dependency the same way. Selection is then driven through `_selectAtIndex`,
the entry point a real row gesture reaches, borrowed from
`tests/component/tree/Tree.test.ts`'s own `asPrivate` white-box seam —
necessary because `selectNode` deliberately does not emit and so cannot stand
in for a click.

An earlier draft of these notes claimed the handlers were unreachable offline
because `Tree` emits `"selection"` only on the click path. That was false, and
it is worth recording as the mistake it was: `Tree`'s own `on` docs say "a
click or key press", the arrow/Home/End path reaches `_notifySelectionChange`
through `_selectAtIndex`, and `Tree.test.ts` was already driving a selection
listener in this harness. Only `selectNode` is exempt, which is what makes
`select` loop-safe but says nothing about testability. The real obstacle was
only ever the import graph, and `vi.mock` removes it.

What is still manual is the part that genuinely needs a browser: that the
right panel appears, that the highlight moves, and that a category click
leaves the content pane alone. Taking the categories as a constructor
parameter, the way `DemoSectionDeck` takes its sections, would drop the mock
entirely; that is a plan-level design change and not one to make
mid-implementation.

### Corrections to the plan

**`## Internal Structure` gives the wrong mechanism for the deck's
`getLayoutManager()` cast.** It says the `Card` "is already attached by the time
the constructor body runs — `Container`'s `applyOptions` dispatches
`setLayoutManager` during `super()`". That is true for a *caller-supplied*
`layoutManager` option, but the deck passes the `Card` as a *subclass default*,
which `Component` stores in `_defaultLayoutManager` and attaches lazily on the
first `getLayoutManager()` call. So the `this._card = this.getLayoutManager() as
Card` line is itself what attaches the card. The line order the plan gives is
correct either way; only the explanation was wrong, and the code comment now
records the real mechanism.

**`main.ts` departs from the plan's code block in two places, both because the
block violates a rule document.** The plan prescribes
`demoNav.setMinSize({ width: NAV_MIN_WIDTH, height: 0 })` as a statement of its
own; `CODE_CONVENTIONS.md` requires a component to be configured through its
options bag at instantiation, with `setX` reserved for runtime changes, and
`minSize` is an ordinary `ComponentOptions` field. It is therefore passed as
`new DemoNavigator(router, { minSize: … })`. The plan's block also leaves
`NAV_MIN_WIDTH`, `GUTTER_SPACING` and the `height: 0` without the *why* the
global magic-number rule requires alongside the *what*; all three now carry it —
`GUTTER_SPACING` naming `docs/layouts/Split.md`'s worked example as its source,
and `height: 0` recording that a horizontal `Split` clamps a drag against
`min.width` only. Neither change alters behaviour.

**The plan's `demoLayoutStore.ts` block carries a redundant cast and a false
comment explaining it.** It ends `loadPaneSizes` with `return entries as
LayoutSize[]`, commented "`Array.every` does not narrow the array's element
type, so the assertion stands in for what it proved". `Array.every` *does*
narrow it: its type-predicate overload is declared `this is S[]`
(`lib.es5.d.ts:1438`), so the `if (!entries.every(isLayoutSize))` early return
narrows `entries` itself. Verified with a strict-mode probe of the same shape,
which compiles with no cast. The cast and the comment are both gone.

**The plan's case 8 and the `main.ts` comment quoting it overstate parity on an
unknown slug.** Both say the fallback matches the old tab strip, "where an
unmatched slug left the `Tab` on index 0". The old `showSection` was a *no-op*
on a miss, so mid-session the panel already showing stayed put; index 0 was
merely what happened to be open on a fresh load. The new handler always shows
the default section. That is the better behaviour — a miss now lands somewhere
legible instead of depending on what was open — but it is a real change, so the
comment now states it rather than claiming parity. The behaviour itself is the
plan's and is unchanged.

**Step 9's orphan sweep expects zero matches from a grep that cannot return
zero.** `grep -rn "addSection\|slugs\[" packages/lib/src/typescript/` returns
four hits, all of them the library's own public `AccordionPanel.addSection`,
present unchanged on the phase start point. Scoped to the demo app
(`src/typescript/*.ts`) the sweep returns zero, which is what the step meant.
The `FlowDemoPanel` / `LayoutTestPanel` half of the step is exact: nine files,
the same nine.

**Step 14's and `## Verification`'s "no more than the 14 pre-existing warnings"
is stale.** `CODE_CONVENTIONS.md` records a standing zero-warning bar for
`npm run docs:api`. Measured 0 before this change and 0 after.

**No changelog or migration entry was added.** This change adds no public API
and alters no library behaviour — the two library edits are JSDoc sentence
rewords — and the changelog's consumer-facing Breaking/Added/Fixed sections have
never carried a demo-app-only entry. `changelog/next.md` and `migration/next.md`
are therefore untouched.

### Mutation proof

Every assertion was proved killable by the mutation it is meant to catch. The
plan's predictions were the floor, not the ceiling — the deck table undercounted
every row:

| Mutation | Plan predicted red | Observed red |
|---|---|---|
| Drop the `{ key: section.slug }` argument | 2, 3, 4 | 2, 3, 4, **5** |
| Register under the label (`{ key: section.label }`) | 3, 4 | **2**, 3, 4, **5** |
| Delete the `hasKey` pre-flight | 5 | **4**, 5 |

Case 1's three named mutations also all go red, two of them wider than the plan
names: dropping the trailing-`-` strip reds 2 of the 6 rows (the plan names 1),
dropping `toLowerCase()` reds all 6 (the plan names 1), and dropping the
leading-`-` strip reds exactly the 1 row the plan names.

The `DemoNavigator` cases were mutation-proved the same way, and every one of
them can fail:

| Mutation of `DemoNavigator` | Observed red |
|---|---|
| Swap `expandNode` / `selectNode` in `select` | expand-before-select, routed-category-only |
| Drop `expandNode` from `select` entirely | those two, plus the leaf-names-the-URL case |
| Drop the `typeof node.data !== "string"` payload guard | category-navigates-nowhere |
| Drop the `if (entry)` guard in `select` | unknown-slug-is-a-no-op |

One mutation there is deliberately *not* killable, and it is not a gap:
dropping the `"/"` from `navigate("/" + node.data)` leaves all six green,
because `Router.navigate` runs its argument through `normalizePath`, which
prepends `"/"` after splitting and filtering empty segments. `navigate("beta")`
and `navigate("/beta")` are therefore the same call, so no assertion can
separate them — the mutation preserves behaviour rather than escaping a test.
The `!node` half of the payload guard is likewise unkillable here, since
`_selectAtIndex` always selects a row; it is defensive and matches
`DocsSidebar.onSelection`.

**One honest gap in the store's own suite.** `isLayoutSize`'s two value clauses
— `typeof size.value === "number"` and `Number.isFinite(size.value)` — are
individually redundant for anything `JSON.parse` can produce, since
`Number.isFinite` does not coerce and so rejects `"220"` and `null` on its own,
as does `typeof`. Dropping either one alone leaves all eleven rows green;
dropping both reds the two value rows. The rows therefore pin the *pair*, and
the test says so rather than implying per-clause coverage. A genuinely
non-finite number cannot reach the guard at all — JSON has no `NaN` or
`Infinity` literal. Both clauses are kept because the plan prescribes both.
Separately, the `raw === null` early-out is unkillable and correctly so: without
it `JSON.parse(null)` yields `null`, which the array guard rejects, so the
fallback is reached either way. It is an early-out, not a behaviour, and no row
claims it.

### The gate that would have missed `main.ts`

`npm run typecheck` runs `tsc -p tsconfig.lib.json`, whose `include` is
`["src/typescript/lib/**/*"]` — `main.ts` is not in that program. Verified
empirically rather than assumed: a deliberate `const NAV_MIN_WIDTH: string =
120;` in `main.ts` left `npm run typecheck` green (exit 0) and turned
`npm run typecheck:test` red (exit 2). Both were run for this change.

### Measured state

`packages/lib` 527 files / 8842 tests (from 523 / 8815 — four new files, 27 new
tests), `packages/qa` 20 / 453 unchanged, `npm run typecheck`,
`npm run typecheck:test`, `npm run lint`, `npm -w packages/lib run build` and
`npm run build:lib` all clean, `npm run docs:api` 0 warnings,
`npm run docs:llms:check` 0 unaccounted for, and `llms.txt` a one-line diff.

### Still owed: the manual pass

Nothing in this change's visible behaviour was exercised in a browser — the
implementer was barred from opening a window. All eight of `## Verification`'s
manual steps are still outstanding.

Two of them are now narrower than the plan wrote them. The nav-state half of
case 6 (the routed category expanded, the other six collapsed) and the
navigate / do-not-navigate halves of case 9 are covered by
`DemoNavigator.test.ts`; what those steps still own is what only a browser
shows — that the right panel appears, that the selection highlight moves to a
clicked category, and that the content pane stays put while it does. Cases 7,
8, 10, 11 and 12 are untouched by any test, and steps 7 (the judgement call on
`BaselinePanel`'s retained 40px offset) and 8 (the console sweep for `Card:`
warnings) remain the only check on their subjects.
