# Documentation sweep — convert remaining `new X(...)` examples to callable form

## Context

The callable-components rollout ([callable-components.md](callable-components.md)) wrapped every concrete `Component` subclass, every concrete `LayoutManager`, and `ButtonGroup` in a `callable()` Proxy. The narrative documentation (intro, concepts, recipes, faq, troubleshooting, changelog) and the catalog landings have been updated to reflect this. The per-component and per-layout reference pages were intentionally skipped during that audit — they contain mostly mechanical `new X(...)` → `X(...)` swaps and were estimated at low value-per-edit relative to the wider narrative updates already shipped.

This plan covers that remaining surface: ~50 files of small, repetitive substitutions plus a handful of stragglers in the concepts directory.

## Approach

A two-pass strategy: an automated sed-style sweep for the obvious substitutions, then a manual review pass for the edge cases the regex won't get right.

### Pass 1 — automated substitution

For each file in the scope, replace every occurrence of `new <CallableName>(` with `<CallableName>(`, where `<CallableName>` is on the allowlist below. The trailing `(` anchor avoids matching `new Insets`, `new Map`, etc. in cases where the bare token could be substring-matched.

**Suggested shell driver:**

```bash
# Adjust the file list per pass — see "Files to touch" below.
NAMES='Panel|Button|HBox|VBox|Text|Component|Grid|Border|Window|Dialog|ComboBox|FieldSet|RadioButton|ButtonGroup|TextField|TextArea|Card|Tab|Split|Column|Row|Accordion|MenuBar|Menu|Table|List|MultiSelectList|Tree|Image|Slider|SpinButton|Checkbox|Label|Header|MenuItem|MenuSeparator|DateField|TimeField|PaginationBar|ProgressBar|ProgressSpinner|NumberSpinner|AutoCompleteField|ToggleButton|PasswordField|BulletedList|NumberedList|Glyph|IconLabel|IconText|Option|TablePanel|Body|BorderLayout|Absolute|Fit|ListItem|MenuBarButton|TabCloseButton|Legend|SplitGutter|AccordionHeader|Scrollbar'

for f in docs/components/*.md docs/layouts/*.md docs/concepts/accessibility.md docs/concepts/performance.md; do
    sed -i -E "s/\bnew (${NAMES})\(/\1(/g" "$f"
done
```

`\b` ensures word-boundary matching; the alternation list contains only names that are actually callable per the rollout. The `(` anchor is required to avoid clobbering identifiers like `new ButtonGroup` followed by a non-call usage (rare in docs but defensive).

**Codebase-divergence corrections (from pre-implementation audit):**

- `FontAwesomeIcon` was removed and replaced by the `Glyph` / `IconLabel` / `IconText` triplet (all callable). The doc pages `Glyph.md`, `IconLabel.md`, `IconText.md` exist; no `FontAwesomeIcon.md`.
- `Tooltip` and `Notification` are **not** callable — they expose static methods only (`Tooltip.attach`, `Notification.show`). Their doc pages use the static form and require no sweep.
- `VirtualScroller` is **not** callable — it must be constructed with `new`. The doc page already uses the `new` form correctly.
- `TableHeader`, `TableBody`, `TableFooter`, `TableRow` from the original allowlist are not the real export names — the table subpath exports them as bare `Header`, `Body`, `FooterRow`, `Row` (already covered by other allowlist entries; the original entries were harmless but redundant).
- `Legend`, `SplitGutter`, `AccordionHeader`, `Scrollbar` are callable and now included.

### Allowlist (names safe to convert)

All concrete `Component` subclasses:

`Panel, Body, Window, Dialog, Button, ToggleButton, RadioButton, SpinButton, TabCloseButton, MenuBarButton, TextField, TextArea, PasswordField, Checkbox, ComboBox, AutoCompleteField, DateField, TimeField, NumberSpinner, Slider, Text, Label, Header, Image, Glyph, IconLabel, IconText, FieldSet, Legend, ProgressBar, ProgressSpinner, PaginationBar, List, MultiSelectList, ListItem, BulletedList, NumberedList, Option, MenuBar, Menu, MenuItem, MenuSeparator, Table, TablePanel, Tree, Scrollbar, SplitGutter, AccordionHeader, Component, ButtonGroup`

(Excluded — not callable: `Tooltip`, `Notification` use static methods; `VirtualScroller` uses `new`.)

All concrete `LayoutManager` subclasses:

`Absolute, Accordion, Border, BorderLayout, Card, Column, Fit, Grid, HBox, Row, Split, Tab, Table, VBox`

(`BorderLayout` is an alias for layout `Border`; `Table` exists in both lists because there's a `Table` component and a `Table` layout — the regex hits both equally and the substitution is correct in both cases.)

### Denylist (do NOT convert — these are NOT callable)

| Class | Why |
|---|---|
| `Model`, `AbstractModel`, `Field` | Data layer — not wrapped |
| `Store`, `AbstractStore`, `MemoryStore`, `AjaxStore` | Data layer — not wrapped |
| `Proxy`, `AjaxProxy`, `MemoryProxy` | Data layer — not wrapped |
| `ModelRecord` | Data layer — not wrapped |
| `Binding` | Not a UI class |
| `Validator`, `FieldDecorator` | Not wrapped today (subject to a future plan) |
| `Insets`, `Size`, `Point`, `Border` (the geometry one), `BorderLine` | Value objects |
| `Aria`, `LayoutConstraints`, `AccordionConstraints` | Plain support classes |
| `RovingTabIndex` | Internal helper |
| `Tooltip`, `Notification` | Static API only — no `new`-form to convert |
| `VirtualScroller` | Not callable today; must be constructed with `new` |
| `Map`, `Set`, `Date`, `Promise`, `Error`, `Intl.NumberFormat`, etc. | JS builtins — should never be touched by the regex if word boundaries are respected |

The regex above only matches names on the explicit allowlist, so denylisted classes are safe as long as the script is run without modification.

### Pass 2 — manual review for edge cases

After the automated sweep, walk each modified file and check for:

1. **Imperative trees with multiple `.addComponent(...)` calls.** Where a doc example builds a small tree imperatively, fold it into a single declarative expression using `components: [...]` if the example was only meant to demonstrate construction (i.e. the named consts are never used downstream). Leave it alone if the named consts are referenced later (the aliasing constraint discussed in [callable-components.md](callable-components.md)).

2. **`setLayoutManager(new HBox())` style calls.** These get caught by Pass 1 and become `setLayoutManager(HBox())`. Optionally promote into the constructor options bag — `Panel({ layoutManager: HBox() })` — when the example is short enough to benefit.

3. **`Window` examples.** `Window` does NOT accept an options bag — only a positional `headerText`. Pass 1 converts `new Window('X')` to `Window('X')` correctly. Do not invent options-bag calls for Window in this sweep.

4. **Custom subclass examples.** When a doc shows a user writing their own class — `class CurrencyRenderer extends CellRenderer { ... }` — the inner `new Text()` constructions remain valid. Pass 1 will convert them to `Text()`, which also works. The choice between the two is purely stylistic; either is fine. Prefer keeping whatever Pass 1 produced unless the surrounding text is specifically about the subclass's lifecycle.

5. **`new MenuBar([...])` / `new Menu([...])`.** Both menu types accept positional args (the items array). Pass 1's substitution is correct. No need to convert to options-bag form.

6. **Buggy pre-existing examples.** During the narrative-doc audit, two bugs surfaced: `const Model = new Model({...})` (variable shadows class) in `recipes/component-options.md`, and `new VBox()` used as a container (VBox is a layout manager, not a Component) in `recipes/dialog-modal.md` and `recipes/floating-window.md`. Watch for similar patterns in the per-component pages; fix as encountered.

## Files to touch

### Concepts (2 files — leftover from the earlier audit)

- [docs/concepts/accessibility.md](docs/concepts/accessibility.md)
- [docs/concepts/performance.md](docs/concepts/performance.md)

### Per-component pages (~40 files)

Every file in [docs/components/](docs/components/) except [index.md](docs/components/index.md) (already updated):

- AutoCompleteField, Body, BulletedList, Button, ButtonGroup, Checkbox, ComboBox, DateField, Dialog, FieldSet, Glyph, Header, IconLabel, IconText, Image, Label, Legend, List, ListItem, Menu, MenuBar, MenuBarButton, MenuItem, MenuSeparator, MultiSelectList, Notification, NumberSpinner, NumberedList, Option, PaginationBar, PasswordField, ProgressBar, ProgressSpinner, RadioButton, Scrollbar, Slider, SpinButton, TabCloseButton, Table, TableInternals, TablePanel, Text, TextArea, TextField, TimeField, ToggleButton, Tooltip, Tree, VirtualScroller, Window

(`Notification.md`, `Tooltip.md`, `VirtualScroller.md` are still walked by the sweep — Pass 1's regex will simply find no matches because those classes are not on the allowlist. They are included so the per-file diff is auditable.)

Expect 1–4 `new X(` occurrences per file based on the initial grep.

### Per-layout pages (~12 files)

Every file in [docs/layouts/](docs/layouts/) except [index.md](docs/layouts/index.md) (already updated) and [Constraints.md](docs/layouts/Constraints.md) (mostly enum reference, may not have constructions):

- Absolute, Accordion, Border, Card, Column, Fit, Grid, HBox, Row, Split, Tab, VBox

### Out of scope

- [docs/api/](docs/api/) — auto-generated by typedoc from source; regenerated by `npm run docs:build`. Do NOT edit by hand. If something here looks wrong, fix the JSDoc in the source.
- [docs/data/](docs/data/) — these document `Model`, `Store`, `Proxy`, `ModelRecord`, `Binding`, all of which remain `new`-only.

## Verification

End-to-end checks, in order:

1. **Run the automated sweep** on the file lists above. Print a diff for review before committing.

2. **Confirm denylisted classes survived untouched**:
   ```
   grep -rn 'new \(Model\|Store\|MemoryStore\|AjaxStore\|Proxy\|AjaxProxy\|MemoryProxy\|Binding\|Insets\|ModelRecord\|Validator\)\b' docs/components docs/layouts docs/concepts/accessibility.md docs/concepts/performance.md
   ```
   Every match returned must still be a legitimate `new`-only construction. If any allowlist class was caught by accident, fix and re-run.

3. **Build the docs site**:
   ```
   npm run docs:build
   ```
   Vitepress must complete without errors. Any broken internal link from doc edits will surface here.

4. **Spot-check 3-4 random per-component pages** in the rendered output. Confirm:
   - The component construction example uses the callable form.
   - `instanceof` examples still read correctly (these usually didn't need touching).
   - Cross-links to /api/ pages still resolve.

5. **Manual Pass 2 review.** Walk each modified file and apply the optional improvements from "Pass 2 — manual review for edge cases" above. This is the higher-judgement step — it's fine to leave a file in its Pass 1 state if no improvements apply.

6. **Re-run the typecheck** (defence in depth — the docs don't compile, but examples should still parse):
   ```
   npm run typecheck
   ```
   This won't catch doc errors but confirms no Pass 2 edits accidentally touched source files.

## Things explicitly NOT done in this plan

- **No per-page rewrites for style.** Pass 1 is mechanical. Pass 2 is judgement-limited to the patterns enumerated above. Wholesale rewrites of doc structure or content are out of scope.
- **No data-layer changes.** `Model`, `Store`, `Proxy`, and friends remain `new`-only — the callable rollout did not cover them, and this plan does not change that.
- **No regeneration of the `api/` tree.** That's a separate concern handled by `npm run docs:build` from JSDoc in source.
- **No removal of `new`-form examples.** Both `new X()` and `X()` continue to work; the sweep replaces but doesn't outlaw. If a user-supplied example deliberately demonstrates the `new` form (for context with older docs or to show the equivalence), leave it.
