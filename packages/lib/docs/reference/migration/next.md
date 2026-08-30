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

## `ChartStoreBinding` is removed

**What changed and why.** `ChartStoreBinding` described a store-bound
chart's field accessors (`store` / `xField` / `yField` / `seriesField`)
as a standalone interface, but `AbstractChartOptions` already carries
those same fields directly, and that flat shape is what
`AbstractChart.setStore` and every chart's construction options
actually route through. The interface had no reference anywhere in the
library, its tests, or its docs.

**Who needs to act.** Nobody: `ChartStoreBinding` was never a chart's
actual construction-time shape and had no known consumers. Pass
`store` / `xField` / `yField` / `seriesField` directly on the chart's
options, as already documented.

## `elkWorkerUrl` / `workerUrl` are removed

**What changed and why.** `DiagramViewOptions.elkWorkerUrl` and
`ElkLayoutEngineOptions.workerUrl` never achieved off-thread ELK
layout: this library always imports elkjs's `elk.bundled.js`, whose
own worker-availability check can never succeed against that module,
so a `workerUrl` / `elkWorkerUrl` alone silently ran layout on the
main thread regardless (with a console warning logged by elkjs
itself). `elkWorkerFactory` already covers real off-thread execution
in one line, so the non-functional option is removed rather than
made to work.

**Who needs to act.** Any `elkWorkerUrl` option passed to
`DiagramView`, or `workerUrl` passed to `ElkLayoutEngine`, is now a
compile error. Replace it with a worker factory:

```typescript
// Before
DiagramView({ data, elkWorkerUrl: "https://example.com/elk-worker.js" });

// After
DiagramView({
    data,
    elkWorkerFactory: () =>
        new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" }),
});
```
