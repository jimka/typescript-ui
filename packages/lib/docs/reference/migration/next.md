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
