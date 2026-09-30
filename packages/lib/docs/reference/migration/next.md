# Next

Breaking-change notes for the next release, collected here as they land —
this page is not tied to a version number yet. Once this release is tagged,
any note here moves onto its own numbered page (see
[Migration](/reference/migration)) and this page resets to empty.

## A restore that interrupts a rail minimize fires the `minimize` it owed first

**What changed and why.** A window minimizing into a
[`Rail`](/components/Rail) shrinks into its handle over 150 ms, and its
`"minimize"` is held back until that shrink lands — so the handle appears
when the window has finished shrinking into it. A restore arriving inside
that window used to *void* the held-back event, on the ground that a window
leaving `"minimized"` has nothing left to announce. But the window's state
reads `"minimized"` for the whole shrink, so a consumer polling
`getWindowState()` saw a transition into and out of `"minimized"` that no
event ever reported, and one pairing the two events saw a `"restore"` with
no `"minimize"` before it. The debt is now paid instead of voided, which is
what [`setRail`](/api/overlay/classes/AbstractWindow#setrail) already did
for a window that stays minimized under a new owner. A restore that lets the
shrink land is unchanged, and so is a close or a dispose inside it: the first
still announces `"close"` alone, the second still announces nothing.

**Who needs to act.** Nothing fails to compile, and a consumer that only
mirrors the window's state — as `Rail` itself does — needs no change. A
listener that treated `"minimize"` as "the window is now hidden behind a rail
handle" sees one more call, for a window that is about to be shown again in
the same task; it should read `getWindowState()` in the handler, or wait for
the paired `"restore"`, rather than assume.

```typescript
// Before — a restore inside the 150 ms shrink
win.on("minimize", onMin);
win.on("restore",  onRes);
win.minimize();
win.restore();      // onRes only

// After
win.minimize();
win.restore();      // onMin, then onRes — in that order, in the same task
```

## `DOM.sink` and `DOM.source` are read-only

**What changed and why.** The two seam properties are now declared `readonly`,
so they are swapped through
[`DOM.install`](/api/core/interfaces/DOMSeams#install) or
[`DOM.reset`](/api/core/interfaces/DOMSeams#reset) and nowhere else. Those two
calls are what tell the library's seam-derived caches that the handles they hold
have stopped resolving — a `Handle` only means anything to the seam that minted
it, and `reset` rebuilds the shared handle registry outright. A direct
assignment went around that notification, leaving a cache writing through a
handle the incoming sink had never minted. Making the properties read-only makes
the two swap routes the only ones, so the notification cannot be bypassed.

**Who needs to act.** Only code that assigned a seam directly, which no
documented path ever did. The assignment is now a compile error; install the
seam instead, which is also what restores the production pair:

```typescript
// Before
DOM.sink = myRecordingSink;

// After
DOM.install({ sink: myRecordingSink });
// … and to restore the production pair
DOM.reset();
```

## `Tree` and `TreeTable` no longer register `caret-down` / `caret-right`

**What changed and why.** `Tree` and `TreeTable` row toggles are now one
`angle-right` glyph, turned 90° to point down when expanded instead of being
swapped for a differently-named glyph — a rotation can be animated with a CSS
transition, and a glyph-name swap cannot. `TreeRow.ts` and `TreeCell.ts`
previously registered `caret-down` and `caret-right` with the shared glyph
registry as a side effect of importing them; neither file references those
names any more, so that registration is gone too.

**Who needs to act.** Code that shows a `caret-down` or `caret-right` glyph
elsewhere — a `Button` glyph, an icon renderer's resolver — and relied on
importing `Tree` or `TreeTable` to have registered them for it must now
register them itself:

```typescript
import { Glyph } from '@jimka/typescript-ui/component/display';
import { caret_down, caret_right } from '@jimka/typescript-ui/glyphs/solid';

Glyph.register(caret_down, caret_right);
```

Code that read a tree row's toggle via `getToggle().getGlyphName()` to learn
whether it was expanded should call `Tree.getExpandedNodes()` /
`TreeTable.isExpanded(record)` instead — the glyph name is now `angle-right`
in both states, and the rotation (`getTransform()`) carries the state.

## `SpatialNavigation`'s region chord is `Ctrl+Alt+Shift`+arrow

**What changed and why.** The `"target"` tier — the chord that jumps
between navigation-target containers — defaulted to `Ctrl+Shift`+arrow.
The service claims its chords at the window before any widget sees them,
so on Windows and Linux it took `Ctrl+Shift+←`/`→` word selection away
from every `<input>`, `<textarea>`, `MarkdownEditor` and `CodeEditor`, and
on macOS it took `CodeEditor`'s `Ctrl-Shift`-arrow bindings. The default is
now `Ctrl+Alt+Shift`+arrow, which no editor or browser binds. The
`"component"` tier stays on `Ctrl+Alt`+arrow.

**Who needs to act.** An app that enables `SpatialNavigation` without
passing `targetModifiers` now answers to `Ctrl+Alt+Shift`+arrow. Update any
help text or shortcut legend that names the old chord. An app that passes
its own `targetModifiers` is not affected. To keep the old chord:

```typescript
SpatialNavigation.configure({ targetModifiers: { ctrl: true, shift: true } });
```
