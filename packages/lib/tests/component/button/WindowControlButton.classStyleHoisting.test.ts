// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for plans/implemented/button-variant-chrome-dedup.md's window-
// control button fix (Expected Behaviour rows 1-6): `createWindowControlButton`
// / `createWindowLeadGlyphButton` now build real, declared `Button` subclasses
// (`WindowControlButton` / `WindowLeadGlyphButton`, module-private to
// `overlay/windowControls.ts`) instead of `Button({ chromeless: true,
// styleRules: [...] })`, so their resting/pressed/hover chrome dedupes onto
// shared `.WindowControlButton`/`.WindowLeadGlyphButton` class rules the same
// way `TabButton`'s own chrome already does (see
// TabButton.stateClassHoisting.test.ts / Button.pressedHoverClassHoisting.test.ts
// for the precedent this file's `declarationsFrom`/`idSelector` helpers and
// warmup-then-second-instance shape are copied from).
//
// Both `.WindowControlButton.pressed`/`.WindowControlButton:hover:not(.pressed)`
// materialise eagerly during a WindowControlButton's *construction* (Button's
// chromeful `applyChromeOptions` dispatches the pressed/hover setters from the
// constructor, before any `getElement(true)` render — see
// `SpinButton.test.ts`'s identical observation for `.Button.pressed`), and
// they are process-module state that persists across `it()` blocks within
// this file (module state is per test *file*, not per test — see
// `ClassStyleRules.test.ts`'s own comment). Asserting their exact content
// therefore has to happen during the very first WindowControlButton ever
// constructed in this file, which is also why rows 1/2/3/6 below all live in
// one `it()`: splitting the pressed/hover-interaction row (6) into its own
// `it()` would give it a *second* `installTestDOM()` window, and
// `Button.pressedState.test.ts`'s own comment documents that `Event.ts`'s
// module-level "already installed" listener state silently drops native
// dispatch on any window after the file's first (each `beforeEach` here
// otherwise creates a fresh one).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWindowControlButton, createWindowLeadGlyphButton, setWindowControlsActive } from '~/overlay/windowControls';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { Glyph } from '~/component/display/Glyph';
import { xmark } from '~/glyphs/solid/xmark';
import { window_maximize } from '~/glyphs/solid/window_maximize';
import { window_minimize } from '~/glyphs/solid/window_minimize';

// Callers normally get these glyphs registered as a side effect of importing
// `WindowHeader.ts` (which calls `Glyph.register` at module scope) before
// `createWindowControlButton`/`createWindowLeadGlyphButton` ever run — this
// file exercises `windowControls.ts` directly, so it registers them itself.
Glyph.register(xmark, window_maximize, window_minimize);

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => { sink = installTestDOM(DOM_CONFIG); });
afterEach(() => DOM.reset());

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Flattens every `setRuleStyles` write to `selector` found in `writes` into
 * one key/value map (last write per key wins).
 */
function declarationsFor(writes: RecordingDOMSink['writes'], selector: string): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const w of writes) {
        if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
            continue;
        }

        const styles = w.args[1] as Record<string, string | null>;
        for (const key of Object.keys(styles)) {
            out[key] = styles[key];
        }
    }

    return out;
}

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran.
 * Thin wrapper around {@link declarationsFor} for the common single-selector,
 * single-call case.
 */
function declarationsDuring(
    recorder: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = recorder.writes.length;
    fn();

    return declarationsFor(recorder.writes.slice(start), selector);
}

/** True when `w` is an `addClass`/`removeClass` write touching the "pressed"
 *  token — copied from `Button.pressedState.test.ts`'s helper of the same name. */
function touchesPressed(w: RecordingDOMSink['writes'][number]): boolean {
    if (w.op !== 'apply') {
        return false;
    }

    const patch = w.args[1] as { addClass?: readonly string[]; removeClass?: readonly string[] };

    return !!(patch.addClass?.includes('pressed') || patch.removeClass?.includes('pressed'));
}

/** True when the last write touching the "pressed" token on `handle` added it. */
function isPressed(recorder: RecordingDOMSink, handle: Handle): boolean {
    const writes = recorder.writes.filter(w => w.args[0] === handle && touchesPressed(w));
    const last = writes[writes.length - 1];
    const patch = last?.args[1] as { addClass?: readonly string[] } | undefined;

    return !!patch?.addClass?.includes('pressed');
}

describe('WindowControlButton class-style hoisting', () => {
    it('rows 1/2/3/6: resting+pressed+hover content publishes on first construction, a second instance dedupes onto it, and two instances in different pressed states stay independent', () => {
        const start = sink.writes.length;
        const first = createWindowControlButton('xmark');
        first.getElement(true);
        const firstWrites = sink.writes.slice(start);

        // Row 2: .WindowControlButton carries the resting tokens.
        const restingClassDeclarations = declarationsFor(firstWrites, '.WindowControlButton');
        expect(restingClassDeclarations.backgroundColor).toBe('var(--ts-ui-window-control-bg)');
        expect(restingClassDeclarations.backgroundImage).toBe('var(--ts-ui-window-control-bg)');
        expect(restingClassDeclarations.borderTop).toBe('var(--ts-ui-window-control-border)');
        expect(restingClassDeclarations.borderRight).toBe('var(--ts-ui-window-control-border)');
        expect(restingClassDeclarations.borderBottom).toBe('var(--ts-ui-window-control-border)');
        expect(restingClassDeclarations.borderLeft).toBe('var(--ts-ui-window-control-border)');
        expect(restingClassDeclarations.boxShadow).toBe('var(--ts-ui-window-control-shadow)');

        // Row 3: .WindowControlButton.pressed / :hover:not(.pressed) carry the
        // full pinned key set (foregroundColor/shadow pinned to the resting
        // value, only backgroundColor/backgroundImage actually change).
        const pressedClassDeclarations = declarationsFor(firstWrites, '.WindowControlButton.pressed');
        expect(pressedClassDeclarations.color).toBe('var(--ts-ui-text-color, black)');
        expect(pressedClassDeclarations.backgroundColor).toBe('var(--ts-ui-window-control-active-bg)');
        expect(pressedClassDeclarations.backgroundImage).toBe('var(--ts-ui-window-control-active-bg)');
        expect(pressedClassDeclarations.boxShadow).toBe('var(--ts-ui-window-control-shadow)');

        const hoverClassDeclarations = declarationsFor(firstWrites, '.WindowControlButton:hover:not(.pressed)');
        expect(hoverClassDeclarations.backgroundColor).toBe('var(--ts-ui-window-control-hover-bg)');
        expect(hoverClassDeclarations.backgroundImage).toBe('var(--ts-ui-window-control-hover-bg)');
        expect(hoverClassDeclarations.boxShadow).toBe('var(--ts-ui-window-control-shadow)');

        expect(_ruleCacheHas('.WindowControlButton')).toBe(true);
        expect(_ruleCacheHas('.WindowControlButton.pressed')).toBe(true);
        expect(_ruleCacheHas('.WindowControlButton:hover:not(.pressed)')).toBe(true);

        // Rows 1+3: a second instance, rendered after the first warmed the
        // class rules, writes no real declaration to its own resting
        // (`:not(.pressed):not(:hover)`-guarded — see `restingGuardSuffix`),
        // `.pressed`, or `:hover:not(.pressed)` rule.
        const secondStart = sink.writes.length;
        const second = createWindowControlButton('xmark');
        second.getElement(true);
        const secondWrites = sink.writes.slice(secondStart);

        const secondResting = declarationsFor(secondWrites, idSelector(second) + ':not(.pressed):not(:hover)');
        expect(secondResting.backgroundColor).toBeUndefined();
        expect(secondResting.backgroundImage).toBeUndefined();
        expect(secondResting.borderTop).toBeUndefined();
        expect(secondResting.boxShadow).toBeUndefined();

        const secondPressed = declarationsFor(secondWrites, idSelector(second) + '.pressed');
        expect(secondPressed.color).toBeUndefined();
        expect(secondPressed.backgroundColor).toBeUndefined();
        expect(secondPressed.backgroundImage).toBeUndefined();
        expect(secondPressed.boxShadow).toBeUndefined();

        const secondHover = declarationsFor(secondWrites, idSelector(second) + ':hover:not(.pressed)');
        expect(secondHover.backgroundColor).toBeUndefined();
        expect(secondHover.backgroundImage).toBeUndefined();
        expect(secondHover.boxShadow).toBeUndefined();

        // Row 6: pressing one instance doesn't touch another's DOM class, and
        // each keeps resolving through the cascade independently.
        const firstHandle  = first.getElement(true)!;
        const secondHandle = second.getElement(true)!;
        DOM.sink.dispatchEvent(secondHandle, makeEvent(secondHandle, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0 }));

        expect(isPressed(sink, secondHandle)).toBe(true);
        expect(isPressed(sink, firstHandle)).toBe(false);
        expect(sink.writes.some(w => w.args[0] === firstHandle && touchesPressed(w))).toBe(false);
    });

    it('row 4: a second lead-glyph button writes no resting declaration to its own rule; .WindowLeadGlyphButton carries the transparent tokens', () => {
        const start = sink.writes.length;
        const first = createWindowLeadGlyphButton('window-maximize');

        // The button lives inside `TabBar._leadGroup`, itself
        // `pointer-events: none` (TabBar.ts) — pointer-events is inherited CSS,
        // so only an explicit `auto` on the button itself makes it
        // hit-testable, the same fix `WindowHeader.setGlyph`'s title glyph and
        // `SplitButton`'s chevron already apply for the identical reason. The
        // offline harness has no real pointer-events hit-testing (see
        // ScrollbarArrow.test.ts's identical caveat), so this checks the
        // resolved property directly, the way Scrollbar.test.ts's "arrow glyph
        // pointer-events:none" case does for the opposite value.
        expect(first.getPointerEvents()).toBe('auto');

        first.getElement(true);
        const firstWrites = sink.writes.slice(start);

        const classDeclarations = declarationsFor(firstWrites, '.WindowLeadGlyphButton');
        expect(classDeclarations.backgroundColor).toBe('transparent');
        expect(classDeclarations.backgroundImage).toBe('none');
        expect(classDeclarations.borderTop).toBe('1px solid transparent');
        expect(classDeclarations.borderRight).toBe('1px solid transparent');
        expect(classDeclarations.borderBottom).toBe('1px solid transparent');
        expect(classDeclarations.borderLeft).toBe('1px solid transparent');
        expect(classDeclarations.boxShadow).toBe('none');

        // The leading glyph is now clickable (it opens the window menu), so it
        // carries the same two window-control states — `.pressed` and
        // `:hover:not(.pressed)` — as `.WindowControlButton`, with its own
        // background tokens (see windowControls.ts's
        // `_defaultWindowLeadGlyphOptions`).
        const pressedClassDeclarations = declarationsFor(firstWrites, '.WindowLeadGlyphButton.pressed');
        expect(pressedClassDeclarations.backgroundColor).toBe('var(--ts-ui-window-control-active-bg)');
        expect(pressedClassDeclarations.backgroundImage).toBe('var(--ts-ui-window-control-active-bg)');

        const hoverClassDeclarations = declarationsFor(firstWrites, '.WindowLeadGlyphButton:hover:not(.pressed)');
        expect(hoverClassDeclarations.backgroundColor).toBe('var(--ts-ui-window-control-hover-bg)');
        expect(hoverClassDeclarations.backgroundImage).toBe('var(--ts-ui-window-control-hover-bg)');

        const second = createWindowLeadGlyphButton('window-maximize');
        const instanceDeclarations = declarationsDuring(sink, idSelector(second) + ':not(.pressed):not(:hover)', () => second.getElement(true));

        expect(instanceDeclarations.backgroundColor).toBeUndefined();
        expect(instanceDeclarations.backgroundImage).toBeUndefined();
        expect(instanceDeclarations.borderTop).toBeUndefined();
        expect(instanceDeclarations.boxShadow).toBeUndefined();
    });

    it('row 5: setWindowControlsActive(false) writes a real per-instance deviation, and setWindowControlsActive(true) reverts to nothing further', () => {
        const button = createWindowControlButton('xmark');
        button.getElement(true);

        // The resting write is isolated onto `#id:not(.pressed):not(:hover)`
        // (Button.restingChromeIsolation.test.ts's mechanism) — backgroundColor/
        // backgroundImage are also part of WindowControlButton's own `.pressed`/
        // `:hover` state bags, so a bare `#id` write would tie in specificity
        // against the shared `.WindowControlButton.pressed` rule.
        const restingSelector = idSelector(button) + ':not(.pressed):not(:hover)';

        const blurDeclarations = declarationsDuring(sink, restingSelector, () => {
            setWindowControlsActive([button], false);
        });

        expect(blurDeclarations.backgroundColor).toBe('transparent');
        expect(blurDeclarations.backgroundImage).toBe('none');

        const restoreDeclarations = declarationsDuring(sink, restingSelector, () => {
            setWindowControlsActive([button], true);
        });

        // Reverting to the class-tier token again matches .WindowControlButton's
        // own default, so the isolated rule's earlier "blurred" declaration is
        // nulled out by the flush-time comparison rather than re-asserted.
        expect(restoreDeclarations.backgroundColor).toBeNull();
        expect(restoreDeclarations.backgroundImage).toBeNull();
    });
});
