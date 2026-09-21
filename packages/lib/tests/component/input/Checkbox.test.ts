//
// Checkbox checked-state coverage. Most cases run on a bare (unmounted)
// checkbox: setSelected guards its synthetic `click` behind `if
// (this.getElement())`, so unmounted it only console.warns and the state flip
// still happens. The one mount-requiring case asserts the `on("action")`
// synthetic-click fan-out and uses the TestDOM ritual copied from
// tests/component/layout/Tab.test.ts.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Checkbox, CheckboxOptions } from '~/component/input/Checkbox';
import { Container } from '~/core/Container';
import { DOM, type Handle } from '~/core/DOM';
import { Event } from '~/core/Event';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../../dom/TestDOM';
import { _ruleCacheHas } from '~/core/StyleTarget';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
 */
function declarationsDuring(
    sink: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = sink.writes.length;
    fn();

    const out: Record<string, string | null> = {};
    for (const w of sink.writes.slice(start)) {
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

describe('Checkbox value/selected aliasing', () => {
    it('aliases the value option onto selected when selected is absent', () => {
        expect(new Checkbox({ value: true }).isSelected()).toBe(true);
    });

    it('lets an explicit selected win over value', () => {
        expect(new Checkbox({ value: true, selected: false }).isSelected()).toBe(false);
    });

    it('mirrors getValue/setValue onto isSelected/setSelected', () => {
        const cb = new Checkbox();
        expect(cb.getValue()).toBe(false);

        cb.setValue(true);
        expect(cb.isSelected()).toBe(true);
        expect(cb.getValue()).toBe(true);
    });
});

describe('Checkbox setSelected transitions', () => {
    afterEach(() => vi.restoreAllMocks());

    it('flips state and warns (no synthetic click) when unmounted', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cb   = new Checkbox();

        cb.setSelected(true);

        expect(cb.isSelected()).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('fires change exactly once across a flip and a redundant set', () => {
        // Silence the unmounted-setSelected console.warn; not asserted here.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cb = new Checkbox();

        let changes = 0;
        cb.on('change', () => {
            changes += 1;
        });

        cb.setSelected(true);
        cb.setSelected(true); // no-op guard: already selected, not indeterminate.

        expect(cb.isSelected()).toBe(true);
        expect(changes).toBe(1);
    });
});

describe('Checkbox indeterminate force-out', () => {
    afterEach(() => vi.restoreAllMocks());

    it('enters the mixed state via setIndeterminate', () => {
        const cb = new Checkbox();
        cb.setIndeterminate(true);

        expect(cb.isIndeterminate()).toBe(true);
    });

    it('clears indeterminate and lands selected on a subsequent setSelected(true)', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const cb = new Checkbox();
        cb.setIndeterminate(true);
        cb.setSelected(true);

        expect(cb.isIndeterminate()).toBe(false);
        expect(cb.isSelected()).toBe(true);
    });
});

describe('Checkbox label round-trip', () => {
    it('reads back a label and clears it with null', () => {
        const cb = new Checkbox({ label: 'Accept' });
        expect(cb.getLabel()).toBe('Accept');

        cb.setLabel(null);
        expect(cb.getLabel()).toBe(null);
    });
});

describe('Checkbox notifyChange fan-out (binding)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('fires both change (with value) and binding (no args) on a transition', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const cb = new Checkbox();

        let changeValue: boolean | null = null;
        let bindings = 0;
        cb.on('change', (v: boolean) => {
            changeValue = v;
        });
        cb.on('binding', () => {
            bindings += 1;
        });

        cb.setSelected(true);

        expect(changeValue).toBe(true);
        expect(bindings).toBe(1);
    });
});

describe('Checkbox action fan-out (mounted)', () => {
    afterEach(() => DOM.reset());

    it('dispatches a synthetic click on a programmatic setSelected once mounted', () => {
        // The offline RecordingDOMSink records DOM writes but runs no event
        // loop, so a real `on("action")` callback cannot be invoked here
        // (mirrors tests/unit/core/Event.test.ts, which asserts the recorded
        // dispatchEvent write rather than listener invocation). The `action`
        // listener is wired through `click`, so the contract under test —
        // "a mounted setSelected synthesizes the click" — is the recorded
        // dispatchEvent("click") write that the action path rides on.
        const sink = installTestDOM(CONFIG);

        const host = new Container({});
        const cb   = new Checkbox();
        host.addComponent(cb);
        // Realise the element so setSelected's synthetic Event.fireEvent("click")
        // dispatches to a mounted node instead of console-warning.
        host.getElement(true);
        cb.getElement(true);
        // Drain construction-time pending layouts on the host subtree while the
        // elements are valid, then pause both. The module-level pending-layout
        // set outlives this file, so an undrained component would flush on a
        // later file's real rAF after this DOM was reset — a stray "DOM handle
        // not registered" error. Draining + pausing keeps the queue clean.
        host.flushLayout();
        host.pauseLayout();
        cb.flushLayout();
        cb.pauseLayout();

        cb.setSelected(true);

        expect(cb.isSelected()).toBe(true);
        expect(sink.writes.some((w: any) => w.op === 'dispatchEvent' && w.args[0] === 'click')).toBe(true);
    });

    /**
     * A mounted, layout-paused checkbox under a host container, built with the
     * same ritual (and for the same reasons) as the test above.
     */
    function mountedCheckbox(options?: CheckboxOptions): { sink: RecordingDOMSink; cb: Checkbox } {
        const sink = installTestDOM(CONFIG);

        const host = new Container({});
        const cb   = new Checkbox(options);
        host.addComponent(cb);
        host.getElement(true);
        cb.getElement(true);
        host.flushLayout();
        host.pauseLayout();
        cb.flushLayout();
        cb.pauseLayout();

        return { sink, cb };
    }

    /** Synthetic-click dispatches recorded on `sink` since write index `start`. */
    function clickDispatches(sink: RecordingDOMSink, start: number): number {
        return sink.writes.slice(start).filter((w: any) => w.op === 'dispatchEvent' && w.args[0] === 'click').length;
    }

    it('suppresses the synthetic click but still fires change and binding when fireAction is false', () => {
        // CONTRACT: `fireAction: false` gates the `"action"` dispatch and
        // nothing else — the listener-bag events a `Binding` rides on still
        // fire, because `notifyChange` runs either way.
        const { sink, cb } = mountedCheckbox();

        let changeValue: boolean | null = null;
        let bindings = 0;
        cb.on('change', (v: boolean) => {
            changeValue = v;
        });
        cb.on('binding', () => {
            bindings += 1;
        });

        const start = sink.writes.length;
        cb.setSelected(true, false);

        expect(cb.isSelected()).toBe(true);
        expect(changeValue).toBe(true);
        expect(bindings).toBe(1);
        expect(clickDispatches(sink, start)).toBe(0);
    });

    it('lets the no-op guard win ahead of fireAction, in either position', () => {
        // CONTRACT: an unchanged write returns before the flag is ever read,
        // so neither call notifies and neither dispatches.
        const { sink, cb } = mountedCheckbox({ selected: true });

        let changes  = 0;
        let bindings = 0;
        cb.on('change', () => {
            changes += 1;
        });
        cb.on('binding', () => {
            bindings += 1;
        });

        const start = sink.writes.length;
        cb.setSelected(true, false);
        cb.setSelected(true);

        expect(cb.isSelected()).toBe(true);
        expect(changes).toBe(0);
        expect(bindings).toBe(0);
        expect(clickDispatches(sink, start)).toBe(0);
    });
});

describe('Checkbox action delivery (mounted)', () => {
    afterEach(() => DOM.reset());

    /**
     * Installs a fresh TestDOM and clears `Event`'s component registry, so the
     * window-level base listener that this file's earlier, DOM-less Checkboxes
     * installed is re-installed against the window handle the dispatches below
     * actually route through. Without it every "zero actions" assertion here
     * would pass vacuously. Ritual copied from RadioButton.test.ts.
     */
    function freshEventWindow(): void {
        installTestDOM(CONFIG);

        for (const id of Event._registeredComponentIds()) {
            Event.purgeComponent(id);
        }
    }

    /**
     * A mounted, quiesced Checkbox and its realized box graphic. Pausing the
     * checkbox and its private children before flushing the host keeps the
     * module-level pending-layout set from flushing against a reset DOM in a
     * later file (see Slider.test.ts's `quiesce` for the full reasoning).
     * Modelled on RadioButton.test.ts's `mountedRadio`.
     */
    function mountedCheckbox(options?: CheckboxOptions): { cb: any; box: Handle } {
        freshEventWindow();

        const host = new Container({});
        const cb   = new Checkbox(options) as any;
        host.addComponent(cb);
        host.getElement(true);
        cb.getElement(true);

        const box = cb._box.getElement(true)!;

        cb._box.pauseLayout();
        cb._check.pauseLayout();
        cb._dash.pauseLayout();
        cb.pauseLayout();
        host.pauseLayout();
        host.flushLayout();
        cb.flushLayout();

        return { cb, box };
    }

    /** Dispatches a primary-button click on `target`, routed through `cb`'s element. */
    function click(cb: any, target: Handle): void {
        Event.fireEvent(cb, makeEvent(target, 'click', { button: 0 }) as any);
    }

    it('fires action once, as a DOM change, for a click on the box', () => {
        const { cb, box } = mountedCheckbox();

        const types: string[] = [];
        cb.on('action', (e: { type: string }) => {
            types.push(e.type);
        });

        click(cb, box);

        expect(cb.isSelected()).toBe(true);
        expect(types).toEqual(['change']);
    });

    it('fires action once for Space on the focused checkbox', () => {
        const { cb } = mountedCheckbox();

        let actions = 0;
        cb.on('action', () => {
            actions += 1;
        });

        Event.fireEvent(cb, makeEvent(cb.getElement(true)!, 'keydown', { key: ' ' }) as any);

        expect(cb.isSelected()).toBe(true);
        expect(actions).toBe(1);
    });

    it('fires action once for a click on the box of an indeterminate checkbox, landing it checked', () => {
        const { cb, box } = mountedCheckbox({ indeterminate: true });

        let actions = 0;
        cb.on('action', () => {
            actions += 1;
        });

        click(cb, box);

        expect(cb.isSelected()).toBe(true);
        expect(cb.isIndeterminate()).toBe(false);
        expect(actions).toBe(1);
    });

    it('stays silent for a click on the root outside the box, where a label click lands', () => {
        const { cb } = mountedCheckbox();

        let actions = 0;
        cb.on('action', () => {
            actions += 1;
        });

        click(cb, cb.getElement(true)!);

        expect(cb.isSelected()).toBe(false);
        expect(actions).toBe(0);
    });

    it('stays silent for a click on a disabled checkbox\'s box or root', () => {
        const { cb, box } = mountedCheckbox({ enabled: false });

        let actions = 0;
        cb.on('action', () => {
            actions += 1;
        });

        click(cb, box);
        click(cb, cb.getElement(true)!);

        expect(cb.isSelected()).toBe(false);
        expect(actions).toBe(0);
    });

    it('stays silent for a click on a read-only checkbox\'s box', () => {
        const { cb, box } = mountedCheckbox({ readOnly: true });

        let actions = 0;
        cb.on('action', () => {
            actions += 1;
        });

        click(cb, box);

        expect(cb.isSelected()).toBe(false);
        expect(actions).toBe(0);
    });

    it('stays silent for setSelected, setValue and setIndeterminate, which still fire change', () => {
        const { cb } = mountedCheckbox();

        let actions = 0;
        let changes = 0;
        cb.on('action', () => {
            actions += 1;
        });
        cb.on('change', () => {
            changes += 1;
        });

        cb.setSelected(true);
        cb.setValue(false);
        cb.setIndeterminate(true);

        expect(actions).toBe(0);
        expect(changes).toBe(2);
    });

    it('runs change, binding, then action on a click, with the new state already readable', () => {
        const { cb, box } = mountedCheckbox();

        const order: string[] = [];
        let selectedInAction: boolean | null = null;
        cb.on('change', () => {
            order.push('change');
        });
        cb.on('binding', () => {
            order.push('binding');
        });
        cb.on('action', () => {
            order.push('action');
            selectedInAction = cb.isSelected();
        });

        click(cb, box);

        expect(order).toEqual(['change', 'binding', 'action']);
        expect(selectedInAction).toBe(true);
    });

    it('delivers nothing to a listener removed with off, while the click still toggles', () => {
        const { cb, box } = mountedCheckbox();

        let actions = 0;
        const onAction = (): void => {
            actions += 1;
        };
        cb.on('action', onAction);
        cb.off('action', onAction);

        click(cb, box);

        expect(cb.isSelected()).toBe(true);
        expect(actions).toBe(0);
    });
});

describe('Checkbox action fan-out (unmounted)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('skips the pre-mount warning when fireAction is false, and keeps it for the default', () => {
        // CONTRACT: the pre-mount console.warn belongs to the dispatch the
        // default performs. A caller who opted out of the dispatch has nothing
        // to be warned about; a caller who did not still gets today's warning.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const quiet = new Checkbox();
        quiet.setSelected(true, false);

        expect(quiet.isSelected()).toBe(true);
        expect(warn).toHaveBeenCalledTimes(0);

        new Checkbox().setSelected(true);

        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe('Checkbox delegate static style hoisting', () => {
    afterEach(() => DOM.reset());

    it('row 1: a rendered _box carries no static size/cursor declaration on its own #id rule', () => {
        const sink = installTestDOM(CONFIG);
        const cb   = new Checkbox() as any;
        const box  = cb._box;

        const declarations = declarationsDuring(sink, idSelector(box), () => cb.getElement(true));

        // `_box`'s backgroundColor/border/borderRadius are now all class
        // defaults, so nothing on a default-styled `_box` deviates from
        // `.CheckboxBox` at all — `#id` never materialises, and every key
        // here (including size) is an absent write, not an explicit removal.
        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.minHeight).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        // cursor is untouched by that plan — still skip-based — so a match
        // still leaves no trace at all.
        expect(declarations.cursor).toBeUndefined();
    });

    it('row 2: a rendered _check writes nothing to its own #id rule', () => {
        // plans/glyph-preferredsize-reconciled-write-path.md closes the size
        // gap too: CheckboxCheckGlyph now defaults minSize/maxSize as well as
        // foregroundColor, so color and every size key reconcile to removals
        // in the same batch and a rule with no real declaration never
        // materialises.
        const sink  = installTestDOM(CONFIG);
        const cb    = new Checkbox() as any;
        const check = cb._check;

        const declarations = declarationsDuring(sink, idSelector(check), () => cb.getElement(true));

        expect(declarations).toEqual({});
    });

    it('row 3: a rendered _dash carries no static size/backgroundColor declaration on its own #id rule', () => {
        const sink = installTestDOM(CONFIG);
        const cb   = new Checkbox() as any;
        const dash = cb._dash;

        const declarations = declarationsDuring(sink, idSelector(dash), () => cb.getElement(true));

        // No minHeight check: _dash never had a registered minSize, before or after.
        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        expect(declarations.backgroundColor).toBeUndefined();
    });

    it('row 4: the shared .CheckboxBox/.CheckboxCheckGlyph/.CheckboxDash class rules exist once Checkboxes have rendered', () => {
        installTestDOM(CONFIG);

        new Checkbox().getElement(true);
        new Checkbox().getElement(true);

        expect(_ruleCacheHas('.CheckboxBox')).toBe(true);
        expect(_ruleCacheHas('.CheckboxCheckGlyph')).toBe(true);
        expect(_ruleCacheHas('.CheckboxDash')).toBe(true);
    });
});
