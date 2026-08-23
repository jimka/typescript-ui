// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/in-progress/state-tier-full-unification.md's
// Stage 3 — the per-instance state layer (`writeStateStyle` /
// `pinStateStyle` / `resolveStateStyleValue` / `flushStateStyleBag`) —
// Expected Behaviour rows 10-16. Exercised through `Button` / `TabButton`'s
// own `setPressedX` / `getPressedX` / `clearPressedX` family, which Stage 3
// migrates onto this mechanism (see Button.ts's twelve accessor triples).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Button } from '~/component/button/Button';
import { TabButton } from '~/component/button/TabButton';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

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
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from `ClassStyleRules.test.ts`.
 */
function declarationsDuring(
    recorder: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = recorder.writes.length;
    fn();

    const out: Record<string, string | null> = {};
    for (const w of recorder.writes.slice(start)) {
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

describe('Instance state layer', () => {
    it('row 10: setPressedBackgroundColor writes the real value to #id.pressed, and the getter reports it', () => {
        const button = new Button('Row10');
        button.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(button) + '.pressed', () => {
            button.setPressedBackgroundColor('red');
        });

        expect(declarations.backgroundColor).toBe('red');
        expect(button.getPressedBackgroundColor()).toBe('red');
    });

    it('row 11: writing the class-tier token value queues an explicit null, clearing any stale pin', () => {
        const classToken = 'var(--ts-ui-button-pressed-bg, rgb(200, 200, 200))';
        const button = new Button('Row11');
        button.getElement(true);
        // Pin a real, differing value first so there is something for the
        // matching write below to actually clear.
        button.setPressedBackgroundColor('red');

        const declarations = declarationsDuring(sink, idSelector(button) + '.pressed', () => {
            button.setPressedBackgroundColor(classToken);
        });

        expect(declarations.backgroundColor).toBeNull();
    });

    it('row 12: getBackgroundColor() reports the pressed override while .pressed is active, and the resting value otherwise', () => {
        const button = new Button('Row12');
        button.getElement(true);

        const resting = button.getBackgroundColor();
        button.setPressedBackgroundColor('red');

        (button as unknown as { setStyleState(name: string, active: boolean): unknown }).setStyleState('.pressed', true);
        expect(button.getBackgroundColor()).toBe('red');

        (button as unknown as { setStyleState(name: string, active: boolean): unknown }).setStyleState('.pressed', false);
        expect(button.getBackgroundColor()).toBe(resting);
    });

    it('row 13: clearPressedBackgroundColor pins the resting background, and the getter reports that pinned value', () => {
        const button = new Button('Row13');
        button.getElement(true);
        const resting = button.getBackgroundColor();

        const declarations = declarationsDuring(sink, idSelector(button) + '.pressed', () => {
            button.clearPressedBackgroundColor();
        });

        expect(declarations.backgroundColor).toBe(resting);
        expect(button.getPressedBackgroundColor()).toBe(resting);
    });

    it('row 14: a chromeless Button pins all four .pressed keys to its own resting values', () => {
        const button = new Button('Row14', { chromeless: true });
        const declarations = declarationsDuring(sink, idSelector(button) + '.pressed', () => {
            button.getElement(true);
        });

        expect(declarations.color).toBe(button.getForegroundColor());
        expect(declarations.backgroundColor).toBe(button.getBackgroundColor());
        expect(declarations.backgroundImage).toBe(button.getBackgroundImage());
        expect(declarations.boxShadow).toBe(button.getShadow());
    });

    it('row 15: getHoverShadow() / getHoverBackgroundColor() fold the class default when no instance override exists', () => {
        const button = new Button('Row15');
        expect(button.getHoverShadow()).toBe('var(--ts-ui-button-hover-shadow, 1px 3px 6px 0 rgba(0, 0, 0, 0.25))');

        const tab = new TabButton('Row15Tab');
        expect(tab.getHoverBackgroundColor()).toBe('var(--ts-ui-tab-button-hover-bg, #c4c4cf)');
    });

    it('row 16: setPressedBorder / getPressedBorder / clearPressedBorder round-trip through the instance state layer', () => {
        const button = new Button('Row16');
        button.getElement(true);

        const setDeclarations = declarationsDuring(sink, idSelector(button) + '.pressed', () => {
            button.setPressedBorder('1px solid red');
        });
        expect(setDeclarations.borderTop).toBe('1px solid red');
        expect(setDeclarations.borderRight).toBe('1px solid red');
        expect(setDeclarations.borderBottom).toBe('1px solid red');
        expect(setDeclarations.borderLeft).toBe('1px solid red');
        expect(button.getPressedBorder()).toEqual({ border: '1px solid red' });

        const clearDeclarations = declarationsDuring(sink, idSelector(button) + '.pressed', () => {
            button.clearPressedBorder();
        });
        expect(clearDeclarations.borderTop).toBeNull();
        expect(clearDeclarations.borderRight).toBeNull();
        expect(clearDeclarations.borderBottom).toBeNull();
        expect(clearDeclarations.borderLeft).toBeNull();
        expect(button.getPressedBorder()).toBeNull();
    });
});
