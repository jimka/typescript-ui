# Next

Breaking-change notes for the next release, collected here as they land —
this page is not tied to a version number yet. Once this release is tagged,
any note here moves onto its own numbered page (see
[Migration](/reference/migration)) and this page resets to empty.

## `Slider`'s `showTicks` option and accessors are removed

**What changed and why.** `SliderOptions.showTicks` and the
`isShowTicks()` / `setShowTicks()` pair were inert: the flag was stored on the
options bag and read back by its own getter, and nothing else ever consulted
it — `doLayout` drew no tick marks, and the accessor's own documentation said
the field was reserved for a follow-up. No caller anywhere set it. Pre-1.0.0,
dead public surface with no callers is cut rather than deprecated.

**Who needs to act.** Any `new Slider({ showTicks: ... })` option, and any
call to `slider.isShowTicks()` or `slider.setShowTicks(...)`, is now a compile
error. There is no replacement — remove the option and the calls; nothing
rendered from them:

```typescript
// Before
const slider = new Slider({ min: 0, max: 100, showTicks: true });
slider.setShowTicks(false);

// After
const slider = new Slider({ min: 0, max: 100 });
```

## `WindowBorder.setDirection` is removed

**What changed and why.** A `WindowBorder` is one edge or corner strip of a
resizable window, and its direction decides both the resize axis it drives and
the resize cursor it shows. The cursor is written once, from the constructor,
and the drag re-reads the same derivation live — the accessor's own
documentation says the two are shared "so the two can never disagree".
`setDirection` broke exactly that: it rewrote the direction and left the hover
cursor pointing at the old axis. Its guard was wrong as well, mapping an
explicit `Direction.NORTH` — enum value `0` — onto a "not supplied" default.
A strip's direction is also structural to its owner: `AbstractWindow` keeps
its eight strips in a named record and switches on each one's direction, so
re-pointing a strip would desynchronise its name from its behaviour. No caller
anywhere set it. Pre-1.0.0, dead public surface with no callers is cut rather
than deprecated.

**Who needs to act.** Any call to `windowBorder.setDirection(...)` is now a
compile error. There is no replacement: choose the direction at construction,
which is the only point it was ever safe to choose it:

```typescript
// Before
const border = new WindowBorder(Direction.NORTH);
border.setDirection(Direction.EAST);

// After
const border = new WindowBorder(Direction.EAST);
```

`getDirection()` is unchanged.
