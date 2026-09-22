---
depends-on: [w3-0-bounding-sweep]
touches-shared:
  - packages/lib/src/typescript/lib/component/display/Glyph.ts
  - packages/lib/src/typescript/lib/component/display/Glyphs.ts
  - packages/lib/src/typescript/lib/core/StyleTraits.ts
  - packages/lib/src/typescript/lib/component/tree/TreeRow.ts
  - packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts
  - packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts
  - packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts
  - packages/lib/src/typescript/lib/component/button/Button.ts
  - packages/lib/tests/component/tree/Tree.test.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Glyph Name Setter — Implementation Plan

## Overview

Every place that changes which icon a `Glyph` shows today throws the old `Glyph` away and builds a new one. A new glyph costs a stylesheet-rule insert (when it carries a per-instance style), element creation (`<span>`, `<svg>`, `<use>`) and a sprite lookup (`querySelector`). The disposed one costs a rule delete and three handle releases. This plan adds `Glyph.setGlyphName(name)`, which changes the icon of an existing glyph in place: one attribute write on its `<use>` element. Every swap site in the library then renames instead of rebuilding. This is G17 of the render-performance campaign ([`99-synthesis.md:1768`](plans/research/render-review-2026-09-15/99-synthesis.md#L1768)), measured by W3.0 — the bounding sweep run before wave 3 — as a counter-only read: 12.03 swap operations per `tree-nodes` arrow key and 282.0 per `treetable-rows` expand/collapse toggle ([`96-w3-0-bounding-sweep.md:353`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L353)).

Three more changes ride along, each on the same code:

- **The sprite remembers what it mounted** (F13.9). `Glyphs.ts` keeps a map of mounted symbols instead of asking the DOM with `querySelector` on every glyph creation and every rename.
- **Tree toggles share one CSS rule for their pointer cursor.** A `Tree` or `TreeTable` caret gets `cursor: pointer` from a style trait instead of its own `#id` rule, so creating one inserts no rule.
- **Five glyph leaks are fixed** (F14.11 and three more of the same shape found while planning). `IconText.setGlyph`, `IconLabel.setGlyph`, `WindowHeader.setGlyph`/`clearGlyph`, `DialogTitleBar.setGlyph`/`clearGlyph` and the table's `GlyphRenderer.setValue` detach the glyph they drop with `removeComponent` and never dispose it — the shape of C10, the tree-table caret leak fixed in `594d0bf5`. Renaming removes the swap leaks; the removal paths gain the missing `dispose()`.

Library paths in link text below are relative to `packages/lib/src/typescript/lib/`.

---

## Architecture Decisions

### `Glyph.setGlyphName` renames the glyph in place

`Glyph` gains `setGlyphName(name)`, the setter twin of the existing `getGlyphName()` ([`Glyph.ts:342`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L342)). It follows the shape of `Glyph.setAnimated` ([`Glyph.ts:494-535`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L494)): a same-value early return, the cached field updated first, and a DOM write only when the glyph already has an element. The SVG child stays a raw handle written through `DOM.sink`, exactly as `createRootElement` builds it today ([`Glyph.ts:699-732`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L699)).[^rename-precedent]

The name stays the constructor's required first argument. It does not become a `GlyphOptions` field.[^no-option]

### What a rename keeps and what it changes

A rename changes only which registry entry the glyph paints. Everything else lives on the same instance and element, so it survives by construction.

| Aspect | After `setGlyphName(next)` |
|---|---|
| Same name as now | Nothing happens: no write, no read |
| Name not registered | Throws `Error("Unknown glyph: " + next)`, the constructor's message. The glyph is left exactly as it was |
| Instance, id, root `<span>`, `#id` rule | Kept. No rule is inserted or deleted |
| Size (`preferredSize`, pinned min/max, the inline width/height) | Kept. No glyph size depends on its name |
| Colour, cursor, pointer events, transform, style trait, class tokens a caller added | Kept |
| Accessibility | Kept. A caller's `aria-*` on the root is untouched; a new inner `<svg>` gets the same `aria-hidden="true" focusable="false"` |
| Animation (`setAnimated`, duration, the paused play state) | Kept. The `ts-ui-glyph-<kind>` class is on the root, which a rename never touches |
| Sprite | The new name's `<symbol>` is mounted if it is not yet, then the `<use>` points at it |
| Not yet rendered | Only the cached name and definition change; the first render builds the new icon |

Kind changes rebuild only what the kind owns inside the root:

| Before → after (rendered) | DOM work |
|---|---|
| svg → svg | one `apply(use, { setAttr: { href } })` |
| char → char | one `apply(root, { text })` |
| svg → char | remove the `<svg>`, release its two handles, write the character, apply the char defaults (below) |
| char → svg | clear the text, then build `<svg><use/></svg>` as `createRootElement` does |

A character glyph starts with `line-height: 1` and `text-align: center` unless the caller set its own ([`Glyph.ts:285-296`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L285)). An svg → char rename applies the same defaults under the same guard. A char → svg rename leaves them in place; they have no visible effect on an SVG glyph.[^kind-change]

### The sprite keeps a map of mounted symbols

`Glyphs.ts` replaces the `querySelector` idempotency check in `_addSymbolToSprite` and the lookup in `_removeSymbolFromSprite` ([`Glyphs.ts:153-198`](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L153)) with a module-level `Map<string, { symbol: Handle; path: Handle }>` of the symbols it has mounted. A symbol is then mounted once per name and nothing queries the DOM. Without it a rename would still pay one `querySelector` per call.[^symbol-map]

### Every swap site renames; every removal disposes

Each site below keeps its current structure. It gains one branch: when a glyph already exists and a new name is wanted, it calls `setGlyphName` and returns. A path that drops a glyph for good disposes it.

| Site | Today | After |
|---|---|---|
| `TreeRow.setRowData` caret ([`TreeRow.ts:228-262`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L228)) | dispose + new `Glyph` on every `expanded` flip | branch → branch renames; leaf ↔ branch and the loading spinner keep today's create/dispose |
| `IconLabelTreeNodeRenderer.update` icon ([`tree/renderer/IconLabel.ts:91-107`](packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts#L91)) | dispose + new | renames; builds only the first icon |
| `GlyphListItemRenderer.update` icon ([`list/renderer/Glyph.ts:89-110`](packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts#L89)) | dispose + new | name → name renames; name ↔ none keeps create/dispose |
| `TreeCellRenderer.refreshToggle` ([`TreeCell.ts:231-255`](packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L231)) | remove + dispose + new on every state change, depth-only changes included | branch → branch renames; leaf ↔ branch keeps create/dispose |
| table `GlyphRenderer.setValue` ([`renderer/Glyph.ts:43-71`](packages/lib/src/typescript/lib/component/table/cell/renderer/Glyph.ts#L43)) | remove, **never disposed** | name → name renames; name → empty disposes |
| `HeaderCell._mountHeaderGlyph` ([`cell/Header.ts:344-381`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L344)) | dispose + new | a rendered glyph renames; the rest unchanged |
| `Button.setGlyph` ([`Button.ts:1843-1877`](packages/lib/src/typescript/lib/component/button/Button.ts#L1843)) | guard, then new + content-row rebuild + dispose + size recompute | an existing glyph renames; the build path runs only when there is none |
| `WindowHeader.setGlyph` / `clearGlyph` ([`WindowHeader.ts:286-324`](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L286)) | remove, **never disposed** | an existing glyph renames; `clearGlyph` disposes |
| `DialogTitleBar.setGlyph` / `clearGlyph` ([`overlay/Dialog.ts:313-344`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L313)) | remove, **never disposed** | an existing glyph renames; `clearGlyph` disposes |
| `IconText.setGlyph` ([`IconText.ts:126-133`](packages/lib/src/typescript/lib/component/display/IconText.ts#L126)) | remove, **never disposed** | renames |
| display `IconLabel.setGlyph` ([`display/IconLabel.ts:138-145`](packages/lib/src/typescript/lib/component/display/IconLabel.ts#L138)) | remove, **never disposed** | renames |

Everything built on these inherits the change: `Tab.setTabGlyph` → `TabBar.setEntryGlyph`, `TabWindow.setGlyph`, `VideoPlayer`'s play/mute/fullscreen buttons, `ScrollStrip`'s arrows and the column filter's operator button all go through `Button.setGlyph`; `Window.setGlyph` goes through `WindowHeader.setGlyph`; `Dialog`'s severity header goes through `DialogTitleBar.setGlyph`.[^every-site]

A caller that holds a glyph from `getGlyph()`, `getToggle()` or `getGlyphComponent()` now keeps a live reference across a swap, together with any style it set on it.[^button-rename]

### Tree toggles take their cursor from a shared trait

`core/StyleTraits.ts` gains `TREE_TOGGLE_TRAIT` (`{ name: "tree-toggle", declarations: { cursor: "pointer" } }`). `TreeRow` and `TreeCellRenderer` build their caret as `new Glyph(caret, { styleTrait: TREE_TOGGLE_TRAIT })` and drop `toggle.setCursor("pointer")`. The toggles share one `.ts-ui-component.ts-ui-trait-tree-toggle` rule, and a new toggle inserts no `#id` rule of its own. This mirrors `GLYPH_XS_INK_TRAIT`, which two unrelated owners' glyphs share the same way ([`StyleTraits.ts:26-55`](packages/lib/src/typescript/lib/core/StyleTraits.ts#L26)).[^trait]

The toggle keeps its `Glyph` class token and gains `ts-ui-trait-tree-toggle`, so no consumer selector loses a match. `getCursor()` still reads `"pointer"`.

### `IconText` resolves its glyph and text once

`IconText`'s constructor builds its `Glyph` and `Text` from the effective values — the options bag's `glyph`/`text` if given, else the positional arguments — and no longer dispatches `setGlyph`/`setText` afterwards. This is the display `IconLabel`'s own constructor, which already does it ([`display/IconLabel.ts:87-98`](packages/lib/src/typescript/lib/component/display/IconLabel.ts#L87)).[^icontext-ctor]

### Leak tests follow C10's round-trip test

Each leak gets a round-trip test in its class's own test file, copied from C10's `expectRoundTripStrandsNothing` ([`TreeCellRenderer.test.ts:122-184`](packages/lib/tests/component/table/cell/TreeCellRenderer.test.ts#L122)): build, swap or clear the glyph several times, dispose, twice over, and assert that the live `Component` count (`Diagnostics.counters()`) and `_ruleCacheKeys().length` are unchanged by the second pass. Each fails today.[^leak-tests]

---

## Public API

```typescript
// component/display/Glyph.ts
class Glyph extends Component<GlyphOptions> {
    /**
     * Changes which registry glyph this Glyph shows, keeping the instance,
     * its element and everything set on it.
     * @throws Error - when `name` is not registered ("Unknown glyph: <name>").
     */
    setGlyphName(name: string): this;

    /** Now documented as the name the glyph currently shows. */
    getGlyphName(): string;
}
```

- Backing field: the existing `private _name: string`, with `private _def: GlyphDef` beside it. No `GlyphOptions` field.
- Every `Glyph` subclass inherits `setGlyphName` (`ButtonIconGlyph` is the one renamed through `Button.setGlyph`).
- Behaviour changes on existing public methods, no signature change: `Button.setGlyph`, `WindowHeader.setGlyph`/`clearGlyph`, `DialogTitleBar.setGlyph`/`clearGlyph`, `HeaderCell.setHeaderGlyph`, `GlyphRenderer.setValue`, `IconText.setGlyph`, `IconLabel.setGlyph`, `TreeRow.getToggle`, `TreeCellRenderer.getToggle`.
- `TREE_TOGGLE_TRAIT` is internal: `core/StyleTraits.ts` is not re-exported from any entry point.

---

## Internal Structure

### `Glyph.ts`

New private state, written only at render time (never during the `super()` cascade), so plain initializers are safe:

```typescript
/** The inner `<svg>` of a rendered SVG glyph; null for a char glyph or before render. */
private _svgHandle: Handle | null = null;
/** The `<use>` inside `_svgHandle`, whose `href` names the sprite symbol. */
private _useHandle: Handle | null = null;
```

The setter and its helpers:

```typescript
setGlyphName(name: string): this {
    if (name === this._name) {
        return this;
    }

    const def = lookupGlyph(name);
    if (!def) {
        throw new Error("Unknown glyph: " + name);
    }

    const previous = this._def;

    this._name = name;
    this._def  = def;

    if (def.kind === "char" && previous.kind === "svg") {
        this.applyCharDefaults();
    }

    const root = this.getElement();
    if (root) {
        this.repaintName(root, previous);
    }

    return this;
}

/** Rewrites the rendered root's content for the new `_def`; see the kind-change table. */
private repaintName(root: Handle, previous: GlyphDef): void {
    if (previous.kind === "svg" && this._def.kind === "svg") {
        ensureGlyphSprite();
        ensureGlyphSymbolMounted(this._name);
        DOM.sink.apply(this._useHandle!, { setAttr: { href: "#" + GLYPH_SYMBOL_ID_PREFIX + this._name } });

        return;
    }

    if (previous.kind === "svg") {
        this.unmountSvgChild();
    }

    if (this._def.kind === "char") {
        DOM.sink.apply(root, { text: this._def.char });

        return;
    }

    DOM.sink.apply(root, { text: "" });
    this.mountSvgChild(root);
}
```

- `mountSvgChild(root: Handle): void` is today's `createRootElement` body from `ensureGlyphSprite()` through the two `trackHandle` calls ([`Glyph.ts:706-729`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L706)), plus `this._svgHandle = svg; this._useHandle = use;`. `createRootElement` calls it in place of those lines.
- `unmountSvgChild(): void` follows `Component.disposeFrame`'s order ([`Component.ts:1641-1646`](packages/lib/src/typescript/lib/core/Component.ts#L1641)): `DOM.sink.removeElement(svg)`, then for `use` and `svg` each `this.untrackHandle(h)` and `DOM.sink.release(h)`, then both fields to `null`.
- `applyCharDefaults(): void` is the constructor's `if (def.kind === "char") { … }` body ([`Glyph.ts:288-296`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L288)), moved out unchanged; the constructor calls it under the same `if`.

### `Glyphs.ts`

```typescript
/**
 * Every `<symbol>` mounted in the sprite, by registry name, with its `<path>`
 * child — the sprite's own record of what it holds, so mounting and removal
 * never query the DOM.
 */
const _mountedSymbols: Map<string, { symbol: Handle; path: Handle }> = new Map();
```

- `_addSymbolToSprite(name, def)`: return early when `!_spriteElement || def.kind !== "svg" || _mountedSymbols.has(name)`; otherwise build and append as today, then `_mountedSymbols.set(name, { symbol, path })`.
- `_removeSymbolFromSprite(name)`: read `_mountedSymbols.get(name)`; when present, `removeChild(_spriteElement, symbol)`, `release(symbol)`, `release(path)`, `_mountedSymbols.delete(name)`.
- Neither function calls `DOM.source.querySelector` or `DOM.source.escapeSelector` any more.

### `TreeRow.ts` — the toggle block moves into one method

`setRowData` keeps its `toggleUnchanged` computation and field writes; its `if (!toggleUnchanged) { … }` body becomes a call to a new private method:

```typescript
if (!toggleUnchanged) {
    this.rebindToggle(hasChildren, expanded, loading);
}

/**
 * Brings the toggle slot in line with a changed hasChildren / expanded /
 * loading triple. A branch that stays an idle branch keeps its caret and only
 * renames it; any other change disposes what the slot held and builds what the
 * new state needs.
 */
private rebindToggle(hasChildren: boolean, expanded: boolean, loading: boolean): void {
    const caret = expanded ? "caret-down" : "caret-right";

    if (this._toggle && hasChildren && !loading) {
        this._toggle.setGlyphName(caret);

        return;
    }

    // Today's lines 229-261, unchanged except the caret construction:
    //   const toggle = new Glyph(caret, { styleTrait: TREE_TOGGLE_TRAIT });
    //   toggle.clearInsets();
    //   toggle.getAria().setHidden(true);
    // (the `toggle.setCursor("pointer")` line is deleted)
}
```

A non-null `_toggle` means the row was last bound as an idle branch, and `toggleUnchanged` is false, so reaching the rename branch means only `expanded` changed.

### `TreeCell.ts` — `refreshToggle`

```typescript
private refreshToggle(): void {
    const caret = this._expanded ? "caret-down" : "caret-right";

    if (this._toggle && this._hasChildren) {
        this._toggle.setGlyphName(caret);

        return;
    }

    // Today's removal block (removeComponent + dispose) and leaf early return, unchanged.

    const toggle = new Glyph(caret, { styleTrait: TREE_TOGGLE_TRAIT });

    toggle.clearInsets();
    toggle.getAria().setHidden(true);

    this._toggle = toggle;
    this.addComponent(toggle);
}
```

A depth-only change on a branch now renames to the same name, which is a no-op; `setTreeState` still runs `doLayout()` to move it.

### `Button.ts` — `setGlyph`

```typescript
setGlyph(name: string): this {
    if (this._glyph) {
        this._glyph.setGlyphName(name);

        return this;
    }

    // Today's build path from `const glyph = new ButtonIconGlyph(name)` through
    // `this.recomputePreferredSize()`, minus `outgoing` and `outgoing?.dispose()`:
    // with no current glyph there is nothing to dispose.
}
```

---

## Ordered Implementation Steps

1. **Record the base commit.** In the implementation worktree, before any edit: `git rev-parse HEAD`. Write the SHA into this plan's *Implementation Notes* — the orchestrator's A/B builds it as the `wt` arm.

2. **`component/display/Glyphs.ts`** — add `_mountedSymbols` and rewrite `_addSymbolToSprite` / `_removeSymbolFromSprite` as in *Internal Structure*. Check: `grep -n "querySelector\|escapeSelector" packages/lib/src/typescript/lib/component/display/Glyphs.ts` → no matches.

3. **`component/display/Glyph.ts`** — tests first (*Expected Behaviour* 1–11 in `tests/component/display/Glyph.test.ts`, a new `describe('Glyph.setGlyphName', …)`), then:
   - add `_svgHandle` / `_useHandle`, `mountSvgChild`, `unmountSvgChild`, `applyCharDefaults`, `repaintName`, `setGlyphName`;
   - `createRootElement` calls `mountSvgChild(root)`; the constructor calls `applyCharDefaults()`;
   - JSDoc: the class `@remarks` sentence "The registry name is fixed at construction … create a new one." ([`Glyph.ts:204-205`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L204)) becomes "Change the icon with `setGlyphName`, which keeps the instance and everything set on it."; `getGlyphName`'s summary becomes "Returns the registry name this Glyph currently shows."; `setGlyphName` gets full JSDoc (summary, the kept/changed list in prose, `@param`, `@returns`, `@throws Error - …`). No `{@link}` to a private member.

4. **`core/StyleTraits.ts`** — append `TREE_TOGGLE_TRAIT` with a doc comment in the file's style: who shares it (a `Tree` row's caret and a `TreeTable` tree cell's caret), why a trait (the two have no common class beyond `Glyph`), and that it keeps a new caret from inserting its own `#id` rule.

5. **`component/tree/TreeRow.ts`** — tests first (*Expected Behaviour* 12–15), then extract `rebindToggle` and switch the caret to the trait as in *Internal Structure*. Touch nothing outside `setRowData`'s toggle block, the new method, the import of `TREE_TOGGLE_TRAIT`, and the doc text: the class `@remarks` ("swap in a fresh `caret-down` / `caret-right` glyph on each state change", [`TreeRow.ts:40-42`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L40)) becomes "rename their caret between `caret-down` and `caret-right` in place"; `setRowData`'s remark ([`TreeRow.ts:208-212`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L208)) says compare-then-rename.

6. **`component/tree/renderer/IconLabel.ts`** — tests first (*Expected Behaviour* 16), then in `update`: when `next !== this._currentGlyph`, call `this._icon.setGlyphName(next)` if `_icon` exists, else run today's build lines (`getElement`, `new Glyph(next)`, `clearInsets`, `insertBefore`) without the `dispose`; set `_currentGlyph = next` after either branch. Update the class `@remarks` ("Because Glyph names are immutable …", [`:43-47`](packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts#L43)) and `update`'s summary. Leave the label lines of `update` alone.

7. **`component/list/renderer/Glyph.ts`** — tests first (*Expected Behaviour* 17), then in `update`: when the name changed, `next !== null && this._icon` renames; otherwise today's dispose / create lines run. Update the class `@remarks` ([`:38-41`](packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts#L38)) and `update`'s summary.

8. **`component/table/cell/renderer/TreeCell.ts`** — tests first (*Expected Behaviour* 18–22), then rewrite `refreshToggle` as in *Internal Structure*. Update the class doc ("rebuilt on each setTreeState call", [`:29-31`](packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L29)), `getToggle`'s paragraph ([`:100-103`](packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L100): a state change renames the toggle in place; only a row turning into a leaf destroys it), and `refreshToggle`'s own JSDoc.

9. **`component/table/cell/renderer/Glyph.ts`** (`GlyphRenderer`) — tests first (*Expected Behaviour* 31–32), then in `setValue`, after the existing early return: when `next !== null && this._glyph`, rename, set `_value`, return (no `doLayout` — the glyph keeps its bounds). Otherwise the removal block becomes `const outgoing = this._glyph; this.removeComponent(outgoing); this._glyph = null; outgoing.dispose();`, followed by today's create and `doLayout`. Update `setValue`'s summary ("Replaces the displayed glyph …").

10. **`component/table/cell/Header.ts`** — tests first (*Expected Behaviour* 33), then at the top of `_mountHeaderGlyph`: `const name = this._headerGlyph;` and `if (this._headerGlyphInstance && name && el) { this._headerGlyphInstance.setGlyphName(name); return; }`. Delete the later duplicate `const name` line. The glyph's size, transform, colour, class token and the renderer's insets stay as mounted.[^header-size]

11. **`component/button/Button.ts`** — tests first (*Expected Behaviour* 23–24), then `setGlyph` as in *Internal Structure*. Rewrite the `@remarks` sentence "A replaced glyph is destroyed … keeps the instance." to: a later `setGlyph` renames the same glyph in place, so a reference from `getGlyph` stays valid and keeps any per-instance style (colour, size pin, style trait); `clearGlyph` destroys it. Rewrite the comments inside the build path that mention a previous glyph.

12. **`component/container/WindowHeader.ts`** — tests first (*Expected Behaviour* 28–29), then `setGlyph` renames when `_titleGlyph` exists and otherwise runs today's build lines without the removal block; `clearGlyph` becomes remove + dispose (`const outgoing = this._titleGlyph; this._titleRow.removeComponent(outgoing); this._titleGlyph = null; outgoing.dispose();`). Update `setGlyph`'s `@remarks` ("Swaps the optional leading glyph child …").

13. **`overlay/Dialog.ts`** (`DialogTitleBar`) — tests first (*Expected Behaviour* 30), then the same two changes: `setGlyph` renames when `_titleGlyph` exists (no `doLayout` on that path); `clearGlyph` removes, disposes, then `doLayout()` as today.

14. **`component/display/IconText.ts`** — tests first (*Expected Behaviour* 25–27), then: the constructor builds `new Glyph(this._options.glyph ?? glyph)` and `new Text(this._options.text ?? text)` and drops the two late `setGlyph`/`setText` dispatches, with `IconLabel`'s comment adapted; `setGlyph` body becomes `this._glyph.setGlyphName(name); return this;`. JSDoc: "Changes the leading glyph to the given registry name, in place."

15. **`component/display/IconLabel.ts`** — tests first (*Expected Behaviour* 25–26), then `setGlyph` as in step 14, with the same JSDoc.

16. **Full suite.** Run `npm test`. The tests whose assertion was the old instance swap were replaced in steps 5–15 (cases 12, 15, 17, 23, 25, 31, 33); retitle `tests/component/display/IconText.test.ts:40` and `IconLabel.test.ts:34` to "renames the glyph in place" as part of case 25. Any other failure is a finding to record in *Implementation Notes*, not an assertion to loosen.

17. **Docs and changelog** — per *Documentation Impact*.

18. **Regression checks** —
    - `grep -rn "names are immutable\|in-place name mutation\|registry name is fixed at construction" packages/lib/src packages/lib/docs` → no matches (four today).
    - `grep -rn 'setCursor("pointer")' packages/lib/src/typescript/lib/component/tree/TreeRow.ts packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts` → no matches.
    - `grep -rn "removeComponent(this._glyph)\|removeComponent(this._titleGlyph)" packages/lib/src` → no matches.

19. **Verification** — run everything in *Verification* except the in-engine A/B, which the orchestrator runs.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Glyph.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Glyphs.ts` |
| Modify | `packages/lib/src/typescript/lib/core/StyleTraits.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/TreeRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Glyph.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowHeader.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/IconText.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/IconLabel.ts` |
| Modify | `packages/lib/tests/component/display/Glyph.test.ts` |
| Modify | `packages/lib/tests/component/tree/Tree.test.ts` |
| Modify | `packages/lib/tests/component/list/renderer.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/TreeCellRenderer.test.ts` |
| Modify | `packages/lib/tests/component/table/TreeBody.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/renderer.test.ts` |
| Modify | `packages/lib/tests/component/table/HeaderCell.disposal.test.ts` |
| Modify | `packages/lib/tests/component/button/Button.test.ts` |
| Modify | `packages/lib/tests/component/container/WindowHeader.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Modify | `packages/lib/tests/component/display/IconText.test.ts` |
| Modify | `packages/lib/tests/component/display/IconLabel.test.ts` |
| Modify | `packages/lib/tests/component/GlyphIconTraitDedup.test.ts` |
| Modify | `packages/lib/docs/components/Glyph.md` |
| Modify | `packages/lib/docs/components/IconText.md` |
| Modify | `packages/lib/docs/components/IconLabel.md` |
| Modify | `packages/lib/docs/components/Button.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `plans/glyph-name-setter.md` (step 1's SHA, in *Implementation Notes*) |

---

## Expected Behaviour

All cases 1–33 are unit tests under the offline test DOM (`installTestDOM`). "Rule ops" means recorded `ensureStyleRule`, `setRuleStyles` and `deleteStyleRule` writes. A test that asserts a sprite `<symbol>` is mounted must register an SVG glyph under a name used by no other test in its file: the sprite and the mounted-symbol map are module state that survives `DOM.reset()`. Read a `<use>`'s `href` with `DOM.source.getAttribute(use, 'href')` — the modelled source folds `setAttr` writes — and find the `<use>` as the existing `innerSvgOf` helper finds the `<svg>` ([`Glyph.test.ts:259-266`](packages/lib/tests/component/display/Glyph.test.ts#L259)).

**`Glyph.setGlyphName`** (`tests/component/display/Glyph.test.ts`)

1. `setGlyphName` with the current name returns the glyph and records no sink write.
2. `setGlyphName('nope')` throws `Unknown glyph: nope`; `getGlyphName()` still returns the old name; no sink write.
3. A rendered SVG glyph renamed to another SVG name: `getGlyphName()` is the new name, the `<use>` `href` is `#ts-glyph-<new>`, `getElement()` returns the same root, and the rename records no rule op, no `createElement`, no `createElementNS` of `svg` or `use`, no `removeElement` and no `release`.
4. An unrendered SVG glyph renamed, then rendered: the one `<use>` created points at the new name.
5. A rendered char glyph renamed to another char name: one `apply` on the root whose `text` is the new character.
6. A rendered SVG glyph renamed to a char name: one `removeElement`, a `release` of both the `<svg>` and the `<use>`, an `apply` on the root with the character; `getLineHeight()` is `"1"` and `getTextAlign()` is `"center"`.
7. A rendered char glyph renamed to an SVG name: an `apply` on the root with `text: ""`, then one `<svg>` appended to the root with a `<use>` pointing at the new name; `getLineHeight()` is still `"1"`.
8. A rename keeps instance state: same `getId()`, `getForegroundColor()`, `getPreferredSize()`, `getStyleTrait()`, and an animated glyph keeps `getAnimated() === 'spin'` with no `removeClass` of `ts-ui-glyph-spin` recorded; no `deleteStyleRule` for its `#id`.
9. Renaming two glyphs to an SVG name whose symbol is not yet mounted creates exactly one `<symbol>` in total.
10. Constructing and rendering three glyphs of one SVG name creates one `<symbol>`; `DOM.source.querySelector` (spied) is never called by either case 9 or 10.
11. `Glyph.unregister(name)` after a mount records a `removeChild` and releases of the symbol and its path; registering and rendering the name again mounts one new `<symbol>`.

**`TreeRow`** (`tests/component/tree/Tree.test.ts`)

12. Rebinding a branch row with only `expanded` flipped keeps the same toggle instance, now named `caret-down`, and records no rule op and no `createElementNS` (replaces the test at `:98`).
13. A branch toggle's root carries the class tokens `Glyph` and `ts-ui-trait-tree-toggle`; `getCursor()` is `'pointer'`; the toggle's own `#id` selector receives no `cursor` declaration.
14. The loading test at `:109` keeps passing unchanged: into loading disposes the toggle for a spinner, back out builds a toggle.
15. In a mounted tree, expanding the middle branch keeps that row's toggle instance, now `caret-down` (replaces the test at `:1628`). A second collapse and expand of a branch in a mounted `Tree` with an `IconLabelTreeNodeRenderer`, after one warm-up cycle, records no rule op.

**`IconLabelTreeNodeRenderer`** (`tests/component/tree/Tree.test.ts`)

16. An `update` whose resolver returns a different name keeps the same icon instance, renamed; it records no rule op and no `createElementNS`. The first `update` still builds the icon.

**`GlyphListItemRenderer`** (`tests/component/list/renderer.test.ts`)

17. A different glyph name keeps the same icon instance, renamed (replaces the test at `:99`); name → none still leaves no icon; none → name builds one.

**`TreeCellRenderer`** (`tests/component/table/cell/TreeCellRenderer.test.ts`, `tests/component/table/TreeBody.test.ts`)

18. `setTreeState(0, true, false)` then `(0, true, true)` keeps the same toggle instance, now `caret-down`.
19. `setTreeState(0, true, false)` then `(2, true, false)` keeps the same toggle instance and records no rule op, no `createElement` / `createElementNS`, and no `apply` carrying an `href`. (Today it builds a new toggle.)
20. Branch → leaf leaves `getToggle()` null; leaf → branch builds a toggle.
21. The two round-trip tests at `:122-184` keep passing.
22. A tree-cell toggle carries `ts-ui-trait-tree-toggle`, and after a `Tree` toggle has rendered, a `TreeCellRenderer` toggle's render records no `ensureStyleRule` for `.ts-ui-component.ts-ui-trait-tree-toggle` (in `GlyphIconTraitDedup.test.ts`, beside the two existing trait-sharing cases). In `TreeBody.test.ts`, a second `collapseAll` + `expandAll` on a rendered tree body, after one warm-up cycle, records no rule op.

**`Button`** (`tests/component/button/Button.test.ts`)

23. `setGlyph('check')` on a button showing `xmark` keeps the same glyph instance, now `check`, and records no rule op (replaces the test at `:557`). A foreground colour set through `getGlyph().setForegroundColor(...)` before the swap is still reported after it. A `SpinButton`'s glyph still reports `GLYPH_XS_INK_TRAIT` from `getStyleTrait()` after `setGlyph`.
24. `clearGlyph()` then `setGlyph('check')` builds a glyph, and the existing same-name test at `:543` keeps passing.

**`IconText` / `IconLabel`** (`tests/component/display/IconText.test.ts`, `IconLabel.test.ts`)

25. `setGlyph` keeps the same `getGlyphComponent()` instance at child index 0, with the new name.
26. A round trip — build, render, `setGlyph` three times, dispose — run twice leaves the live component count and `_ruleCacheKeys().length` unchanged by the second pass. **Fails today** (+3 and +3 per pass for each class).
27. `new IconText('unicode-arrow-up', 'pos', { glyph: 'unicode-arrow-down', text: 'bag' })` constructs 3 components (`Diagnostics.counters().componentsConstructed` delta), not 4, and still shows `unicode-arrow-down` / `bag`.

**`WindowHeader` / `DialogTitleBar`** (`tests/component/container/WindowHeader.test.ts`, `tests/overlay/Dialog.test.ts`)

28. `WindowHeader.setGlyph` twice keeps the same `getGlyph()` instance, with the second name.
29. A `WindowHeader` round trip — render, `setGlyph`, `setGlyph`, `clearGlyph`, dispose — run twice strands nothing, as in case 26. **Fails today** (+3 / +3).
30. The same two cases for `new DialogTitleBar('T', () => {}, false)`. **Fails today** (+2 / +2).

**`GlyphRenderer`** (`tests/component/table/cell/renderer.test.ts`)

31. Switching name keeps the same glyph instance with the new name and one glyph child (replaces the test at `:296`).
32. A round trip — render, `setValue(a)`, `setValue(b)`, `setValue(null)`, `setValue(a)`, dispose — run twice strands nothing. **Fails today** (+2 / +2).

**`HeaderCell`** (`tests/component/table/HeaderCell.disposal.test.ts`)

33. `setHeaderGlyph('unicode-arrow-up')` then `setHeaderGlyph('unicode-arrow-down')` on a rendered header cell keeps the same glyph instance, now `unicode-arrow-down` (replaces the test at `:140`); `setHeaderGlyph(null)` still disposes it.

**Manual, in the engine** — the orchestrator's A/B in *Verification*: geometry `=` and the census drop below. Which caret or icon an engine paints is not visible to the geometry gate; cases 3–7, 12, 16–18 carry that.

---

## Verification

**Implementer:**

- `npm run typecheck` — 0 errors.
- `npm test` — all green; cases 1–33 are the new coverage.
- `npm run lint` — 0 errors.
- The grep checks in steps 2 and 18.
- `npm run build:lib`.
- `npm run docs:api` — no warning beyond `master`'s 14 pre-existing ones. The bar is "no new warning", not zero.
- `npm run docs:llms:check` — passes. No class summary line changes, so `llms.txt` needs no regeneration.
- **Never run `packages/qa/runqa.sh`, `packages/qa/sweeps/*.sh`, MiniBrowser or the Tauri host.** Each opens a full-screen window.

**Orchestrator — the in-engine A/B, with the user's go-ahead.** Same session, MiniBrowser, the two W3.0 cells that bounded G17 (`tn` · `key`, `tt` · `toggle`), the base build at both ends.[^ab-shape]

1. Build the base arm — `runqa.sh`'s `wt` arm — from the SHA recorded in step 1, per [`packages/qa/README.md:87-98`](packages/qa/README.md#L87):

   ```sh
   cd /home/jika/typescript/typescript-ui
   git worktree add .worktrees/_g17-base <base-sha> --detach
   ln -sfn "$PWD/node_modules" .worktrees/_g17-base/node_modules
   (cd .worktrees/_g17-base/packages/lib && npm run build:lib)
   export QA_WT_LIB="$PWD/.worktrees/_g17-base/packages/lib"
   ```

2. Build the fix arm — the `main` arm — with `npm run build:lib` in the implementation worktree.
3. From the implementation worktree, run in this order, stopping at the first non-zero exit and re-running that cell whole:

   ```sh
   F='work=1&seam=1&geom=1'
   TN="panel=tree-nodes&drive=key&$F"
   TT="panel=treetable-rows&drive=toggle:20&$F"
   packages/qa/runqa.sh g17-tnk-base-a wt   "$TN"
   packages/qa/runqa.sh g17-tnk-fix-1  main "$TN"
   packages/qa/runqa.sh g17-tnk-base-b wt   "$TN"
   packages/qa/runqa.sh g17-tnk-fix-2  main "$TN"
   packages/qa/runqa.sh g17-tnk-base-c wt   "$TN"
   packages/qa/runqa.sh g17-ttg-base-a wt   "$TT"
   packages/qa/runqa.sh g17-ttg-fix-1  main "$TT"
   packages/qa/runqa.sh g17-ttg-base-b wt   "$TT"
   packages/qa/runqa.sh g17-ttg-fix-2  main "$TT"
   packages/qa/runqa.sh g17-ttg-base-c wt   "$TT"
   ```

   Ten runs, about four minutes.
4. Read each cell; the first run listed, `base-a`, is the geometry reference:

   ```sh
   python3 packages/qa/bin/qa-table.py packages/qa/results g17-tnk- --seam --before scan.classCounts.svg,scan.classCounts.use
   python3 packages/qa/bin/qa-table.py packages/qa/results g17-ttg- --seam --before scan.classCounts.svg,scan.classCounts.use
   ```

5. Score each cell with W3.0's decision rule ([`w3-0-bounding-sweep.md:114-160`](plans/implemented/w3-0-bounding-sweep.md#L114)), the three `base` runs standing for its plain arms: bracket = largest minus smallest `base` average; Δms = mean `fix` minus mean `base`; `work` on the census `seam.sink.ensureStyleRule + seam.sink.createElementNS + seam.source.querySelector`.

**Expected readings.** The census is deterministic, so both `fix` runs must match these to the hundredth. `tn` has 150 units, `tt` 20.[^census-prediction]

| Counter per unit | `tn` · `key` base → fix | `tt` · `toggle` base → fix |
|---|---|---|
| `seam.sink.ensureStyleRule` | 1.50 → 0 | 70.50 → 0 |
| `seam.sink.setRuleStyles` | 1.50 → 0 | 70.50 → 0 |
| `seam.sink.deleteStyleRule` | 1.50 → 0 | 70.50 → 0 |
| `seam.sink.createElementNS` | 7.03 → 1.03 | 141.00 → 75.00 |
| `seam.source.querySelector` | 3.50 → 0 | 70.50 → 0 |
| **census** | **12.03 → 1.03 (−91.4%)** | **282.00 → 75.00 (−73.4%)** |
| `seam.sink.createElement` | 3.50 → 0.50 | 70.50 → 37.50 |
| `seam.sink.removeElement` | 3.50 → 0.50 | 141.00 → 75.00 |
| `seam.sink.release` | 10.50 → 1.50 | 211.50 → 112.50 |

- **Geometry**: `=` in every run of both cells, on every phase.
- **Mount**: the `svg` and `use` columns (`before.scan.classCounts`) equal across all five runs of a cell.
- **Verdict**: `work` is `win` in both cells, so each cell reads `win` unless `ms` reads `regress`. Frame time is not predicted: the counters cannot price the stylesheet restyle these frames stop paying, which is exactly what this A/B measures (`99-synthesis.md:2190`). A `regress` in either cell, a geometry `DIFF`, or a census off the table stops the merge and returns to this plan.
- **Record**: append the two cells' readings to the `tree-nodes` and `treetable-rows` rows' *Validated* cells in `packages/qa/README.md`, as the W3.0 baseline lines there are written.
- **Clean up**: `git worktree remove .worktrees/_g17-base`.

---

## Documentation Impact

**TSDoc** (steps 3 and 5–15): `Glyph` class remarks, `Glyph.getGlyphName`, `Glyph.setGlyphName` (new), `Button.setGlyph`, `WindowHeader.setGlyph`, `DialogTitleBar.setGlyph`, `GlyphRenderer.setValue`, `IconText.setGlyph`, `IconLabel.setGlyph`, `TreeRow` class remarks, `TreeCellRenderer` class doc and `getToggle`, `IconLabelTreeNodeRenderer` and `GlyphListItemRenderer` class remarks. `Glyph` is already exported from `@jimka/typescript-ui/component/display`; nothing new is exported.

**Doc pages**

- [`docs/components/Glyph.md`](packages/lib/docs/components/Glyph.md): replace the *Notes* sentence "The registry name is fixed at construction — to swap glyph, discard the instance and create a new one." with "Change the icon with `setGlyphName(name)`." Add a `## Changing the glyph` section before `## Animation`: a two-line example (`const g = Glyph('xmark'); g.setGlyphName('check');`), then one paragraph saying the instance, its size, colour, animation and any style it carries are kept, an unregistered name throws like the constructor, and every built-in icon swap (`Button.setGlyph`, tree and table carets, list and tree icons, `IconText` / `IconLabel`) uses it.
- [`docs/components/IconText.md:38`](packages/lib/docs/components/IconText.md#L38) and [`docs/components/IconLabel.md:44`](packages/lib/docs/components/IconLabel.md#L44): the `setGlyph(name)` row becomes "Change the leading glyph to the given registry name, in place."
- [`docs/components/Button.md:163`](packages/lib/docs/components/Button.md#L163): "Construction, `setGlyph` / `clearGlyph` / `setInsets`, and theme changes all re-fire the auto-compute" becomes "Construction, adding or clearing a glyph, `setInsets`, and theme changes all re-fire the auto-compute; `setGlyph` on a button that already shows a glyph renames it and leaves the size alone".

**Changelog** — [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md):

- *Added › Components*: **`Glyph.setGlyphName(name)` changes an existing glyph's icon in place** — keeps the instance and everything set on it; an unregistered name throws, as the constructor does.
- *Changed › Components*: **Every built-in icon swap renames the glyph in place instead of building a new one** — list the sites (`Button.setGlyph` and everything built on it, `WindowHeader` / `Window.setGlyph`, `DialogTitleBar.setGlyph`, `HeaderCell.setHeaderGlyph`, `GlyphRenderer`, `IconText` / `IconLabel.setGlyph`, `Tree` and `TreeTable` carets, `IconLabelTreeNodeRenderer` and `GlyphListItemRenderer` icons). `getGlyph()`, `getToggle()` and `getGlyphComponent()` now return the same instance across a swap, and a style set on it survives. A tree expand or collapse no longer writes to the stylesheet; a tree caret takes its pointer cursor from the shared `ts-ui-trait-tree-toggle` class. Code that relied on a swap producing a fresh, unstyled glyph must reset that style itself; nothing else needs to change.
- *Fixed › Components*: **`IconText.setGlyph`, `IconLabel.setGlyph`, `WindowHeader.setGlyph` / `clearGlyph`, `DialogTitleBar.setGlyph` / `clearGlyph` and the table's `GlyphRenderer` no longer leak the glyph they replace or clear** — its element, `#id` rule and theme subscription stayed alive until garbage collection. A `Dialog` with a `severity` leaked one on every open. `IconText` with a `glyph` option no longer builds and discards a `Glyph` at construction. No consumer action is needed.

No migration note: no signature changes and no class token is removed.

**QA record** — the orchestrator's *Validated* lines, *Verification* above.

---

## Potential Challenges

- **A caret or icon that should change doesn't.** Geometry cannot see it. Cases 3–7, 12, 16–18 pin the name and the `<use>` `href` offline; do not skip them.
- **`_useHandle` is null on a rendered SVG glyph.** Only if `createRootElement` did not go through `mountSvgChild`. Case 3 renames a rendered SVG glyph and fails with a null-handle error if so.
- **Sprite tests interfering across a file.** The map and the sprite outlive `DOM.reset()`; give each mount-asserting test its own registered name.
- **`IconLabelTreeNodeRenderer.update` is shared with `list-and-tree-row-economy`** (its label half). Edit only the icon branch, so that plan's label changes merge cleanly.
- **One replaced test checks more than identity.** `HeaderCell.disposal.test.ts:140` also checks that the old instance's rules are gone; after a rename there is no old instance. Rewrite it to case 33 and drop that check with it.
- **The census drops less than the table says.** Every leaf ↔ branch transition still builds or disposes a toggle; that is already in the table. Anything more means a site still rebuilds — find it with `seam.sink.createElement` per unit before touching the numbers.

---

## Critical Files

- `packages/lib/src/typescript/lib/component/display/Glyph.ts` — `setAnimated` (the setter shape), `createRootElement` / `render`, the char-default block.
- `packages/lib/src/typescript/lib/component/display/Glyphs.ts` — the sprite functions being rewritten.
- `packages/lib/src/typescript/lib/component/button/Button.ts:1822-1898` — the same-name guard and dispose precedent, and the `setGlyph` being changed.
- `packages/lib/src/typescript/lib/core/StyleTraits.ts` — `GLYPH_XS_INK_TRAIT`, the trait precedent.
- `packages/lib/tests/component/GlyphIconTraitDedup.test.ts` — how trait sharing is asserted.
- `packages/lib/tests/component/table/cell/TreeCellRenderer.test.ts:122-184` — C10's round-trip leak test, copied for cases 26, 29, 30, 32.
- `packages/lib/src/typescript/lib/core/Component.ts:1317-1360`, `:1641-1646` — `trackHandle` / `untrackHandle` and the release order.
- `packages/lib/src/typescript/lib/component/display/IconLabel.ts:87-98` — the effective-value constructor `IconText` adopts.
- `packages/qa/README.md:87-98` and `plans/implemented/w3-0-bounding-sweep.md` *The decision rule* — the A/B recipe and scoring.

---

## Non-Goals

- **Keeping a leaf row's toggle alive and hidden.** Leaf ↔ branch transitions keep today's create/dispose, which is the whole remaining census in both cells.[^leaf-branch]
- **The `TreeRow` renderer and label path** (`list-and-tree-row-economy`, G24): only the toggle block moves.
- **Re-sizing a `HeaderCell` glyph on a theme change** — today's size re-derivation on swap was incidental; the header has no theme hook for it.[^header-size]
- **Stale sprite handles across `DOM.reset()` in tests.** The sprite has never been reset between tests; this plan only stops relying on `querySelector` to find what it holds.
- **Glyph construction sites that never swap** (`MenuItem`, `Notification`, `TabButton`'s modified badge, `SplitButton`, the calendar's nav buttons, the fixed carets of `ComboBox`, `Checkbox`, `Scrollbar`).

---

## Addendum: Census Evidence

Offline replicas of the two QA panels at the engine's geometry (5120 × 2075: 93 tree rows; 109 tree-table rows) reproduce the W3.0 baseline counts exactly — `tn` · `key` 3.50 glyph constructions and 1.50 rule ops per unit, `tt` · `toggle` 70.50 each — so the offline census predicts the engine's.

Classified by transition, per unit:

| Cell | Caret renamed | Icon renamed | Caret built (leaf → branch) | Caret disposed (branch → leaf) |
|---|---|---|---|---|
| `tn` · `key` | 1.00 | 2.00 | 0.50 | 0.50 |
| `tt` · `toggle` | 33.00 | — | 37.50 | 37.50 |

`tn`'s per-pair picture: a collapse of the first folder renames its caret and icon; the five freed pool slots rebind to rows further down, of which one is a folder (a new caret, and a `file` → `folder-open` icon rename); an expand reverses it. `tt`'s `collapseAll` turns 33 visible branch slots into collapsed roots (renames) and 73 leaf slots into roots (new carets); `expandAll` reverses it.

A runtime prototype of this plan's rename, sprite and trait changes, patched into a throwaway probe, gave per unit: `tn` 0 rule ops, 0.50 `<svg>` + 0.50 `<use>` created, 0.50 `removeElement`, 1.50 `release`; `tt` 0 glyph rule ops, 37.50 + 37.50 created, 75.00 `removeElement`, 112.50 `release`. Row and toggle geometry and every caret and icon name matched plain in all 150 and 20 units. The five leaks were confirmed by the round-trip measure of case 26: `IconText` and `IconLabel` +3 components and +3 rule-cache keys per pass, `WindowHeader` +3 / +3, `DialogTitleBar` and `GlyphRenderer` +2 / +2; `IconText` with a bag glyph constructs 4 components.

---

## Notes

[^rename-precedent]: Renaming is the fix slice 18 proposed (F18.4) and the synthesis scoped (G17). The alternatives were keeping both carets alive and toggling their visibility, which leaves permanently hidden content, and making every swap site cache glyphs per name, which multiplies instances. `Button.setGlyph`'s same-name guard ([`Button.ts:1844-1846`](packages/lib/src/typescript/lib/component/button/Button.ts#L1844)) shows the codebase already treats a glyph's name as its identity; the setter moves that guard into `Glyph`, where every site gets it. `setAnimated` is the nearest setter in the same class that updates a cached value and then, only if rendered, the element — the shape `setGlyphName` copies, including reading `getElement()` rather than creating one.

[^no-option]: ARCHITECTURE.md's rule 3 puts consumer-configurable properties on the options bag so construction and runtime stay in step. The glyph name already has its construction path: the required first constructor argument, which the constructor validates before `super()` so a bad name throws before any state exists. A second, optional `GlyphOptions.name` would give two ways to pass one value and a precedence question with no use case. `getGlyphName` / `setGlyphName` keep the `Glyph` prefix for the reason `getGlyphName` documents: `Component.setName` already exists and means a display title.

[^kind-change]: The registry mixes kinds: the built-in `unicode-arrow-*` entries are characters, the shipped icons are SVG, and a consumer resolver (a tree's icon, a list's `glyphField`, a table glyph column) can return either. Refusing a kind change would push every such site back to rebuilding. Clearing the root's text with `apply(root, { text: "" })` is safe because it only runs when the root holds a character and no `<svg>`. The char defaults are applied on svg → char because the constructor would have applied them to a char glyph; they are left on char → svg because `line-height` and `text-align` do nothing to an SVG glyph, and removing them would need to tell a default from a caller's own value.

[^symbol-map]: `_addSymbolToSprite` calls `DOM.source.querySelector(sprite, '#ts-glyph-…')` on every glyph render, and would on every rename, to learn whether the symbol exists (F13.9); the module already knows, because it mounts them. The map stores the `<path>` too, so `_removeSymbolFromSprite` releases both handles without querying either — today it needs two queries. The offline test DOM has no selector engine: its `querySelector` returns `null` unless a test seeds a result, so today every SVG glyph built offline appends another `<symbol>` and `<path>` to the sprite. With the map the offline sprite holds one symbol per name, as production does. Both the map and `_spriteMounted` are module state that `DOM.reset()` does not touch, which is why sprite tests need names of their own.

[^every-site]: The status pass named three hot sites and F14.11 two leaking ones. A census of every `new …Glyph(` construction found six more places that replace one glyph with another, three of them leaking in the same way as F14.11: `WindowHeader.setGlyph`, `DialogTitleBar.setGlyph` and the table's `GlyphRenderer`. `Dialog` builds its severity header by first setting the button-derived `circle-info` glyph and then the severity glyph ([`Dialog.ts:798`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L798), [`:822`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L822)), so every severity dialog leaked one. `GlyphRenderer` runs on every table row rebind in a glyph column. Leaving a known swap site on the old path, or a known leak open in a file this plan already edits, would split one pattern two ways.

[^button-rename]: For `Button`, renaming also skips `_rebuildContentRow()` and `recomputePreferredSize()`: the content row's shape depends on whether a glyph exists, not on which, and a glyph's size never depends on its name. It also stops a swap from dropping per-instance state the old glyph carried: a `SpinButton` or closeable `TabButton` glyph opts into `GLYPH_XS_INK_TRAIT` after construction ([`SpinButton.ts:141`](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L141), [`TabButton.ts:370`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L370)), a size pinned through `pinGlyphSize` lives on the glyph, and a colour set through `getGlyph()` did too. Today a `setGlyph` on any of them silently built a glyph without them.

[^trait]: With renaming alone, both W3.0 cells still insert and delete stylesheet rules every frame: each leaf → branch transition builds a caret whose `setCursor("pointer")` inserts an `#id { cursor: pointer }` rule (the carets' only per-instance declaration, confirmed by probe), and each branch → leaf disposal deletes one — 0.50 of each per `tn` key, 37.50 per `tt` toggle. In WebKitGTK any stylesheet mutation restyles the whole document for that frame, so removing some of a frame's rule ops buys little and removing all of them is the payoff. F18.4 and F22.3 both set that target at zero. A trait is the precedent for a style shared by instances of unrelated owners whose common class is `Glyph` itself. The alternative, file-local `Glyph` subclasses with a class-default cursor like `ButtonIconGlyph`, also inserts no rule, but replaces the carets' `Glyph` class token with a new class name, which the changelog treats as breaking for consumer selectors (0.8.0's `Body` class). A probe confirmed the trait path: after the one shared rule exists, a new caret records no rule op, carries `Glyph` and `ts-ui-trait-tree-toggle`, and `getCursor()` reads `"pointer"`.

[^icontext-ctor]: F14.11's first half. `IconText` builds a `Glyph` from the positional name, then, when the options bag carries a `glyph`, `setGlyph` builds a second one; a probe counts 4 components constructed where 3 suffice. `IconLabel` already resolves `this._options.glyph ?? glyph` before building and explains why in a comment. With renaming, the late `setGlyph` would only have cost a rename, but resolving once is the sibling's established shape and removes a construction-time rename on an unrendered glyph.

[^leak-tests]: C10's fix proved its leak with exactly this measure, and the phase 2 dispose registries use the same two quantities: the live component count and the rule-cache key count. Running the round trip twice and comparing the second pass isolates class-tier rules the first construction creates, which no dispose is meant to remove. A per-class test in its own file follows C10; the dispose registries' rows build a component and dispose it without ever swapping its glyph, so a swap leak never reaches them.

[^leaf-branch]: Keeping one hidden caret per leaf row would take the remaining census to about zero (75.00 → 0 per `tt` toggle), but it changes `getToggle()`'s contract (null for a leaf), the toggle hit tests in `Tree` and `TreeBody`, and trades churn for hidden content, which slice 18 rejected for the two-caret variant. With the trait, a created or disposed caret no longer touches the stylesheet, so what remains is element creation only. If the A/B shows the frames still pay for it, that is its own plan.

[^header-size]: `_mountHeaderGlyph` sizes the glyph from `headerGlyphPx()` and the renderer insets from the theme's cell padding at mount. `HeaderCell` has no theme hook that re-mounts it, so a header whose glyph never changes already keeps its mount-time size across a theme change; today only a swap re-derived it, as a side effect of rebuilding. The rename makes a swapped header behave like an unswapped one.

[^ab-shape]: The W3.0 cells scored ablation arms with `qa-ab.py`, which reads an arm only when its name is its run's `abl=` parameter and counts engagement from the arm's own `skipped.`/`memo.`/`dose.` counters. A library build has neither, so this A/B uses the `wt`/`main` pair `checkbox-action-activation` and `same-value-style-write-filter` used, read with `qa-table.py`, whose geometry column compares every run with the first one listed. Three base runs around two fix runs give the bracket three samples and cancel a linear drift across the cell, as W3.0's mirrored order did.

[^census-prediction]: The W3.0 rule for G17 assumed "a rename leaves one attribute write per swap and removes the rest", which predicts the whole census removed. The transition census in *Addendum: Census Evidence* shows part of it is not a swap: a row that turns from leaf to branch builds its first caret. What remains after the fix is exactly those carets: two `createElementNS` each (`<svg>`, `<use>`), with no rule and no `querySelector`. `tn`'s extra 0.03 is two first-time symbol mounts (`<symbol>` + `<path>`) during the phase, which the map keeps. Rows below the census line follow the same transitions and are listed so a mismatch can be located, not scored.

---

## Implementation Notes

(Step 1: record the base commit SHA here.)
