# Next

Breaking-change notes for the next release, collected here as they land —
this page is not tied to a version number yet. Once this release is tagged,
any note here moves onto its own numbered page (see
[Migration](/reference/migration)) and this page resets to empty.

## `AbstractStore.getActiveSorter()` is removed

**What changed and why.** `getActiveSorter()` returned the primary sort
descriptor mapped to the legacy `{ property, direction }` shape. It had no
callers left anywhere in the library, and `getActiveSorters()` — which
returns the full `SortDescriptor[]` priority list — has been the live
replacement since multi-column sort landed. The accessor is a deliberate
pre-1.0 cut of an unused alias, not a drop-in replacement.

**Who needs to act.** Any call to `store.getActiveSorter()` is now a
compile error. Read the primary sorter off `getActiveSorters()[0]` instead,
and use its `field` / `dir` properties in place of the old `property` /
`direction`:

```typescript
// Before
const primary = store.getActiveSorter();
if (primary) {
    console.log(primary.property, primary.direction);
}

// After
const [primary] = store.getActiveSorters();
if (primary) {
    console.log(primary.field, primary.dir);
}
```

## `Slider`'s deprecated min/max aliases are removed

**What changed and why.** `setMinValue` / `getMinValue` / `setMaxValue` /
`getMaxValue` and the `minValue` / `maxValue` construction options were
deprecated aliases for `setMin` / `getMin` / `setMax` / `getMax` and the
`min` / `max` options. No consumer in the library used the deprecated forms
any more, so the alias family is removed rather than kept indefinitely.

**Who needs to act.** Any call to `slider.setMinValue(...)`,
`slider.getMinValue()`, `slider.setMaxValue(...)`, or
`slider.getMaxValue()`, and any `new Slider({ minValue: ... })` or
`{ maxValue: ... }` construction option, is now a compile error. Replace
with the canonical forms:

```typescript
// Before
new Slider({ minValue: 0, maxValue: 100 });
slider.setMinValue(5);
slider.getMaxValue();

// After
new Slider({ min: 0, max: 100 });
slider.setMin(5);
slider.getMax();
```
