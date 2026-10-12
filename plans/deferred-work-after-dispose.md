---
depends-on: [focus-history-can-go-back-follows-focus]   # the tip of the keyboard stack; every line number below was taken there (59a5c2e27)
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts                  # feature/nested-scroll-reveal rewrites lines 200-321 and adds a block after afterNextLayout; this plan edits outside both
  - packages/lib/src/typescript/lib/component/container/VirtualScroller.ts   # feature/nested-scroll-reveal edits the import block and adds a method near line 404
  - packages/lib/src/typescript/lib/component/tree/Tree.ts             # collection-widget-keyboard-gaps edits the key handlers; feature/nested-scroll-reveal edits lines 662-700, 903-909 and 1815 onwards
  - packages/lib/src/typescript/lib/component/table/Body.ts            # feature/nested-scroll-reveal edits lines 2377 and 3226 onwards
  - packages/lib/src/typescript/lib/overlay/Dialog.ts                  # dialog-close-button-label edits the title bar; this plan edits DialogButtonRow.handleClick only
  - packages/lib/tests/helpers/libraryClassScan.mjs                    # feature/nested-scroll-reveal appends a function at the end of the file
  - packages/lib/tests/helpers/libraryClassScan.d.mts                  # same
  - packages/lib/tests/component/dispose-full-teardown.test.ts
  - ARCHITECTURE.md
  - packages/lib/docs/concepts/component-lifecycle.md
  - packages/lib/docs/reference/changelog/next.md                      # edited by every branch
---

# Deferred Work After Dispose — Implementation Plan

## Overview

A component can ask for work to run later: on the next animation frame, after a timer, or when a promise settles. *Deferred work* is that later work. When the component is disposed first, the work still runs. It then writes through a DOM handle the component has released, keeps a timer alive for ever, or changes something the application can see. A *handle* is the library's opaque id for one DOM element; a component releases its handles when it is disposed, and using a released handle throws `DOM handle N is not registered`.

This plan covers the case where **the component that deferred the work is the one disposed**. A sweep of `packages/lib/src/typescript/lib` grouped every such site into 96 inventory rows (`## Addendum: Inventory`). Fifteen rows are defects that a test run reproduced. This plan fixes ten of them: the eight in the table, the cause described below the table, and a misuse that the same change makes harmless.

| # | Where | What happens today |
|---|---|---|
| 1 | wheel scroll of a `Tree` or `Table` | disposing during the eased scroll throws `handle … is not registered` on the next frame |
| 2 | touch fling of a `Tree` or `Table` | same throw |
| 3 | press on a `SpinButton` | disposing while pressed leaves a 40 ms timer running for the life of the page |
| 4 | press on a `Scrollbar` arrow | same timer |
| 5 | `Tree.revealByPredicate` over a lazy branch | after a dispose the promise rejects with the handle error, or the walk keeps calling the application's `loadChildren` |
| 6 | a lazy `Tree` node expanding | a load that returns after the dispose still builds rows on the dead tree, and `expandNodeAsync` reports `true` |
| 7 | paste into a `Table` | a clipboard read that returns after the dispose still writes into the application's store |
| 8 | a `Dialog` button with an async `onClick` | dismissing the dialog while `onClick` is pending ends in an unhandled promise rejection |

Of the other five, four belong to `plans/references-to-disposed-components.md` and one is the `Markdown` viewer's code-block kickoff, which `plans/markdown-viewer-stale-code-upgrade-kickoff.md` fixes.

Behind several of the eight sits one cause in [packages/lib/src/typescript/lib/core/Component.ts:1330](packages/lib/src/typescript/lib/core/Component.ts#L1330): `destructor` releases the component's handles but leaves its two write buffers attached to them. The buffers are `_inlineStyle` and `_elementAttributes`, through which every inline-style and attribute setter writes. Any later setter call on the destroyed component therefore throws, and a `Dialog` that has closed throws on a second `dispose()`, which the documentation says is harmless.

The plan adds one test helper that disposes a component at every step of its deferred work, a registry test built on it, the fixes, and per-entry error isolation in two flush loops of `core/Component.ts`. Two companion plans cover what this one leaves out: `plans/references-to-disposed-components.md` (a *surviving* object that keeps a reference to a disposed one) and `plans/code-editor-flash-after-dispose.md` (one site that exists only on the Markdown stack).

---

## Architecture Decisions

### No new scheduling primitive — the existing idioms carry every fix

No owner-scoped scheduler, abort signal or base-class helper is added. Each fix uses one of three idioms the library already has.[^no-primitive]

| The deferred work is… | Idiom | Existing example |
|---|---|---|
| a frame, a timer or a loop the owner started | keep the handle, cancel it in `destructor` | [Dialog.ts:1553](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1553), [VirtualRowView.ts:190](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L190) |
| the code after an `await` | ask `this.isDestroyed()` and return | [Split.ts:2055](packages/lib/src/typescript/lib/layout/Split.ts#L2055), [Border.ts:1712](packages/lib/src/typescript/lib/layout/Border.ts#L1712) |
| a load that belongs to one state of the component | a token the destructor invalidates | [DiagramView.ts:534](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L534), [Tree.ts:425](packages/lib/src/typescript/lib/component/tree/Tree.ts#L425) |

### A destroyed component writes nothing

`Component.destructor` detaches `_inlineStyle` and `_elementAttributes` after it releases the handles, exactly as `Component.release()` does at [Component.ts:1571](packages/lib/src/typescript/lib/core/Component.ts#L1571). A setter called on a destroyed component then updates its cached state and reaches no element. Reads and writes through a raw handle keep throwing.[^detach]

### Work that must not continue is stopped, not made harmless

Detaching the buffers does not replace the other fixes. A loop or timer still has to be cancelled, a consumer callback still must not run, and a raw handle still must not be touched.[^still-stop]

### The class is caught by a test helper and a registry, not by a lint rule

`tests/helpers/disposeAtEveryBoundary.ts` runs a scenario once per step of its deferred work and disposes one step later each time. `tests/component/dispose-deferred-work.test.ts` holds one row per scenario and, like the four existing `dispose-*` registries, derives what it must cover from a scan of the source: every file that schedules deferred work needs a covering row or an entry in a baseline list that may only get shorter.[^registry]

### Both flush loops isolate each entry

`Component.propagateEffectiveVisibility` wraps its call to `onEffectiveVisibilityChange` in `try`/`catch`, and `Component.runFirstLayoutCallbacks` wraps each callback. Both report through the existing `reportFlushFailure` and continue. This is the decision `plans/implemented/layout-flush-degenerate-inputs.md` took for the layout flush, applied to the two loops it left out.[^isolate]

### The two flush changes stay clear of `feature/nested-scroll-reveal`

No line between 200 and 333 of `core/Component.ts` is edited, and nothing is added after `afterNextLayout`. The new stage names are passed to `reportFlushFailure` as it is.[^nsr]

### `Tree` drops its loads in `destructor` and the reveal walk checks for a destroyed tree

`Tree` gains a `destructor` that clears `_pendingLoads`, which is what `setNodes` does to drop every load in flight. `_revealFirstMatch` returns `null` at the top of each loop turn when the tree is destroyed.[^tree]

### The branch goes on the keyboard stack

The branch starts from `feature/focus-history-can-go-back-follows-focus`. It does not depend on `feature/nested-scroll-reveal` and edits no file under `component/editor/` and not `component/display/Markdown.ts`, which the Markdown stack owns.[^stack]

---

## Decisions Awaiting Sign-off

Each item changes something an application could observe. The plan implements the recommendation; a "no" removes the step named.

| # | Change | Before | After | Recommendation |
|---|---|---|---|---|
| D1 | A destroyed component writes nothing (step 12) | a setter on a destroyed component throws `handle … is not registered` when it would change an inline style or an attribute | the call updates cached state and returns | Yes. `dispose()` is documented as safe to call twice and today is not; see case B2. |
| D2 | `Tree.revealByPredicate` on a tree disposed mid-walk (step 8) | resolves with the node, rejects with a handle error, or keeps calling `loadChildren` | resolves `null`; `loadChildren` is not called again | Yes. |
| D3 | `Tree.expandNodeAsync` on a tree disposed mid-load (step 8) | resolves `true` | resolves `false`, the value it already gives for a load orphaned by `setNodes` | Yes. |
| D4 | A table paste pending at dispose (step 9) | writes the clipboard into the store | writes nothing | Yes. |
| D5 | A throwing `onEffectiveVisibilityChange` (step 13) | escapes `Component.flushEffectiveVisibility()` and the frame; components behind it are not reconciled | logged through `console.error`, counted as a layout error, the rest reconciled | Yes. |
| D6 | A throwing `onFirstLayout` callback (step 13) | aborts that component's `doLayout()`; callbacks behind it are lost | logged and counted, the rest run, `doLayout()` completes | Yes. |

No consumer has to change code for any of the six, so nothing is added to `docs/reference/migration/next.md`. Each gets a changelog entry (`## Documentation Impact`).

---

## Public API

One method is added to an exported class. No option, event or signature changes.

```ts
// core/SmoothScroller.ts
export class SmoothScroller {
    /**
     * Cancels the in-flight loop and reads nothing. For an owner that is being
     * torn down, where `reset()`'s re-read of the live position would go
     * through an element that is gone.
     */
    stop(): void;
}
```

`Component.isDestroyed()` keeps its signature and its `@internal` tag. Its JSDoc gains the second use (step 12).

---

## Internal Structure

### The test helper

`packages/lib/tests/helpers/disposeAtEveryBoundary.ts`, complete. A *boundary* is one step of deferred work: one promise the scenario handed out settling, one animation frame, or one timer firing.

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Disposes a component at every point where work it deferred is still pending,
// and reports what went wrong afterwards. See
// plans/implemented/deferred-work-after-dispose.md.
//
// A *boundary* is one step of deferred work: one promise the scenario handed
// out settling, one animation frame, or one timer firing. A scenario with N
// boundaries is run N + 1 times; run k walks k boundaries, disposes, and then
// gives everything still scheduled one round to run. After a dispose that
// round must throw nothing, log nothing through `console.error`, reject no
// promise the scenario returned, and leave no frame and no timer scheduled.
import { vi } from 'vitest';
import type { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** One 60 fps frame: what the fake clock advances by before each frame runs. */
const FRAME_MS = 16;

/**
 * Most boundaries walked for one scenario. A press-and-hold repeat never goes
 * idle on its own, so the walk needs a bound; 40 covers the longest finite
 * scenario in the registry (a wheel ease settles in about 25 frames).
 */
const MAX_BOUNDARIES = 40;

/** What a scenario uses to hand the component a promise the helper settles. */
export interface ScenarioControl {
    /**
     * Returns a promise that stays pending until the helper reaches it as a
     * boundary, then resolves with `value`.
     *
     * @param value - What the promise resolves with.
     */
    defer<T>(value: T): Promise<T>;
}

/** One component and one way to make it defer work. */
export interface DeferredWorkScenario<S = unknown> {
    /** Builds and renders the component. Frames and timers it leaves are run before `arm`. */
    make(control: ScenarioControl): Component | Promise<Component>;
    /** Starts the deferred work. A returned promise is watched for a rejection. */
    arm(component: Component, control: ScenarioControl): void | Promise<unknown>;
    /** Records what must not change after the dispose, read just before it. */
    snapshot?(component: Component): S;
    /** Asserts against the snapshot once the post-dispose round has run. */
    after?(component: Component, snapshot: S): void;
}

/** What went wrong after disposing at one boundary. */
export interface BoundaryFailure {
    /** How many boundaries had been walked when the component was disposed. */
    disposedAfter: number;
    /** One line per problem seen after the dispose. */
    problems: string[];
}

interface Deferred {
    settled: boolean;
    settle(): void;
}

/** The fake frame queue, timer clock and promise list one run uses. */
class BoundaryClock {
    readonly frames: Map<number, FrameRequestCallback> = new Map();
    readonly deferreds: Deferred[] = [];
    readonly problems: string[] = [];
    private _nextHandle: number = 0;
    private _restores: Array<() => void> = [];

    install(): void {
        installTestDOM(CONFIG);
        vi.useFakeTimers();

        const request = vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
            const handle = ++this._nextHandle;

            this.frames.set(handle, callback);

            return handle;
        });
        const cancel = vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((handle: number) => {
            this.frames.delete(handle);
        });
        const error = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            this.problems.push('console.error: ' + args.map(describe).join(' '));
        });

        this._restores = [() => request.mockRestore(), () => cancel.mockRestore(), () => error.mockRestore()];
    }

    uninstall(): void {
        for (const restore of this._restores) {
            restore();
        }

        vi.useRealTimers();
        DOM.reset();
    }

    control(): ScenarioControl {
        return {
            defer: <T>(value: T): Promise<T> => new Promise<T>((resolve) => {
                const deferred: Deferred = {
                    settled: false,
                    settle: (): void => {
                        deferred.settled = true;
                        resolve(value);
                    },
                };

                this.deferreds.push(deferred);
            }),
        };
    }

    /** Whether a frame or a timer is scheduled. */
    hasScheduledWork(): boolean {
        return this.frames.size > 0 || vi.getTimerCount() > 0;
    }

    /** Whether nothing is scheduled and every promise handed out has settled. */
    isIdle(): boolean {
        return !this.hasScheduledWork() && this.deferreds.every(d => d.settled);
    }

    /** Runs the frames pending now; a frame one of them requests waits for the next call. */
    runFrames(): void {
        vi.advanceTimersByTime(FRAME_MS);

        for (const [handle, callback] of Array.from(this.frames.entries())) {
            const pending = this.frames.delete(handle);

            if (!pending) {
                continue;
            }

            try {
                callback(performance.now());
            } catch (thrown) {
                this.problems.push('a frame threw: ' + describe(thrown));
            }
        }
    }

    /** Runs the timers pending now; a timer one of them arms waits for the next call. */
    runTimers(): void {
        try {
            vi.runOnlyPendingTimers();
        } catch (thrown) {
            this.problems.push('a timer threw: ' + describe(thrown));
        }
    }

    /** Walks one boundary: the oldest open promise, else a frame, else the next timer. */
    step(): void {
        const open = this.deferreds.find(d => !d.settled);

        if (open) {
            open.settle();

            return;
        }

        if (this.frames.size > 0) {
            this.runFrames();

            return;
        }

        try {
            vi.advanceTimersToNextTimer();
        } catch (thrown) {
            this.problems.push('a timer threw: ' + describe(thrown));
        }
    }
}

/** A thrown value as one line of text. */
function describe(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}

/**
 * Waits one real macrotask, by which time every microtask queued so far has
 * run. `MessageChannel` is used because fake timers do not replace it, and
 * because it is typed without Node's own type package.
 */
function settleMicrotasks(): Promise<void> {
    return new Promise<void>((resolve) => {
        const channel = new MessageChannel();

        channel.port1.onmessage = (): void => {
            channel.port1.close();
            resolve();
        };
        channel.port2.postMessage(null);
    });
}

/** One run: build, arm, walk `boundaries` boundaries, dispose, run one more round. */
async function runOnce<S>(scenario: DeferredWorkScenario<S>, boundaries: number): Promise<{ problems: string[]; walked: number; idle: boolean }> {
    const clock = new BoundaryClock();

    clock.install();

    try {
        const control = clock.control();
        const component = await scenario.make(control);

        // Whatever building the component scheduled is not the work under test.
        for (let round = 0; round < MAX_BOUNDARIES; round++) {
            const scheduled = clock.hasScheduledWork();

            if (!scheduled) {
                break;
            }

            clock.runFrames();
            clock.runTimers();
        }

        const armed = scenario.arm(component, control);

        if (armed) {
            armed.catch((reason: unknown) => {
                clock.problems.push('the returned promise rejected: ' + describe(reason));
            });
        }

        await settleMicrotasks();

        let walked = 0;
        let idle = clock.isIdle();

        while (walked < boundaries && !idle) {
            clock.step();
            await settleMicrotasks();
            walked++;
            idle = clock.isIdle();
        }

        const snapshot = scenario.snapshot?.(component) as S;

        // Only what happens from the dispose on is a finding.
        clock.problems.length = 0;

        try {
            component.dispose();
        } catch (thrown) {
            clock.problems.push('dispose threw: ' + describe(thrown));
        }

        for (const deferred of clock.deferreds) {
            if (!deferred.settled) {
                deferred.settle();
            }
        }

        await settleMicrotasks();
        clock.runFrames();
        clock.runTimers();
        await settleMicrotasks();

        if (clock.frames.size > 0) {
            clock.problems.push(`${clock.frames.size} frame(s) still scheduled`);
        }

        const timers = vi.getTimerCount();

        if (timers > 0) {
            clock.problems.push(`${timers} timer(s) still scheduled`);
        }

        try {
            scenario.after?.(component, snapshot);
        } catch (thrown) {
            clock.problems.push('after: ' + describe(thrown));
        }

        return { problems: clock.problems.slice(), walked, idle };
    } finally {
        clock.uninstall();
    }
}

/**
 * Runs `scenario` once per boundary of its deferred work, disposing one
 * boundary later each time, and collects what went wrong after each dispose.
 *
 * @param scenario - The component and the way to make it defer work.
 * @returns How many boundaries the work has, and one entry per disposal point
 *   that left a problem behind. An empty `failures` list is a pass.
 */
export async function disposeAtEveryBoundary<S>(scenario: DeferredWorkScenario<S>): Promise<{ boundaries: number; failures: BoundaryFailure[] }> {
    const failures: BoundaryFailure[] = [];
    let boundaries = MAX_BOUNDARIES;

    for (let disposedAfter = 0; disposedAfter <= boundaries; disposedAfter++) {
        const run = await runOnce(scenario, disposedAfter);

        if (run.problems.length > 0) {
            failures.push({ disposedAfter, problems: run.problems });
        }

        if (run.idle) {
            boundaries = run.walked;
        }
    }

    return { boundaries, failures };
}
```

The helper and the registry test below were run as written while this plan was drafted, against the unchanged library and against the fixes simulated by patching prototypes, and both pass `tsc -p tsconfig.test.json`. The "Today" column of `## Expected Behaviour` is what they reported.[^helper-validated]

### The source scan

Added to `packages/lib/tests/helpers/libraryClassScan.mjs`. Change the path import to `import { join, relative } from 'node:path';`. Put the constant directly after `SELF_LISTENER_REGISTRATION` and the function directly after `classesRegisteringEventListeners`, **not** at the end of the file.[^scan-place]

```js
/** The deferred-work registry's source of truth: a line that schedules a frame,
 *  a timer or a loop, or waits on a promise. The lookahead skips comment lines. */
const DEFERRED_WORK = /^(?!\s*(?:\*|\/\/|\/\*)).*(?:\brequestAnimationFrame\(|\bsetTimeout\(|\bsetInterval\(|\bnew (?:AutoRepeat|SmoothScroller|PerFrameCoalescer)\b|\bawait\s|\.then\(|\bAnimation\.tween\b)/;
```

```js
/**
 * Library source files that schedule deferred work, as paths relative to the
 * library source root with forward slashes — the deferred-work registry's
 * source of truth. A file, not a class: several scheduling sites sit in
 * module-level functions that belong to no class.
 *
 * @returns Sorted relative paths of the files holding a line matching `DEFERRED_WORK`.
 */
export function filesSchedulingDeferredWork() {
    const matched = [];

    for (const file of listSourceFiles(SOURCE_ROOT)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        const schedules = lines.some((line) => DEFERRED_WORK.test(line));

        if (schedules) {
            matched.push(relative(SOURCE_ROOT, file).replace(/\\/g, '/'));
        }
    }

    return matched.sort();
}
```

In `libraryClassScan.d.mts`, directly after the `classesRegisteringEventListeners` declaration:

```ts
/** Relative paths of the library source files that schedule deferred work — the deferred-work registry's source of truth. */
export function filesSchedulingDeferredWork(): string[];
```

On the base commit the scan returns 50 files.

### The registry test

`packages/lib/tests/component/dispose-deferred-work.test.ts`. Its header comment follows the header of `dispose-pointer-drag-teardown.test.ts`: what the registry watches, and that coverage is derived from `filesSchedulingDeferredWork()`.

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { Panel } from '~/core/Panel';
import { SpinButton } from '~/component/input/SpinButton';
import { Scrollbar } from '~/component/container/Scrollbar';
import { StatusBar } from '~/component/container/StatusBar';
import { Body } from '~/component/table/Body';
import { _Tree } from '~/component/tree/Tree';
import type { TreeNode } from '~/component/tree/TreeNode';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ModelRecord } from '~/data/ModelRecord';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import type { DialogButtonConfig, DialogResult } from '~/overlay/Dialog';
import { Dock } from '~/overlay/Dock';
import { makeEvent } from '../dom/TestDOM';
import { disposeAtEveryBoundary, type DeferredWorkScenario } from '../helpers/disposeAtEveryBoundary';
import { filesSchedulingDeferredWork } from '../helpers/libraryClassScan.mjs';

const MODEL = new Model([
    { name: 'a', type: 'string', order: 0 },
    { name: 'b', type: 'string', order: 1 },
    { name: 'c', type: 'string', order: 2 },
], 'a');

/** `count` flat nodes with distinct labels. */
function nodes(count: number): TreeNode[] {
    return Array.from({ length: count }, (_, i) => ({ label: 'n' + i }));
}

/** A rendered 300 x 120 tree over `list`; 120 px shows about five rows. */
function tree(list: TreeNode[]): _Tree {
    const built = new _Tree();

    built.getElement(true);
    built.setWidth(300);
    built.setHeight(120);
    built.setNodes(list);

    return built;
}

/** A lazy node whose children arrive when the helper settles the promise. */
function lazy(label: string, load: () => Promise<TreeNode[]>): TreeNode {
    return { label, hasChildren: true, loadChildren: load } as TreeNode;
}

/** A wheel notch of 400 px downward on `component`'s own element. */
function wheel(component: Component): void {
    const element = component.getElement()!;

    DOM.sink.dispatchEvent(element, makeEvent(element, 'wheel', { deltaX: 0, deltaY: 400 }));
}

/** A primary-button press on `component`'s own element. */
function press(component: Component): void {
    const element = component.getElement(true)!;

    DOM.sink.dispatchEvent(element, makeEvent(element, 'mousedown', { button: 0 }));
}

interface ButtonRowPrivate {
    _configs: DialogButtonConfig[];
    handleClick(cfg: DialogButtonConfig, result: DialogResult): Promise<void>;
}

let loaderCalls = 0;
let pastedRecord: ModelRecord;

const REGISTRY: Array<{
    name: string;
    /** Source files this row is the registry's evidence for. */
    covers: string[];
    scenario: DeferredWorkScenario<any>;
}> = [
    {
        name:     'Tree: eased wheel scroll',
        covers:   ['core/SmoothScroller.ts', 'component/container/VirtualScroller.ts'],
        scenario: { make: () => tree(nodes(200)), arm: wheel },
    },
    {
        name:     'Tree: touch fling',
        covers:   ['component/container/VirtualScroller.ts'],
        scenario: {
            make: () => tree(nodes(200)),
            arm:  (component) => {
                const element = component.getElement()!;
                const touch = (type: string, y?: number): Event =>
                    Object.assign(makeEvent(element, type), { touches: y === undefined ? [] : [{ clientX: 10, clientY: y }] });

                DOM.sink.dispatchEvent(element, touch('touchstart', 100));
                vi.advanceTimersByTime(10);
                DOM.sink.dispatchEvent(element, touch('touchmove', 60));
                vi.advanceTimersByTime(10);
                DOM.sink.dispatchEvent(element, touch('touchmove', 10));
                vi.advanceTimersByTime(5);
                DOM.sink.dispatchEvent(element, touch('touchend'));
            },
        },
    },
    {
        name:     'Panel: eased wheel scroll of native overflow',
        covers:   ['core/Component.ts'],
        scenario: {
            make: () => {
                const panel: Panel = new Panel({ autoScroll: 'y' });

                panel.getElement(true);
                panel.setWidth(200);
                panel.setHeight(100);

                return panel;
            },
            arm: (component) => {
                // The modelled DOM reports no overflow, so give the panel 900 px to scroll.
                vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => ({
                    scrollTop: 0, scrollLeft: 0, scrollWidth: 200, clientWidth: 200, scrollHeight: 1000, clientHeight: 100,
                }));
                wheel(component);
            },
        },
    },
    {
        name:     'SpinButton: press and hold',
        covers:   ['core/AutoRepeat.ts', 'component/input/SpinButton.ts'],
        scenario: {
            make: () => {
                const button = new SpinButton('▲');

                button.getElement(true);

                return button;
            },
            arm: press,
        },
    },
    {
        name:     'Scrollbar: press and hold an arrow',
        covers:   ['component/container/Scrollbar.ts'],
        scenario: {
            make: () => {
                const bar = new Scrollbar('vertical', { arrowsEnabled: true });

                bar.getElement(true);
                bar.setWidth(12);
                bar.setHeight(200);
                // Content past the viewport, scrolled to the top: the end arrow is enabled.
                bar.setMetrics(200, 1000, 0);

                return bar;
            },
            arm: (component) => press((component as unknown as { _arrowEnd: Component })._arrowEnd),
        },
    },
    {
        name:     'Tree: lazy expand',
        covers:   ['component/tree/Tree.ts'],
        scenario: {
            make: (control) => tree([...nodes(5), lazy('lazy', () => control.defer(nodes(30)))]),
            arm:  (component) => {
                const built = component as _Tree;
                const target = (built as unknown as { _nodes: TreeNode[] })._nodes[5];

                return built.expandNodeAsync(target);
            },
            snapshot: (component) => (component as unknown as { _flatRows: unknown[] })._flatRows.length,
            after:    (component, rows) => {
                expect((component as unknown as { _flatRows: unknown[] })._flatRows.length).toBe(rows);
            },
        },
    },
    {
        name:     'Tree: reveal that finds nothing',
        covers:   ['component/tree/Tree.ts'],
        scenario: {
            make: (control) => {
                loaderCalls = 0;

                const load = (): Promise<TreeNode[]> => {
                    loaderCalls++;

                    return control.defer([{ label: 'leaf' }]);
                };

                return tree([...nodes(3), lazy('first', load), lazy('second', load)]);
            },
            arm:      (component) => (component as _Tree).revealByPredicate(() => false),
            snapshot: () => loaderCalls,
            after:    (_component, calls) => {
                expect(loaderCalls).toBe(calls);
            },
        },
    },
    {
        name:     'Tree: reveal of a match far down',
        covers:   ['component/tree/Tree.ts'],
        scenario: {
            // 150 rows above the lazy node: revealing its child has to scroll.
            make: (control) => tree([...nodes(150), lazy('lazy', () => control.defer([{ label: 'match' }]))]),
            arm:  (component) => (component as _Tree).revealByPredicate((_data, node) => node.label === 'match'),
        },
    },
    {
        name:     'Table body: paste',
        covers:   ['component/table/Body.ts'],
        scenario: {
            make: async (control) => {
                const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);

                await store.load();
                vi.spyOn(DOM.source, 'readClipboardText').mockImplementation(() => control.defer('X\tY'));

                const body = new Body(store);

                body.getElement(true);
                pastedRecord = store.getAll()[0];

                const selection = body as unknown as { _rangeAnchor: unknown; _rangeFocus: unknown };

                selection._rangeAnchor = { record: pastedRecord, col: 1 };
                selection._rangeFocus  = { record: pastedRecord, col: 1 };

                return body;
            },
            arm:      (component) => (component as Body).pasteAtSelection(),
            snapshot: () => pastedRecord.get('b'),
            after:    (_component, before) => {
                expect(pastedRecord.get('b')).toBe(before);
            },
        },
    },
    {
        name:     'Dialog: async button guard',
        covers:   ['overlay/Dialog.ts'],
        scenario: {
            make: (control) => {
                const dialog = new Dialog({
                    title:   't',
                    message: 'm',
                    buttons: [{ text: 'Go', result: 'confirm', primary: true, onClick: () => control.defer(true) }],
                });

                void dialog.show();

                return dialog;
            },
            arm: (component) => {
                const row = (component as unknown as { _buttonRow: ButtonRowPrivate })._buttonRow;

                return row.handleClick(row._configs[0], 'confirm');
            },
        },
    },
    {
        // Passes on the base commit: both frames the dock leaves are inert.
        name:     'Dock: panel removed',
        covers:   ['overlay/Dock.ts'],
        scenario: {
            make: () => {
                const dock = new Dock();

                dock.getElement(true);
                dock.setWidth(800);
                dock.setHeight(600);
                dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
                dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
                dock.doLayout();

                return dock;
            },
            arm: (component) => {
                (component as Dock).removePanel('a');
            },
        },
    },
    {
        // Passes on the base commit: the destructor clears the timer.
        name:     'StatusBar: timed message',
        covers:   ['component/container/StatusBar.ts'],
        scenario: {
            make: () => {
                const bar = new StatusBar();

                bar.getElement(true);

                return bar;
            },
            arm: (component) => {
                (component as StatusBar).setMessage('Saved', 500);
            },
        },
    },
];

/**
 * Files `filesSchedulingDeferredWork()` finds today with no `covers` row. Each
 * was read with its owner's teardown and judged safe; the verdicts are the
 * inventory in plans/implemented/deferred-work-after-dispose.md. Entries come
 * out as rows are added. An entry only goes in for a file whose deferred work
 * was read and found safe — never to make a failing assertion pass.
 */
const UNCLAIMED_DEFERRED_WORK_FILES: readonly string[] = [
    'component/container/MenuItem.ts',
    'component/container/TabBar.ts',
    'component/diagram/DiagramView.ts',
    'component/diagram/ElkLayoutEngine.ts',
    'component/display/AbstractCanvasSurface.ts',
    'component/display/Image.ts',
    'component/display/Markdown.ts',
    'component/editor/CodeEditor.ts',
    'component/editor/MarkdownDocumentPanel.ts',
    'component/editor/MarkdownEditor.ts',
    'component/editor/formatters/prettier.ts',
    'component/editor/formatters/sql.ts',
    'component/editor/languages.ts',
    'component/input/AbstractCalendarDropdown.ts',
    'component/input/AutoCompleteField.ts',
    'component/input/TextInput.ts',
    'component/shared/VirtualRowView.ts',
    'component/table/Header.ts',
    'component/table/Table.ts',
    'component/table/cell/Header.ts',
    'component/table/cell/editor/TextInputCellEditor.ts',
    'core/Animation.ts',
    'core/Body.ts',
    'core/DOM.ts',
    'core/PerFrameCoalescer.ts',
    'core/ResizeDrag.ts',
    'core/Theme.ts',
    'data/AbstractStore.ts',
    'data/StoreWorkerClient.ts',
    'data/TreeStore.ts',
    'data/proxy/AjaxProxy.ts',
    'diagnostics/DiagnosticsSampler.ts',
    'layout/CollapseSupport.ts',
    'layout/DockRegion.ts',
    'layout/Tab.ts',
    'overlay/AbstractWindow.ts',
    'overlay/DragManager.ts',
    'overlay/Notification.ts',
    'overlay/Tooltip.ts',
];

describe('dispose-deferred-work registry: a dispose at any boundary leaves nothing behind', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    for (const { name, scenario } of REGISTRY) {
        it(name, async () => {
            const result = await disposeAtEveryBoundary(scenario);

            expect(result.failures).toEqual([]);
        });
    }

    it('every file that schedules deferred work has a row or a baseline entry', () => {
        const claimed = new Set([...REGISTRY.flatMap((row) => row.covers), ...UNCLAIMED_DEFERRED_WORK_FILES]);
        const scanned = filesSchedulingDeferredWork();

        expect(scanned.filter((file) => !claimed.has(file))).toEqual([]);
    });

    it('the baseline lists no file that has a row or that no longer schedules work', () => {
        const covered = new Set(REGISTRY.flatMap((row) => row.covers));
        const scanned = new Set(filesSchedulingDeferredWork());

        expect(UNCLAIMED_DEFERRED_WORK_FILES.filter((file) => covered.has(file) || !scanned.has(file))).toEqual([]);
    });
});
```

### The fixes

**`SmoothScroller.stop`** — after `reset()` in `core/SmoothScroller.ts`:

```ts
    stop(): void {
        if (this._raf !== null) {
            DOM.sink.cancelAnimationFrame(this._raf);
            this._raf = null;
        }
    }
```

**`VirtualScroller`** — the fling's frame handle moves from a local of `attachTouchHandlers` to a field, so `dispose()` can reach it:

```ts
    private _momentumRaf    : number | null = null;

    /** Cancels a touch-fling loop that is still running. */
    private cancelMomentum(): void {
        if (this._momentumRaf !== null) {
            DOM.sink.cancelAnimationFrame(this._momentumRaf);
            this._momentumRaf = null;
        }
    }

    dispose(): void {
        // Both loops write the scroll transform through `_rowsContainer`, which
        // the owner releases right after this call.
        this._smooth.stop();
        this.cancelMomentum();

        this._scrollbarV.dispose();
        this._scrollbarH.dispose();
    }
```

**`Component.destructor`** — two additions.

After `endPointerDragFor(this.getId());`:

```ts
        // The purge above removed the wheel listener; the ease it started is a
        // bare animation frame and would keep stepping for a few hundred
        // milliseconds against an element that is gone.
        this._wheelScroller?.stop();
        this._wheelScroller = null;
```

After `this._ownedHandles.length = 0;` and before `this._element = undefined;`:

```ts
        // Both buffers are still bound to a handle released above, so a setter
        // called from here on would write through it. Detached, they keep
        // taking writes and reach no element — what `release()` does for the
        // same reason.
        this._inlineStyle.detach();
        this._elementAttributes.detach();
```

**`SpinButton` and `ScrollArrowButton`** — each gains the same override:

```ts
    /**
     * Stops a press-and-hold repeat still running. The mouse-up listener that
     * would have stopped it is purged by the inherited teardown.
     */
    protected destructor(): void {
        this._repeat.stop();

        super.destructor();
    }
```

**`Tree`** — a new override, and one check at the top of the loop in `_revealFirstMatch`:

```ts
    /**
     * Drops every lazy load still in flight, as `setNodes` does, so one that
     * settles later commits nothing to a tree that is gone.
     */
    protected destructor(): void {
        this._pendingLoads.clear();

        super.destructor();
    }
```

```ts
        for (;;) {
            // Checked on every turn: each `await` below can resume after a dispose.
            const destroyed = this.isDestroyed();

            if (destroyed) {
                return null;
            }

            if (generation !== externalGeneration()) {
```

**`TableBody.pasteIntoRange`** — directly after the `await`:

```ts
        const clip = await DOM.source.readClipboardText();

        // The read can take as long as a permission prompt stays open. A body
        // disposed meanwhile must not write into a store that outlives it.
        const destroyed = this.isDestroyed();

        if (destroyed) {
            return;
        }
```

**`DialogButtonRow.handleClick`** — the end of the method becomes:

```ts
        try {
            proceed = await cfg.onClick();
        } finally {
            // The dialog may have been dismissed while the guard was pending;
            // its buttons are destroyed with it.
            const destroyed = this.isDestroyed();

            if (!destroyed) {
                this.setButtonsEnabled(true);
            }
        }

        const alive = !this.isDestroyed();

        if (proceed && alive) {
            this._onButton(result);
        }
```

### The two isolated loops

`Component.propagateEffectiveVisibility`:

```ts
        this._lastEffectiveVisible = effective;

        // Isolated: one hook that throws would otherwise leave this node's
        // children, and every root queued behind it, unreconciled.
        try {
            this.onEffectiveVisibilityChange(effective);
        } catch (error) {
            reportFlushFailure("onEffectiveVisibilityChange", this.getId(), error);
        }
```

`Component.runFirstLayoutCallbacks`:

```ts
        for (const callback of callbacks) {
            // Isolated: the queue was emptied above, so a throw would lose
            // every callback behind this one and abort the enclosing layout.
            try {
                callback();
            } catch (error) {
                reportFlushFailure("onFirstLayout", this.getId(), error);
            }
        }
```

`reportFlushFailure` prints `Layout flush: onFirstLayout for #<id> threw; the rest of the frame continued.` and adds one to `Diagnostics.counters().layoutErrors`.

---

## Ordered Implementation Steps

Run every command from `packages/lib`. Keep to one vitest process with `--maxWorkers=2`, and check `free -g` before a full run.

1. **Record the baseline.** On the unchanged branch run `npx vitest run --maxWorkers=2 2>&1 | tail -15` and write the "Test Files" and "Tests" lines into the plan's Implementation Notes. Step 15 compares against them.

2. **Add the scan.** Edit `tests/helpers/libraryClassScan.mjs` and `tests/helpers/libraryClassScan.d.mts` as in `## Internal Structure` → *The source scan*. Check: `node -e "import('./tests/helpers/libraryClassScan.mjs').then(m => console.log(m.filesSchedulingDeferredWork().length))"` prints `50`. If it prints another number, compare the list with the 11 covered files and the 39 baseline entries of the registry and correct the baseline before going on.

3. **Add the helper** `tests/helpers/disposeAtEveryBoundary.ts`, copied from `## Internal Structure` → *The test helper*.

4. **Add the registry test** `tests/component/dispose-deferred-work.test.ts` from `## Internal Structure` → *The registry test*, and **see it fail**: `npx vitest run tests/component/dispose-deferred-work.test.ts --maxWorkers=1`. Expect 10 failed and 4 passed. The four that pass are the `Dock` row, the `StatusBar` row and the two coverage tests. If a row in the "fails" column of `## Expected Behaviour` passes, stop and report: the defect is not present on this base.

5. **`SmoothScroller.stop`.** Add the method from *The fixes* to `src/typescript/lib/core/SmoothScroller.ts`, after `reset()` (which ends at line 180), with the JSDoc of `## Public API`.

6. **`VirtualScroller`.** In `src/typescript/lib/component/container/VirtualScroller.ts`:
   - Add the field `_momentumRaf` after `_smooth` (line 56) and the method `cancelMomentum` after `dispose()`.
   - In `attachTouchHandlers` delete the local `let momentumRaf : number | null = null;` (line 584) and the local `const cancelMomentum` (lines 586–591). Replace every remaining `momentumRaf` in the method with `this._momentumRaf` and every `cancelMomentum()` with `this.cancelMomentum()`.
   - Replace `dispose()` (lines 162–165) with the version from *The fixes* and add to its JSDoc: "Stops the eased wheel scroll and the touch fling first."
   - Check: `grep -n "momentumRaf" src/typescript/lib/component/container/VirtualScroller.ts` shows only `_momentumRaf`. Do not touch the import block.
   - Run the registry: both `Tree` scroll rows pass.

7. **`Component` stops its own wheel ease.** In `destructor` of `src/typescript/lib/core/Component.ts`, add the two `_wheelScroller` lines from *The fixes* after `endPointerDragFor(this.getId());` (line 1202). Run the registry: the `Panel` row passes.

8. **`Tree`.** In `src/typescript/lib/component/tree/Tree.ts`:
   - Add the `destructor` override directly after `_ensureChildrenLoaded` (which ends at line 950).
   - Add the destroyed check as the first statements of the `for (;;)` body in `_revealFirstMatch` (the loop opens at line 804).
   - Add to the `@returns` of `revealByPredicate` (line 761): ", or `null` when the tree is disposed before the walk ends".
   - Run the registry: the three `Tree` reveal and expand rows pass.

9. **Table paste.** In `src/typescript/lib/component/table/Body.ts`, add the destroyed check of *The fixes* directly after the `await` in `pasteIntoRange` (line 2037). Run the registry: the `Table body` row passes.

10. **Press-and-hold repeat.** Add the `destructor` override of *The fixes* to `SpinButton` (`src/typescript/lib/component/input/SpinButton.ts`, after `onMouseUp`, line 260) and to `ScrollArrowButton` (`src/typescript/lib/component/container/Scrollbar.ts`, after `_onMouseOut`, line 416). Run the registry: both press rows pass.

11. **Dialog guard.** Replace the end of `DialogButtonRow.handleClick` in `src/typescript/lib/overlay/Dialog.ts` (lines 568–576) with the version from *The fixes*. Run the registry: 13 passed. The `Dialog` row still fails, now with `dispose threw` only; step 12 removes that.

12. **A destroyed component writes nothing.**
    - Create `tests/core/DestroyedComponentWrites.test.ts` with cases B1–B4 of `## Expected Behaviour`. Run it: B1, B2 and B3 fail on `is not registered`; B4 passes.
    - In `src/typescript/lib/core/Component.ts`, in `destructor`, add the two `detach()` lines from *The fixes* after `this._ownedHandles.length = 0;` (line 1334).
    - In the same file, in the JSDoc of `isDestroyed()` (line 4698), add this paragraph before `@returns`: "A component also asks this of itself after an `await`: the code that follows may be running after its own teardown, and then it must return without touching the component, a consumer callback or caller-owned data."
    - Run the new file again: 4 passed. Run the registry: 14 passed.

13. **Isolate the two loops.**
    - Create `tests/core/DeferredHookIsolation.test.ts` with cases G1–G5 of `## Expected Behaviour`, using the frame-capturing `beforeEach` of `tests/core/LayoutFlushIsolation.test.ts`. Run it: G1, G2 and G4 fail; G3 and G5 pass.
    - Edit `propagateEffectiveVisibility` (line 2626) and `runFirstLayoutCallbacks` (line 8184) of `core/Component.ts` as in *The two isolated loops*.
    - In the JSDoc of `reportFlushFailure`, change the `@param stage` line (line 252) to: `@param stage - The stage that failed: "doLayout", "afterNextLayout", "onFirstLayout" or "onEffectiveVisibilityChange".` Change nothing else between lines 200 and 333.
    - Run the file again: 5 passed.

14. **Keep the teardown registry whole.** Three classes now declare `protected destructor(`, and `tests/component/dispose-full-teardown.test.ts` demands a row for each.
    - Change the `covers` of the existing `Tree` row to `['Tree', 'VirtualRowView', 'TreeRow', 'LabelTreeNodeRenderer']`.
    - Add `{ name: 'SpinButton', covers: ['SpinButton'], make: () => new SpinButton('▲') }` and import `SpinButton` from `~/component/input/SpinButton`.
    - Add `{ name: 'Scrollbar (arrows)', covers: ['ScrollArrowButton'], make: () => new Scrollbar('vertical', { arrowsEnabled: true }) }` and import `Scrollbar` from `~/component/container/Scrollbar`.
    - Run `npx vitest run tests/component/dispose-full-teardown.test.ts --maxWorkers=1`: no failure. Add nothing to `UNCLAIMED_DESTRUCTOR_CLASSES`.

15. **Write the rule and the changelog** (`## Documentation Impact`), then run everything in `## Verification`. Compare the full run with step 1: the failed count is unchanged, and the passed count is higher by the new tests only (14 + 4 + 5 + 2 = 25). Record both lines in the Implementation Notes.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/helpers/disposeAtEveryBoundary.ts` |
| Create | `packages/lib/tests/component/dispose-deferred-work.test.ts` |
| Create | `packages/lib/tests/core/DestroyedComponentWrites.test.ts` |
| Create | `packages/lib/tests/core/DeferredHookIsolation.test.ts` |
| Modify | `packages/lib/tests/helpers/libraryClassScan.mjs` |
| Modify | `packages/lib/tests/helpers/libraryClassScan.d.mts` |
| Modify | `packages/lib/tests/component/dispose-full-teardown.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/SmoothScroller.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/VirtualScroller.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/SpinButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/concepts/component-lifecycle.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

**The contract.** Once a component is disposed, work it deferred does nothing an application or a user can see. It throws nothing, logs nothing, rejects no promise the library returned, calls no consumer callback, changes no caller-owned data, and leaves no frame and no timer scheduled beyond the one round already pending.

### Registry rows (`dispose-deferred-work.test.ts`) — unit

"Fails" means `disposeAtEveryBoundary` returns at least one failure. The problem text is what the helper reported on the base commit.

| Row | Today | After |
|---|---|---|
| Tree: eased wheel scroll | fails at 25 of 25 points: `a frame threw: … is not registered` | passes |
| Tree: touch fling | fails at every point: same text | passes |
| Panel: eased wheel scroll of native overflow | fails at 24 of 25 points: `1 frame(s) still scheduled` | passes |
| SpinButton: press and hold | fails at every point: `1 timer(s) still scheduled` | passes |
| Scrollbar: press and hold an arrow | fails at every point: same text | passes |
| Tree: lazy expand | fails at point 0: the row count grows from 6 to 36 after the dispose | passes |
| Tree: reveal that finds nothing | fails at point 0: `loadChildren` is called once more after the dispose | passes |
| Tree: reveal of a match far down | fails at point 0: `the returned promise rejected: … is not registered` | passes |
| Table body: paste | fails at point 0: field `b` changes from `2` to `X` after the dispose | passes |
| Dialog: async button guard | fails at point 0 (`the returned promise rejected`) and at point 2 (`dispose threw`) | passes |
| Dock: panel removed | passes | passes |
| StatusBar: timed message | passes | passes |
| every file … has a row or a baseline entry | passes | passes |
| the baseline lists no file … | passes | passes |

### A destroyed component (`DestroyedComponentWrites.test.ts`) — unit

Each case installs the test DOM in `beforeEach` and calls `DOM.reset()` in `afterEach`.

| # | Steps | Required | Today |
|---|---|---|---|
| B1 | render a `Component`, `dispose()`, then `setTranslate(3, 4)` and `setOpacity(0.5)` | no throw; `sink.writes` gains no `apply` entry after the dispose | throws `is not registered` |
| B2 | `new Dialog({ title, message })`, `show()`, `hide('close')`, `vi.advanceTimersByTime(2000)`, then `dispose()` | no throw | throws from `setTabKeyOwner` |
| B3 | a `Container` with a `Panel` child, laid out; `child.dispose()` without removing it; `container.doLayout()` | no throw | throws from `getLayoutManager` |
| B4 | render a `Component`, `dispose()`; `DOM.source.getElementRect(handle)` with the handle read before the dispose | throws `is not registered` | same (control: a raw handle stays loud) |

B2 uses `vi.useFakeTimers()` and a `DOM.sink.requestAnimationFrame` spy that runs captured frames, as `tests/overlay/Dialog.test.ts` does.

### Isolated loops (`DeferredHookIsolation.test.ts`) — unit

`Thrower` is a `Component` subclass whose `onEffectiveVisibilityChange` throws `new Error('deliberate hook failure')`. G3, G4 and G5 decide what the component reports as connected with `vi.spyOn(DOM.source, 'isConnected').mockImplementation(() => connected)`.

| # | Steps | Required | Today |
|---|---|---|---|
| G1 | a `Container` holding `Thrower` then a recording sibling; hide the container; `Component.flushEffectiveVisibility()` | no throw; the sibling's hook ran with `false`; one `console.error` starting `Layout flush: onEffectiveVisibilityChange for #`; `layoutErrors` up by 1 | throws; the sibling's hook never runs |
| G2 | two separate roots queued, the first a `Thrower`; flush | no throw; the second root's hook ran | throws; the second root is skipped |
| G3 | a connected component; `onFirstLayout(a)` where `a` throws, then `onFirstLayout(b)`; run the captured frame | `b` ran; one `console.error` naming `afterNextLayout` | same (control: this path was already isolated) |
| G4 | a rendered component reported as not connected; `onFirstLayout(a)` where `a` throws, `onFirstLayout(b)`; report it connected; `doLayout()` | no throw from `doLayout()`; `b` ran; one `console.error` starting `Layout flush: onFirstLayout for #`; `layoutErrors` up by 1 | `doLayout()` throws; `b` never runs |
| G5 | as G4 with no throwing callback | both ran, no `console.error` | same (control) |

G3 and G5 are controls and pass before and after the change.

### Manual

A browser check is needed only for real wheel and touch input, which the unit tests drive through synthetic events.

1. Start the demo (`npm run dev`, or a dev server on a port of your own) and open a page with a long `Tree` inside a closable dock tab or window.
2. Scroll the tree with the mouse wheel and close its tab while the content is still gliding. The console stays clean. Before the fix it shows `Uncaught Error: DOM handle N is not registered (released or never minted).`
3. With touch emulation on (DevTools → device toolbar), fling the tree and close the tab during the fling. The console stays clean.
4. Open a page with a `NumberSpinner`. In the console, hold a reference to it, press and hold its up arrow, and run `spinner.dispose()` from a `setTimeout` while still holding. Release. DevTools → Performance shows no repeating 40 ms timer afterwards.

---

## Verification

- `npx vitest run tests/component/dispose-deferred-work.test.ts --maxWorkers=1` — 14 passed.
- `npx vitest run tests/core/DestroyedComponentWrites.test.ts tests/core/DeferredHookIsolation.test.ts --maxWorkers=1` — 9 passed.
- `npx vitest run tests/component/dispose-full-teardown.test.ts tests/core/LayoutFlushIsolation.test.ts tests/core/OnFirstLayout.test.ts tests/component/EffectiveVisibility.test.ts --maxWorkers=1` — no failure.
- `npm run typecheck` and `npm run typecheck:test` — clean. The helper must compile without Node's types.
- `npm run lint` — clean.
- `npm run test` — the failed count equals step 1's; the passed count is step 1's plus 25.
- `npm run docs:api` — zero warnings.
- `npm run docs:llms:check` and `npm run build:lib` — succeed.
- `grep -n "this._inlineStyle.detach()" src/typescript/lib/core/Component.ts` — two matches, one in `release()` and one in `destructor`.
- `git diff -U0 -- src/typescript/lib/core/Component.ts | grep '^@@'` — no hunk starts between old lines 254 and 333.
- The manual checks of `## Expected Behaviour`.

---

## Documentation Impact

**`ARCHITECTURE.md`** — a new section directly before `## Components are exported through \`callable()\``:

```markdown
## Deferred work ends with its owner

*Deferred work* is anything a component asks to run later: an animation frame, a timer, a loop built on either, the code after an `await`, a callback handed to a promise. The component can be disposed first, and the work then runs against handles that have been released. Three rules keep that from happening.

1. **A frame, a timer or a loop is cancelled in `destructor`.** Keep what the scheduling call returned in a field and cancel it before `super.destructor()`. A helper object that schedules for its owner (`SmoothScroller`, `AutoRepeat`, `PerFrameCoalescer`, `ResizeDrag`) offers a stop or cancel method, and the owner calls it there.
2. **Code after an `await` asks `this.isDestroyed()` first** and returns when it is true, before it touches the component, calls a consumer callback or writes caller-owned data. A promise the library handed out still settles: with the value that means "nothing happened".
3. **Work that belongs to one state of a component carries a token** — a generation number or a sequence number taken when the work starts — and does nothing when the token is no longer current. `destructor` invalidates the token. `DiagramView.relayout`, `Markdown`'s render generation and `Tree`'s lazy loads are the worked cases.

A destroyed component's own setters write nothing: `destructor` detaches its style and attribute buffers. That makes a late call harmless, not correct — the three rules still apply, because a loop left running wastes frames for ever and a consumer callback still fires. A raw `Handle` is different: reading or writing through a released one throws, on purpose. Code that keeps a handle it does not own asks `DOM.source.isRegistered(handle)` first.

`tests/component/dispose-deferred-work.test.ts` guards the rules. It disposes a component at every step of its deferred work, through `tests/helpers/disposeAtEveryBoundary.ts`, and fails when a source file gains its first scheduling call without a row there. The scan is per file, so a second site in a file that already has a row is not caught by it: add a row for the new site.
```

**`packages/lib/docs/concepts/component-lifecycle.md`** — in the `## Disposal` section, after the paragraph that begins "Because teardown recursion calls `destructor()`", add:

````markdown
### Work that outlives the component

A frame, a timer or an `await` can finish after the component is disposed. Cancel frames and timers in `destructor()`, before `super.destructor()`. After an `await`, return when the component is gone:

```typescript
async reload(): Promise<void> {
    const rows = await this.fetchRows();
    const destroyed = this.isDestroyed();

    if (destroyed) {
        return;
    }

    this.showRows(rows);
}
```

A setter called on a disposed component writes nothing, so a late call does not throw. It is still work done for nothing, and anything it does outside the component — a callback, a store write — still happens.
````

**`packages/lib/docs/reference/changelog/next.md`**

Under `## Changed` → `### Core`, as the last bullets:

```markdown
- **A disposed component's setters write nothing.** A setter called after
  `dispose()` used to throw `DOM handle … is not registered` when it would
  change an inline style or an attribute. It now updates the component's
  cached state and returns, which also makes a second `dispose()` safe for a
  component whose teardown writes an attribute — a `Dialog` that had already
  closed threw there. Reading or writing through a raw handle still throws.
- **One throwing visibility hook or first-layout callback no longer takes the
  rest with it.** A throw from `onEffectiveVisibilityChange` used to escape
  `Component.flushEffectiveVisibility()` and leave every component queued
  behind it unreconciled; a throw from an `onFirstLayout` callback used to
  abort that component's `doLayout()` and drop the callbacks behind it. Both
  are now caught per entry, logged with `console.error` and counted on the
  diagnostics overlay's "Layout errors" row, as a throwing layout pass
  already was.
```

Under `## Fixed` → `### Components`, as the last bullets:

```markdown
- **Disposing a `Tree` or a `Table` while it is still scrolling no longer
  throws.** Closing the tab or window that held one during an eased wheel
  scroll or a touch fling logged an uncaught `DOM handle … is not
  registered` on the next frame.
- **A `SpinButton` or a `Scrollbar` arrow disposed while pressed stops
  repeating.** Its repeat timer used to keep firing every 40 ms for the life
  of the page.
- **A `Tree` disposed during a lazy load stays quiet.** `revealByPredicate`
  could reject with a handle error or go on calling `loadChildren` for the
  remaining lazy branches; it now resolves `null`. `expandNodeAsync` resolves
  `false`.
- **A paste into a `Table` that was disposed while the clipboard was being
  read writes nothing.** It used to write the clipboard into the store.
- **Dismissing a `Dialog` while a button's async `onClick` is pending no
  longer ends in an unhandled promise rejection.**
```

No component page changes: no option, event or method signature moves. `SmoothScroller.stop()` appears in the generated API reference from its JSDoc.

---

## Potential Challenges

- **The registry rows run under fake timers.** A scenario that needs the clock to move between two events calls `vi.advanceTimersByTime`, as the touch-fling row does. Do not call `vi.useRealTimers()` inside a scenario.
- **`vi.spyOn` inside `arm` or `make` outlives the helper's run.** The registry's `afterEach` restores all mocks; keep it.
- **The helper counts every timer.** A module-level timer left armed by an earlier test file would fail every row. Each test file runs in its own module scope, so none is: if a row reports a timer on the base commit that the "Today" column does not list, look for a new module-level timer first.
- **`MessageChannel` under Node.** It is a global since Node 15 and is typed by the DOM library the test program already loads. Do not replace it with `setImmediate`, which fake timers replace and the test program cannot type.
- **`Tree`'s reveal check must sit inside the loop.** Clearing `_pendingLoads` alone is not enough: the walk then restarts and starts a fresh load on the destroyed tree. The "reveal that finds nothing" row fails until the loop check is in.
- **`destructor` can run twice.** `SmoothScroller.stop`, `AutoRepeat.stop`, `Map.clear` and the two `detach()` calls are all safe to repeat; keep any addition that way.
- **Line numbers drift.** Find each site by the symbol named in the step. The numbers are from `59a5c2e27`.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `destructor` (1170), `release()` (1533, the precedent for the detach), `flushPendingVisibility` (353), `propagateEffectiveVisibility` (2621), `isDestroyed` (4711), `attachWheelScrolling` (5504), `runFirstLayoutCallbacks` (8166), `reportFlushFailure` (257).
- [packages/lib/src/typescript/lib/core/SmoothScroller.ts](packages/lib/src/typescript/lib/core/SmoothScroller.ts) and [packages/lib/src/typescript/lib/core/AutoRepeat.ts](packages/lib/src/typescript/lib/core/AutoRepeat.ts) — the two helper objects whose owners never stopped them.
- [packages/lib/src/typescript/lib/component/container/VirtualScroller.ts](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts) — `dispose()` (162), `updateTransform` (503, the throwing write), `attachTouchHandlers` (577).
- [packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts:190](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L190) — the destructor that already cancels two deferred handles and calls `VirtualScroller.dispose()`.
- [packages/lib/src/typescript/lib/component/tree/Tree.ts](packages/lib/src/typescript/lib/component/tree/Tree.ts) — `setNodes` (418), `_revealFirstMatch` (798), `_ensureChildrenLoaded` (934), `_loadLazy` (1561), `_settleLoad` (1652).
- [packages/lib/src/typescript/lib/component/diagram/DiagramView.ts:529](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L529) — the destructor that invalidates a token and settles the promise it handed out.
- [packages/lib/src/typescript/lib/overlay/Dialog.ts](packages/lib/src/typescript/lib/overlay/Dialog.ts) — `handleClick` (556), `destructor` (1548).
- [packages/lib/src/typescript/lib/core/PendingTransitions.ts](packages/lib/src/typescript/lib/core/PendingTransitions.ts) and [packages/lib/src/typescript/lib/core/PendingPointerDrags.ts](packages/lib/src/typescript/lib/core/PendingPointerDrags.ts) — the two registries `destructor` already consults; read to see why a third was not added.
- [packages/lib/tests/component/dispose-pointer-drag-teardown.test.ts](packages/lib/tests/component/dispose-pointer-drag-teardown.test.ts) and [packages/lib/tests/helpers/libraryClassScan.mjs](packages/lib/tests/helpers/libraryClassScan.mjs) — the registry and scan shape the new test copies.
- [packages/lib/tests/core/LayoutFlushIsolation.test.ts](packages/lib/tests/core/LayoutFlushIsolation.test.ts) — the frame-capturing setup for `DeferredHookIsolation.test.ts`.
- [plans/implemented/layout-flush-degenerate-inputs.md](plans/implemented/layout-flush-degenerate-inputs.md), [plans/implemented/animation-timer-cancellation.md](plans/implemented/animation-timer-cancellation.md), [plans/implemented/test-dom-handle-eviction.md](plans/implemented/test-dom-handle-eviction.md), [plans/implemented/pointer-drag-ends-on-dispose.md](plans/implemented/pointer-drag-ends-on-dispose.md) — the decisions this plan extends.

---

## Non-Goals

- **A surviving object that keeps a reference to a disposed one** — a `Popover` whose anchor is disposed, a drag session whose source is disposed, a window whose content is replaced mid-animation, a menu item's timer after its menu closed. `plans/references-to-disposed-components.md` covers them.
- **`CodeEditor`'s read-only flash after a dispose.** The path exists only on the Markdown stack. `plans/code-editor-flash-after-dispose.md` covers it.
- **The `Markdown` viewer's kickoff.** `plans/markdown-viewer-stale-code-upgrade-kickoff.md` fixes it.
- **What a `Dock` or a `Rail` owes the windows registered with it when it is disposed.** Both leave their `on` handlers on those windows (inventory rows 90 and 91). Removing them needs a decision about the pair's lifecycle first — whether a disposed dock closes its floats — which is not a deferred-work question.
- **Routing the ten raw `setTimeout` calls through `DOM.sink.setTimeout`.** The helper sees both kinds through fake timers, so the routing buys this plan nothing.
- **Registry rows for the 39 baseline files.** Each was read and judged safe. A row is added when a file's deferred work changes.
- **Cancelling the inert frames of `Dock` and `AbstractWindow`'s snap preview.** Each runs once after a dispose and writes nothing; the registry row for `Dock` pins that.
- **Making a directly disposed child leave its parent's child list.** The documented way to discard a child is `removeComponent` then `dispose()`. With the buffers detached the parent's layout no longer throws on such a child (case B3).

---

## Addendum: Inventory

Every site found by the searches of the next addendum, grouped by owner and kind. Line numbers are from `59a5c2e27`. "Run" means a temporary test showed it while this plan was drafted; "read" means the code was read with its owner's teardown and not run. Plan A is this plan, B is `references-to-disposed-components.md`, C is `code-editor-flash-after-dispose.md`.

### Frames

| # | Site | Verdict | Evidence | Cost | Fix |
|---|---|---|---|---|---|
| 1 | `core/Component.ts:237` layout flush | safe | read: module-level; `destructor` removes the component from the queue and the flush skips one without an element | — | — |
| 2 | `core/Component.ts:349` visibility flush | safe | read: skips a root without an element | — | isolation, step 13 |
| 3 | `core/SmoothScroller.ts:164,229` as built at `VirtualScroller.ts:121` (`Tree`, `Table`) | **unsafe, reproduced** | run: throws from `VirtualScroller.updateTransform` on the next frame | uncaught error | A, steps 5–6 |
| 4 | `core/SmoothScroller.ts:164,229` as built at `Component.ts:5505` (native overflow) | safe | run: no throw; 24 frames that write nothing, then idle | wasted frames | A, step 7 |
| 5 | `VirtualScroller.ts:693,696` touch fling | **unsafe, reproduced** | run: same throw as row 3 | uncaught error | A, step 6 |
| 6 | `display/AbstractCanvasSurface.ts:420,462` draw loop | safe | read: `stopAnimation()` in `destructor` | — | — |
| 7 | `core/Animation.ts:268,269` `play` entrance frames | safe | read: cancelled through `PendingTransitions` for every owned handle | — | — |
| 8 | `core/Animation.ts:517,526` `tween`, used at `VirtualRowView.ts:844` | safe | read: `_rowMotion` cancelled in `destructor` | — | — |
| 9 | `tween` used at `AbstractWindow.ts:3340,3461` | safe for the window | read: `_stateAnimHandle` cancelled in `destructor` | — | body host: row 92 |
| 10 | `core/Animation.ts:702,703` `materialize` | safe | read: `cancelled` flag; `Tab.detach` and `AbstractWindow.destructor` cancel | — | — |
| 11 | `core/PerFrameCoalescer.ts:51,63` in `ResizeDrag` (`Split`, `Accordion`, `Table`, `AbstractWindow`) | safe | read: `_resizeDrag.cancel()` in `detach` or `destructor` | — | — |
| 12 | `PerFrameCoalescer` at `AbstractWindow.ts:369` snap preview | safe | run: one call after the dispose, no throw | one wasted frame | — |
| 13 | `core/Theme.ts:1344` font deadline | safe | read: module-level, once per page | — | — |
| 14 | `diagnostics/DiagnosticsSampler.ts:177,247` | safe | read: a service; `stop()` cancels | — | — |
| 15 | `layout/CollapseSupport.ts:416,422` — the container disposed | safe | read: `Split.detach` and `Border.detach` cancel | — | — |
| 16 | `CollapseSupport.ts:416,422` — one pane disposed, the container alive | unsafe by reading | read: `commitRect` calls `setTranslate(0, 0)`, which throws on a destroyed pane that carries a translate. Run: the plain case does not throw | uncaught error, needs a dispose within 200 ms | A, step 12 |
| 17 | `overlay/Dock.ts:918` sweep | safe | run: runs once after the dispose, writes nothing, emits nothing | one wasted frame | row in the registry |
| 18 | `overlay/Dock.ts:1857` focus recompute | safe | read: reads through component getters only; its `emit` reaches a cleared listener bag | one wasted frame | — |
| 19 | `overlay/DragManager.ts:518` move frame | safe | read: cancelled in `endSession`; no-op without a session | — | session: row 93 |

### Timers

| # | Site | Verdict | Evidence | Cost | Fix |
|---|---|---|---|---|---|
| 20 | `core/Animation.ts:238,261` `play` fallback | safe | read: `PendingTransitions` | — | — |
| 21 | `core/Animation.ts:411` `afterTransition` fallback | safe | read: `PendingTransitions`; `Accordion.detach` cancels its maps | — | — |
| 22 | `core/AutoRepeat.ts:91` in `SpinButton` | **unsafe, reproduced** | run: one timer still armed 60 s after the dispose, and after a mouse-up | a 40 ms timer for the life of the page; pins the button | A, step 10 |
| 23 | `core/AutoRepeat.ts:91` in `ScrollArrowButton` | **unsafe, reproduced** | run: same | same | A, step 10 |
| 24 | `input/AutoCompleteField.ts:518,585` | safe | read: both cleared in `destructor` | — | — |
| 25 | `table/Header.ts:1404` filter debounce | safe | read: cleared in `destructor` | — | — |
| 26 | `overlay/Notification.ts:471,510` | safe | read: cleared in `destructor` | — | — |
| 27 | `container/StatusBar.ts:260` | safe | run: registry row passes | — | — |
| 28 | `container/TabBar.ts:3215` spring raise | safe | read: `clearSpringRaise()` in `destructor` | — | — |
| 29 | `layout/DockRegion.ts:172` spring raise | safe | read: cleared in `destroy()`, which `Dock.destructor` calls | — | — |
| 30 | `container/MenuItem.ts:319` — the item disposed | safe | read: cleared in `destructor` | — | — |
| 31 | `container/MenuItem.ts:319` — the menu closed, the item alive | **unsafe, reproduced** | run: fires after `Menu.close()` and leaves `_openSubmenuPanel` set | a submenu opened for a closed menu | B |
| 32 | `input/AbstractCalendarDropdown.ts:1562` | safe | read: not cancelled, fires once, clears one string field | — | — |
| 33 | `table/cell/Header.ts:677` | safe | read: 0 ms, clears one flag | — | — |
| 34 | `overlay/Tooltip.ts:730,1039` | safe | read: static; `Tooltip.detach` runs through `onDestroy` and cancels the owner's delay | — | — |
| 35 | `core/Theme.ts:1349` | safe | read: module-level | — | — |
| 36 | `data/StoreWorkerClient.ts:130,197` | safe | read: module-level service | — | — |

### Promises

| # | Site | Verdict | Evidence | Cost | Fix |
|---|---|---|---|---|---|
| 37 | `tree/Tree.ts:825–943` `revealByPredicate` | **unsafe, reproduced** | run: rejects with the handle error when the match needs a scroll; calls `loadChildren` on the next lazy node when nothing matches | a rejected promise; network requests from a dead tree | A, step 8 |
| 38 | `tree/Tree.ts:1617,1659` lazy load settling | **unsafe, reproduced** | run: no throw; the dead tree's row list grows from 6 to 36 | work on a dead tree; `expandNodeAsync` reports `true` | A, step 8 |
| 39 | `table/Body.ts:2037` paste | **unsafe, reproduced** | run: the record's fields change after the dispose | caller-owned data changed | A, step 9 |
| 40 | `overlay/Dialog.ts:569` button guard | **unsafe, reproduced** | run: `Button.setEnabled` throws on the destroyed buttons; the rejection is unhandled | a logged unhandled rejection | A, step 11 |
| 41 | `overlay/Dialog.ts:1761,1787` static helpers | safe | read: no component owns them | — | — |
| 42 | `input/TextInput.ts:785` paste | safe | read: re-reads `getElement()` after the await | — | — |
| 43 | `table/cell/editor/TextInputCellEditor.ts:203` paste | safe | read: same | — | — |
| 44 | `editor/CodeEditor.ts:1394,2768` paste | safe | read: re-checks `_view`, which `destructor` nulls | — | — |
| 45 | `editor/CodeEditor.ts:1468,1472` `format` on this stack | safe | read: writes one option, then returns on a null `_view` | — | — |
| 46 | `CodeEditor.format` and `paste` on the Markdown stack (1710, 1714, 1622) | unsafe by reading | read on that stack: a read-only editor disposed during the await plays its flash on a released overlay handle. Run on this stack for the flash alone: with the overlay mounted by hand, `flashReadOnly()` on a disposed editor throws | a rejected promise | C |
| 47 | `editor/CodeEditor.ts:863,918` language and lint loads | safe | read: `_view` check and an identity token | — | — |
| 48 | `editor/MarkdownEditor.ts:1720–2462` paste and prompts (Markdown stack: 2688, 6724–7770) | safe | read: act on a headless Lexical editor; no handle is involved | — | — |
| 49 | `editor/MarkdownDocumentPanel.ts:437–463` prompts | safe | read: delegate to the editor of row 48 | — | — |
| 50 | `display/Markdown.ts:1565` code-editor import | safe | read: generation check after the await | — | — |
| 51 | `editor/languages.ts`, `editor/formatters/*` (13 lines) | safe | read: module functions with no owner | — | — |
| 52 | `table/Table.ts:2041` column dialog | safe | read: `destructor` disposes the dialog, which resolves `'close'` | — | — |
| 53 | `layout/Tab.ts:1965` | safe | read: inside a `materialize` factory; `isStale` and `detach` | — | — |
| 54 | `overlay/Notification.ts:561` | safe | read: static; walks live toasts | — | — |
| 55 | `display/Image.ts:662` decode | safe | read: generation and `getElement()` | — | — |
| 56 | `diagram/DiagramView.ts:755` | safe | read: `destructor` bumps the generation | — | — |
| 57 | `diagram/ElkLayoutEngine.ts` (7 lines) | safe | read: `_disposed` flag | — | — |
| 58 | `core/Body.ts:159` | safe | read: singleton | — | — |
| 59 | `core/DOM.ts` (7 lines) | safe | read: the seam itself | — | — |
| 60 | `data/*` (44 lines in 4 files) | safe | read: a store is not a component and owns no handle; loads carry a sequence number; components unsubscribe (rows 86–87) | — | — |

### Layout-queue callbacks

| # | Site | Verdict | Evidence | Cost | Fix |
|---|---|---|---|---|---|
| 61 | `display/Markdown.ts:1937` kickoff | **unsafe, reproduced** | run, by the plan that fixes it | logged error; lost upgrade when hidden | `markdown-viewer-stale-code-upgrade-kickoff` |
| 62 | `display/Markdown.ts:762,1435,1598` | safe | read: return on a missing element or an emptied queue | — | — |
| 63 | `display/AbstractCanvasSurface.ts:361`, `display/WebGLCanvas.ts:258` | safe | read: the component's own queue, which cannot drain after a dispose | — | — |
| 64 | `diagram/DiagramEdgeLayer.ts:515`, `diagram/DiagramNodeLayer.ts:148` | safe | read: own queue; re-read `getElement()` | — | — |
| 65 | `shared/VirtualRowView.ts:1064`, `container/ScrollStrip.ts:636` | safe | read: handle cancelled in `destructor` | — | — |
| 66 | `editor/MarkdownEditor.ts:905`, `editor/CodeEditor.ts:702` | safe | read: own queue | — | — |
| 67 | `editor/CodeEditor.ts:2281` | safe | read: returns on a null `_view` | — | — |
| 68 | `overlay/Dialog.ts:1075,1086` | safe | read: both handles cancelled in `destructor` | — | — |
| 69 | `overlay/Drawer.ts:414` | safe | read: handle cancelled in `destructor` (920) | — | — |
| 70 | `core/Component.ts:8513` | safe | read: own queue | — | — |
| 71 | `core/Component.ts:8166` `runFirstLayoutCallbacks` | gap | read: no per-entry `try` | one throw drops the rest | step 13 |

### Transition waits, media queries and native listeners

| # | Site | Verdict | Evidence | Cost | Fix |
|---|---|---|---|---|---|
| 72 | 27 `Animation.play` calls in 12 owners | safe | read: every owner keeps the handle and cancels in `destructor`; `PendingTransitions` covers the rest | — | — |
| 73 | 3 `Animation.afterTransition` calls (`Accordion`, `CollapseSupport`) | safe | read: cancelled in `detach`; registered with `PendingTransitions` | — | — |
| 74 | 2 `Animation.materialize` calls (`Tab`, `AbstractWindow`) | safe | read: row 10 | — | — |
| 75 | `display/Glyph.ts:121`, `display/AbstractCanvasSurface.ts:91` media queries | safe | read: module-level; instances held by `WeakRef` | — | — |
| 76 | `display/Image.ts:1012`, `display/Video.ts:572`, `display/VideoPlayer.ts:545` | safe | read: on the component's own element | — | — |
| 77 | `editor/CodeEditor.ts` `contextmenu` listener | safe | read: removed in `destructor` | — | — |
| 78 | `overlay/Tooltip.ts:1073–1076` | safe | read: `Tooltip.detachElement` through `onDestroy` | — | — |
| 79 | `router/Router.ts:146,148` | safe | read: a service; `stop()` removes | — | — |
| 80 | `core/Event.ts:225,838` | safe | read: the Event module's permanent window listeners | — | — |
| 81 | `overlay/Popover.ts:1006` scroll listeners on the anchor's ancestors, and `_anchorElement` | **unsafe, reproduced** | run: a window resize after the anchor's panel is disposed throws from `_reposition`. Read: `hide()` then throws in a browser | uncaught error; the popover cannot be closed cleanly | B |
| 82 | no `ResizeObserver`, `IntersectionObserver` or `MutationObserver` in the library's own code | — | the search finds none | — | — |

### Subscriptions and third parties

| # | Site | Verdict | Evidence | Cost | Fix |
|---|---|---|---|---|---|
| 83 | 259 `Event.add…Listener(this, …)` calls | safe | read: `Event.purgeComponent` in `destructor` | — | — |
| 84 | about 200 `child.on(…)` calls on owned children | safe | read: the child's listener bag is cleared when it is destroyed | — | — |
| 85 | 24 theme subscriptions | safe | read: `subscribeTheme`, or a disposer called in `destructor` or `detach` | — | — |
| 86 | store subscriptions in `Table`, `TableBody`, `TablePanel`, `AbstractSelectableList`, `ComboBox` | safe | existing registry `dispose-store-subscription-teardown.test.ts` | — | — |
| 87 | store subscriptions in `PaginationBar`, `AbstractChart`, `TreeTablePanel`, `TableHeader` | safe | run for `PaginationBar` (6 listeners before, 0 after); read for the other three | — | — |
| 88 | CodeMirror, Lexical, ELK, `marked` | safe | read: `view.destroy()`, the stored unregister functions, the `_disposed` flag; `marked` is synchronous | — | — |
| 89 | `core/Component.ts:1330` buffers left attached | **unsafe, reproduced** | run: cases B1–B3 | a throw on a second `dispose()` and on any late setter | A, step 12 |
| 90 | `overlay/Rail.ts:1016–1018` handlers on registered windows | unsafe by reading | read: `destructor` does not unregister | pins the rail while a window lives | not planned (Non-Goals) |
| 91 | `overlay/Dock.ts:1126–1146` handlers on float windows | unsafe by reading | read: never removed; the floats outlive the dock | pins the dock while a float lives | not planned (Non-Goals) |
| 92 | `overlay/AbstractWindow.ts:2879` cached body host | **unsafe, reproduced** | run: content replaced during a maximise glide throws, and the next toggle throws again | uncaught error; window left at the wrong size | B |
| 93 | `overlay/DragManager.ts:376` session listeners on the source | **unsafe, reproduced** | run: the source disposed mid-drag leaves the session open; `DragManager.cancel()` throws | no drag can start again on the page | B |
| 94 | `core/Component.ts:2621` `propagateEffectiveVisibility` | gap | read: no per-entry `try` | one throw skips the rest | step 13 |
| 95 | `Glyph.ts:620`, `Panel.ts:1196`, `CodeEditor.ts:1993`, `AbstractCanvasSurface.ts:472` visibility overrides | safe | read: a rule write, a `scheduleLayout`, a null `_view` check, a reconcile that reads live fields | — | — |
| 96 | `Component.dispose()` of a child still in its parent's list | **unsafe, reproduced**; outside the documented use | run: `parent.doLayout()` throws | the parent's layout fails on every pass | A, step 12 (case B3) |

**Totals.** 96 rows: 95 sites and one finding (row 82). Safe: 74. Unsafe and reproduced: 15 (rows 3, 5, 22, 23, 31, 37, 38, 39, 40, 61, 81, 89, 92, 93, 96). Unsafe by reading: 4 (rows 16, 46, 90, 91). Isolation gaps: 2 (rows 71, 94). Of the 15 reproduced rows this plan fixes ten (3, 5, 22, 23, 37, 38, 39, 40, 89, 96), plan B four (31, 81, 92, 93), and the kickoff plan one (61).

**Differences from the earlier partial sweep.** Of its leads, the `Dock` frames, `CollapseSupport` in its plain case and `AbstractWindow`'s snap preview ran clean; the `Dialog` guard, the touch fling, `Tree.revealByPredicate`, the repeat timer, the window's fade on a disposed body host and the submenu timer were reproduced. `Tree`'s lazy expand, the table paste, the `Popover`, the drag session and the attached buffers were not on that list.

---

## Addendum: How the Inventory Was Searched

Structural search with `ast-grep`, from `packages/lib`, over `src/typescript/lib`. Each pattern is run as `ast-grep -p '<pattern>' -l ts src/typescript/lib`.

| Kind | Patterns | Matches |
|---|---|---|
| frames | `$X.requestAnimationFrame($$$A)`, `requestAnimationFrame($$$A)` | 24, 1 |
| timers | `$X.setTimeout($$$A)`, `setTimeout($$$A)`, `$X.setInterval($$$A)`, `setInterval($$$A)` | 9, 12, 0, 0 |
| scheduling helpers | `new AutoRepeat($$$A)`, `new SmoothScroller($$$A)`, `new PerFrameCoalescer($$$A)`, `Animation.tween($$$A)` | 2, 2, 1, 1 |
| promises | `await $X`, `$X.then($$$A)`, `$X.catch($$$A)`, `new Promise($$$A)`, `import($X)` | 82, 18, 9, 2, 19 |
| layout queue | `Component.afterNextLayout($$$A)`, `$X.onFirstLayout($$$A)` | 11, 8 |
| transitions | `Animation.play($$$A)`, `Animation.afterTransition($$$A)`, `Animation.materialize($$$A)` | 27, 3, 2 |
| observers | `new ResizeObserver($$$A)`, `new IntersectionObserver($$$A)`, `new MutationObserver($$$A)`, `new Worker($$$A)` | 0 each |
| media queries, native listeners | `$X.matchMedia($$$A)`, `DOM.sink.addListener($$$A)` | 3, 16 |
| subscriptions | `Event.addListener($$$A)`, `Event.addSubtreeListener($$$A)`, `Event.addViewportListener($$$A)`, `$X.on($$$A)`, `ThemeManager.onThemeChange($$$A)`, `$X.subscribeTheme($$$A)` | 122, 67, 70, 254, 6, 18 |

`Animation.tween<T>(…)` with a type argument is not matched by the `tween` pattern; `grep -n "Animation.tween" -r src/typescript/lib` finds the other two calls. The 254 `$X.on(…)` matches were split by receiver: a private child, or a store, a window, a tab manager or another emitter that can outlive the caller. Only the second group was read site by site.

For the files the Markdown stack changes, the same patterns were run over a copy of `component/editor/` and `component/display/` taken from `feature/markdown-language-readonly-and-fences` (`git show <branch>:<path>`).

---

## Notes

[^no-primitive]: A primitive was weighed first, because one mechanism for the whole class is cheaper than a guard per site. Three shapes were considered. An owner-scoped scheduler on `Component` ("run this next frame unless I am disposed") would fit two of the reproduced defects at most: the wheel ease, the touch fling and the repeat timer live in `SmoothScroller`, `VirtualScroller` and `AutoRepeat`, which are not components, so each would still need its owner passed in. A registry keyed by component id that `destructor` drains, like `PendingPointerDrags`, is the same idea with the same gap, and that registry earned its place because its four sites needed an identical remedy; these sites already hold their own handle and need one line each. An `AbortSignal` per component would be a new concept in a library that has none. The existing idioms cover every site in at most ten lines, and the one change that does act for the whole class — detaching the buffers — is two lines in `destructor`. The project counts an abstraction without several real users as a defect.

[^detach]: The handle registry throws on a released handle on purpose, and that stays: a raw handle used after its release is a bug that should be loud. The buffers are a different thing. `destructor` releases the handles and leaves two objects holding them, so the component's own setters are the one path that still writes through a released handle. `release()` detaches the same two buffers for the stated reason that "the next commit would write through it". Three faults follow from the missing detach and all three were run: a `Dialog` that closed throws on a second `dispose()`, although the lifecycle guide and the JSDoc call a second call harmless; any motion or attribute setter on a destroyed component throws; and a parent's layout throws on a child disposed without `removeComponent`. The cost of the change is that a late setter call no longer announces itself. The helper does not depend on that announcement: it also fails on work still scheduled and on a changed snapshot, which is how it catches a loop that only calls setters.

[^still-stop]: With the buffers detached, the `Dialog` guard and a collapse animation on a disposed pane stop throwing without further change. The other reproduced defects are untouched by it: the two scroll loops write through raw handles of `VirtualScroller`, the repeat timer writes nothing and simply never ends, the reveal walk calls the application's loader, and the paste writes to the application's store. The `Dialog` guard still gets its explicit check, because the rule for code after an `await` should not depend on what the code happens to call.

[^registry]: The four existing registries (`dispose-full-teardown`, `dispose-listener-teardown`, `dispose-drag-teardown`, `dispose-pointer-drag-teardown`) each pair a table of rows with a scan in `libraryClassScan.mjs` and a shrink-only baseline, so a new site fails the suite until someone writes a row. This plan's scan is per file, not per class, because a third of the scheduling sites sit in module-level functions. A lint rule was considered and is not cheap enough to be useful: the only shape a syntax rule can see is a discarded return value of `requestAnimationFrame` or `setTimeout`, and every reproduced defect stores its handle and fails to cancel it. A per-file count of scheduling lines, which would also catch a second site in a known file, was rejected because the Markdown stack adds `await`s to three editor files and would fail the count at merge without having done anything wrong.

[^isolate]: `layout-flush-degenerate-inputs` left the visibility flush out with the words "the same loop shape but no reported throw; changing it is speculative". The `Markdown` kickoff defect has since thrown through both loops: through `flushPendingVisibility` when a hidden viewer was shown, and through `runFirstLayoutCallbacks` when a viewer was rendered before it was connected. In both cases the throw also discarded work queued behind it, which is what the isolation prevents. The `try` goes around the single hook call inside `propagateEffectiveVisibility`, not around the root in `flushPendingVisibility`, so that a throwing node costs neither its own children nor its siblings. Both channels of the original decision are kept: a `console.error` with the thrown value and a count on `Diagnostics`.

[^nsr]: `git diff feature/focus-history-can-go-back-follows-focus...feature/nested-scroll-reveal -- packages/lib/src/typescript/lib/core/Component.ts` has four hunks: at 200 (a constant), at 262–321 (`flushPendingLayouts` split into `runLayoutPasses`, with `reportFlushFailure`'s last three lines as context), and after `afterNextLayout` near 8311 (three new static methods). `flushPendingVisibility` (353), `propagateEffectiveVisibility` (2621), `destructor` (1170) and `runFirstLayoutCallbacks` (8166) are outside all of them, so the two branches merge in either order without a conflict in this file. The one edit near a hunk is the `@param stage` line at 252, ten lines above the hunk's first context line. A new reporter with a prefix other than "Layout flush:" would have been more exact for the visibility hook; it would also have duplicated `reportFlushFailure`, whose body cannot be edited without touching that hunk. The same check for the other shared files: `VirtualScroller.ts` (their hunks at 3 and 404; this plan edits 56, 162 and 577 onwards and leaves the imports alone), `Tree.ts` (their nearest hunk is 903–909; this plan edits 804 and inserts at 950), `table/Body.ts` (theirs from 2377; this plan edits 2037), and `libraryClassScan.mjs` (they append at the end; this plan inserts in the middle).

[^tree]: `Tree` has no `destructor` today. `_settleLoad` commits only while `_pendingLoads` still holds the load's sequence number, and `setNodes`, `_pruneDetachedState` and `_supersedeLoad` all drop a load by deleting its entry; the destructor does the same. That alone is not enough for a reveal. The walk treats a dropped load as "the node was removed", takes it out of the visited set and moves on, so on a destroyed tree it would reach the next lazy node and start a new load. This was seen in a run: with the entries cleared and no loop check, the application's loader was still called once more. The check sits at the top of the loop because every path back from an `await` in the walk passes through it before the next node is tested, loaded or revealed.

[^stack]: Two unmerged families of branches exist. The keyboard stack ends at `feature/focus-history-can-go-back-follows-focus` and does not touch `component/editor/` or `component/display/Markdown.ts`. The Markdown stack ends at `feature/markdown-language-readonly-and-fences` and changes `component/editor/*` by about 25,000 lines; of the files this plan edits it touches none. `component/editor/CodeEditor.ts`, `MarkdownEditor.ts` and `MarkdownDocumentPanel.ts` appear here only as baseline entries of the registry, which name files and not line counts, so the Markdown stack's own changes to them cannot fail the registry when the two meet.

[^helper-validated]: Temporary copies of the helper and of ten rows were run in a scratch worktree at `59a5c2e27` and then deleted. Against the unchanged library the rows reported the "Today" column. Against prototypes patched to cancel in `dispose`/`destructor`, to clear `_pendingLoads` and to detach the buffers, the scroll, press, lazy-expand and `Dialog` rows passed, and the two rows whose fix cannot be simulated from outside (the reveal loop check and the paste guard) kept failing. Ten rows of up to 41 runs each took under one second.

[^scan-place]: `feature/nested-scroll-reveal` appends `librarySourceText` at the end of both `libraryClassScan.mjs` and `libraryClassScan.d.mts`. Two branches that append at the same place conflict; inserting after the listener scan does not.
