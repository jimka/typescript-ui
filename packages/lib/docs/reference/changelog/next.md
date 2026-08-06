# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Breaking changes

### Theme

`Theme.drawer.background` and `Theme.rail.background` are removed — both
were set to `'var(--ts-ui-body-bg)'` in every shipped theme, a redundant
alias with no per-theme value of its own. `Drawer` and `Rail` still paint an
opaque background by default; they now read `--ts-ui-body-bg` directly, the
same pattern `AbstractWindow` and `Dialog` already use. The rendered colour
is unchanged in every shipped theme. A custom theme that set
`drawer.background` or `rail.background` to something other than
`--ts-ui-body-bg` loses that override — supply a different value via
`Component.setBackgroundColor` on a `Drawer` / `Rail` instance instead.

### Component defaults

Fourteen components — `Tree`, `MenuBar`, `DiagramNode`, `DiagramGroupNode`,
`ScrollStrip`, `TabButton`, `StatusBar`, `TabBar`, `MenuSeparator`,
`SortPriorityBadge`, `Scrollbar`, `ToolBarSeparator`, `ChartLegend`, and
`Popover` — previously ignored a caller-supplied `backgroundColor` (and, on
`StatusBar`, `SortPriorityBadge`, and `Popover`, `foregroundColor`) and
always painted their own hardcoded default instead. Passing either option
now works as documented. No consumer action is needed unless code relied on
the option being silently ignored.

The same follow-up sweep now covers the rest of the constructor-time
clobbering-bug shape: `DiagramNode`, `DiagramGroupNode`, `StatusBar`,
`Popover`, `TabButton`, `MenuBar`, `Tree`, `TabBar`, `Checkbox`,
`RadioButton`, `Toggle`, `Slider`, and `AbstractChart` previously ignored a
caller-supplied `border`, `borderRadius`, `shadow`, `cursor`, `outline`,
`overflow`, `preferredSize`, `minSize`, or `maxSize` (depending on the
component) and always painted their own hardcoded default instead. Passing
any of these options now works as documented. No consumer action is needed
unless code relied on the option being silently ignored.

## Changed

### Editor

- **The `lexical` rich-text editor and its `@lexical/*` packages are upgraded
  from 0.46 to 0.49.** `MarkdownEditor` and its Markdown/table transformers
  build on the newer editor core; the full test suite and library build are
  unaffected. No consumer action is needed.

## Added

### Display

- **A fenced code block in `Markdown` with a supported language now renders
  with real syntax highlighting**, upgrading from a plain `<pre>` to a live
  [`CodeEditor`](/components/CodeEditor) once it loads. Supported fence
  languages: `js`/`javascript`/`jsx`/`mjs`/`cjs`, `ts`/`typescript`/`tsx`
  (both map to `CodeEditor`'s combined JavaScript/TypeScript grammar),
  `json`, `html`/`htm`, `sql`, and `md`/`markdown`. An unrecognised language,
  or no info string, still renders exactly as before — a plain `<pre>`.
  CodeMirror loads through a dynamic import that fires only once a fenced
  block actually needs it, so a `Markdown` instance with no fenced code (or
  only unsupported languages) pays no extra bundle cost. No consumer action
  is needed.
- **A fenced code block in `Markdown` now grows to fit its real rendered
  content, capped at 20 rows before its own vertical scrollbar takes over**,
  and no longer clips its last content row when a horizontal scrollbar
  appears for an overly long line — both driven by
  [`CodeEditor`](/components/CodeEditor)'s real measured content height
  rather than a fixed snapshot of the placeholder `<pre>`'s size. The
  underlying mechanism is a new opt-in `CodeEditor` option,
  `autoHeightMaxRows`, and a `"heightchange"` event; every other `CodeEditor`
  caller is unaffected, since the option defaults to unset (today's
  fixed-height, fill-parent behaviour). No consumer action is needed.
- **`Markdown` gains a new pure export, `extractMarkdownHeadings(source)`**,
  which computes a Markdown source string's heading outline —
  `{ id, text, depth }[]`, in document order — without building any DOM. The
  `id` for each heading is byte-identical to the `id` `Markdown` renders onto
  the corresponding `<h1>`–`<h6>` element for that same source. No consumer
  action is needed.

## Fixed

### Core

- A component disposed synchronously by a handler running during an event's
  own dispatch — most commonly, a tab's close button disposing the tab's
  content — no longer throws `DOM handle <n> is not registered` when that
  same event's subtree-listener walk reaches the released handle. The walk
  now ends cleanly at that point instead.
  
### Table

**Editing a date, time, or datetime cell — even just opening it and cancelling, never committing — used to strand that editor's picker overlay on the shared stylesheet forever once the table itself was later disposed.** The shared editor pool behind in-place cell editing was never disposed when the owning table was, and none of the three date/time/datetime editors disposed their own lazily-built picker dropdown either. No consumer action is needed.
