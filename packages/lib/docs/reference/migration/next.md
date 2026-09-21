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

## Mounting is awaited, and `BodyOptions.components` is gone

**What changed and why.** The singleton's construction is what applies the
active theme, injects the bundled Manrope `@font-face` rules and starts the
face loading, so `Body.init` now returns `Promise<Body>` and resolves once
that font is active (or a bounded deadline expires) instead of returning
synchronously. A tree built before it resolves is measured against the
browser's fallback face rather than the theme's, which is why
`BodyOptions.components` is removed — the option let an app build its tree
before the bootstrap had anywhere to send it.

**Who needs to act.** Any `Body.init({ components: [...] })` call is now a
compile error. Await the bootstrap, then add the tree:

```typescript
// Before
const shell = buildAppShell();

Body.init({ layoutManager: Fit(), components: [shell] });

// After
async function main(): Promise<void> {
    const body = await Body.init({ layoutManager: Fit() });

    body.addComponent(buildAppShell());
}

void main();
```

`Body.getInstance()` is unchanged: same signature, does not wait for the font.
A suite that must build its tree before mounting — because it needs the
singleton's theme applied first, not the font — calls it the same way as
before:

```typescript
import { Body } from '@jimka/typescript-ui/core';

// Applies the default theme before the first component exists.
Body.getInstance();
```

## The startup layout gate is removed

The gate that used to hold the first coalesced layout flush until the web
font activated no longer exists — the awaited `Body.init` bootstrap makes it
unnecessary, since nothing is built until the font is already active. The
`0.4.0` migration notes about `flushLayout()` / `resumeLayout()` reading
fallback-font geometry during a held startup window, and about a
programmatic scroll or row reveal issued during that window being replayed
once it opened, no longer apply: there is no window to hold.

## `Checkbox` and `Slider` fire `"action"` for user activations only

**What changed and why.** `on("action", fn)` on a `Checkbox` or a `Slider`
used to fire for every programmatic write as well as for the user's own
activations: `setSelected`, `setValue` and a `Binding` update each announced
it. A checkbox also announced it, with no change of state, for a click on its
label, on the space beside its box, or on a disabled checkbox. Every existing
subscriber wanted the user's activations only — the library's own two each
suppressed the rest by hand — and [`RadioButton`](/components/RadioButton)
and [`ToggleButton`](/components/ToggleButton) already meant exactly that by
the same event name. Now a checkbox fires `"action"` once per user toggle (a
click on its box, or Space), and a slider once per drag sample or value key
that moves the thumb. A programmatic write still fires `"change"` and
`"binding"`.

**Who needs to act.** A consumer that relied on `"action"` after its own
`setSelected` / `setValue`, or after a `Binding` write, subscribes to
`"change"` instead, which fires for the user's toggles and your own writes
alike:

```typescript
// Before
cb.on("action", syncPreview);

// After
cb.on("change", syncPreview);
```

A listener that read the event object sees a DOM `change` event on a checkbox,
where it used to see a `click`. A slider's listener still sees an `input`.
