# Layout serialization

[`serializeLayout`](/api/layout/functions/serializeLayout) and [`restoreLayout`](/api/layout/functions/restoreLayout) capture and restore the **arrangement** of the container managers that own topology — [`Split`](/layouts/Split) pane ratios, [`Tab`](/layouts/Tab) order and active index, and floating [`Window`](/api/overlay/classes/Window) rects, state, and internal split/tab arrangement — as a plain, serializable [`LayoutState`](/api/layout/interfaces/LayoutState) object.

They do **not** serialize the component tree. A leaf panel is an arbitrary [`Component`](/api/core/classes/Component) subclass built imperatively with constructor arguments and post-construction wiring the framework cannot reconstruct from data. So the captured form is **topology + geometry only** — each leaf is recorded as a bare `{ kind: "panel", panelId }` reference, and on restore a caller-supplied [`LayoutFactory`](/api/layout/type-aliases/LayoutFactory) maps each `panelId` back to its content component. The library rebuilds the *containers*; the caller owns the *content*.

```
serializeLayout(root) ──► LayoutState ──► (persist / hold in memory)
                                            │
                          restoreLayout(root, state, factory)
```

## Panel identity

A panel that participates in serialization is keyed by a **stable string ID** read from its layout-constraint `name` — the same channel `Tab` already uses for tab labels:

```typescript
container.addComponent(inspectorPanel, { name: 'inspector' });
```

`Component.getId()` is a per-instance UUID that changes every run, so a panel **without** a constraint `name` cannot round-trip; serialization falls back to the UUID with a one-time console warning. Always assign a stable `name` to serialized panels.

## Capturing a layout

```typescript
import { serializeLayout } from '@jimka/typescript-ui/layout';

const state = serializeLayout(workspace);
localStorage.setItem('workspace', JSON.stringify(state));
```

`Split` sizes are captured as **ratios** (summing to ~1.0), not pixels, so a layout saved on one screen restores at the same proportions on a differently-sized one. `Window` rects stay absolute pixels and are clamped back into the viewport on restore. Open windows are gathered from [`Window.getOpenWindows()`](/api/overlay/classes/Window) into a `windows` array on the state, orthogonal to the in-root tree (windows mount on the document, not inside `root`).

## Restoring — runtime layout switching

`restoreLayout` is **not** startup-only. Hold several `LayoutState` objects — named workspaces, presets, a "reset" default — and call `restoreLayout` with any of them at any time. A switch may change the **full topology**: a panel that was a tab in one layout can be a split pane in another, or float into a `Window`.

```typescript
import { restoreLayout, LayoutFactory } from '@jimka/typescript-ui/layout';

// Build the panels once; the factory ALWAYS returns the same instance per id.
const panels = new Map([
    ['nav',       buildNavigator()],
    ['editor',    buildEditor()],
    ['inspector', buildInspector()],
]);
const factory: LayoutFactory = id => panels.get(id) ?? null;

restoreLayout(workspace, codingLayout,    factory);  // later…
restoreLayout(workspace, debuggingLayout, factory);  // a full re-arrangement
```

### The stable-instance factory contract

The factory **must return the same `Component` instance** for a given `panelId` on every call. Restore *parks and re-homes* the live panel rather than rebuilding it, so a panel's own state — scroll offset, form values, table column widths, selection — only survives a switch when the factory hands back the identical instance. Returning a fresh instance per call discards that state. Return `null` for an ID the app no longer provides; that leaf is skipped with a warning, and the rest restores cleanly.

### How restore works — park and rebuild

`restoreLayout` performs one pass:

1. **Park** every factory-known leaf — detach it from the live tree (and open windows) without destroying it, preserving its state.
2. **Tear down** all `Split`/`Tab` containers under `root` and close all open windows. These are cheap, stateless arrangement managers.
3. **Rebuild** the container tree from the target state.
4. **Re-home** the parked leaves into it via [`moveComponent`](/api/core/classes/Component).
5. **Apply geometry** — pane ratios, active tab, window rects.

Because the container tree is rebuilt from scratch each call, switching A→B→A reproduces A exactly with no residue from B, and no orphaned containers accumulate across switches. Restore runs as a discrete user action (typically behind a loading indicator), not on a hot path.

## The state schema

```typescript
interface LayoutState {
    version: 1;
    root:    LayoutNode;     // PanelNode | SplitNode | TabNode
    windows: WindowNode[];   // the orthogonal floating-window plane
}
```

| Node | Captures |
| --- | --- |
| [`PanelNode`](/api/layout/interfaces/PanelNode) | A content leaf — just its `panelId`. |
| [`SplitNode`](/api/layout/interfaces/SplitNode) | `direction`, child nodes, per-pane `ratios` (sum ~1.0) and `collapsed` flags. |
| [`TabNode`](/api/layout/interfaces/TabNode) | Child nodes in tab order plus the `activeIndex`. |
| [`WindowNode`](/api/layout/interfaces/WindowNode) | A `content` region tree (the float's internal split/tab arrangement), title `header`, `rect`, `state`, and the normal-state `restoreRect`. The legacy single-panel `panelId` is still read on restore as a fallback. |

Containers the serializer does not recognise (`Border`, `HBox`, `VBox`, `Accordion`, `Grid`, …) are treated as **opaque leaves**: the walk does not descend into them, and each is recorded as a single panel keyed by its own constraint `name`. Only `Split`/`Tab`/`Window` topologies are captured.

## Notes

- Leaf **content** is never written into `LayoutState`. Panel state is *preserved* across a switch by parking the same instance, but a panel that wants its own persistence (e.g. table column widths) exposes that itself.
- Persistence transport (localStorage, a server) and auto-save are the caller's concern — the API returns and accepts a plain object.

## See also

- [API: serializeLayout](/api/layout/functions/serializeLayout) · [restoreLayout](/api/layout/functions/restoreLayout)
- [`Split`](/layouts/Split) · [`Tab`](/layouts/Tab) — the recognised arrangement managers
- [Layout system](/concepts/layout-system) — constraint resolution
