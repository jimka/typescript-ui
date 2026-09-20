import { describe, it, expect, afterEach, vi } from 'vitest';
import { ButtonGroup } from '~/overlay/ButtonGroup';
import { ToggleButton } from '~/component/button/ToggleButton';
import { RadioButton } from '~/component/input/RadioButton';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { SpatialNavigation } from '~/core/SpatialNavigation';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Bracket-accesses the private updateButtonStates — the exact method the
 *  (offline-undispatchable) `on("action")` listener calls. */
function selectVia(group: ButtonGroup, button: ToggleButton): void {
    (group as any).updateButtonStates(button);
}

/**
 * `installBaseListener` (core/Event.ts) attaches its native "keydown"
 * window listener only on the type's first-ever registration in this
 * file, and every Button constructed by an earlier test (every `Button`
 * registers its own "keydown" listener — see Button.ts's `_onSpaceDown`)
 * already left one behind, pinned to that test's now-torn-down window
 * (see Button.pressedState.test.ts's file header for the same landmine)
 * — so a plain `installTestDOM` here would silently receive no "keydown"
 * delivery at all. Purging every currently-registered component via the
 * sanctioned test-only escape hatch (`Event._registeredComponentIds` /
 * `Event.purgeComponent`) drops "keydown" back to uninstalled, so the
 * container wired right after re-attaches it to THIS window.
 *
 * The same pinning applies to every other type the cases below dispatch —
 * "click", and the "change" a toggle fires from it — which is why the purge
 * sweeps the whole registry rather than one type.
 */
function freshEventWindow(): void {
    installTestDOM(CONFIG);

    for (const id of Event._registeredComponentIds()) {
        Event.purgeComponent(id);
    }
}

/**
 * Drives a member the way a user does: a real "click" dispatch, which reaches
 * `ToggleButton.onAction`, toggles the button, and fires its `"change"` — the
 * DOM event the group's own `"action"` registration listens on. `selectVia`
 * above bypasses exactly that wiring, so it cannot see whether the group is
 * still listening.
 */
function clickButton(button: ToggleButton): void {
    Event.fireEvent(button, makeEvent(button.getElement(true)!, 'click') as any);
}

describe('ButtonGroup selection model', () => {
    afterEach(() => DOM.reset());

    it('the else branch (already-selected initiator) deselects every sibling', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const c = new ToggleButton('C');
        const group = new ButtonGroup({ buttons: [a, b, c] });

        // Mirror the real action flow: the button toggles itself selected before
        // updateButtonStates runs, so the initiator is already selected and the
        // mutual-exclusivity (else) branch deselects the rest.
        b.setSelected(true);
        selectVia(group, b);

        expect(b.isSelected()).toBe(true);
        expect(a.isSelected()).toBe(false);
        expect(c.isSelected()).toBe(false);
    });

    it('the !isSelected branch only selects the initiator (siblings untouched)', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });

        // a starts selected; invoking updateButtonStates on the *unselected* b
        // hits the `!isSelected` true branch, which only selects b — it does NOT
        // deselect a in this branch (that is the documented two-branch split).
        a.setSelected(true);
        selectVia(group, b);

        expect(b.isSelected()).toBe(true);
        expect(a.isSelected()).toBe(true);
    });

    it('selection fires once with the initiator', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });
        const onSelection = vi.fn();

        group.on('selection', onSelection);

        b.setSelected(true);
        selectVia(group, b);

        expect(onSelection).toHaveBeenCalledOnce();
        expect(onSelection).toHaveBeenCalledWith(b);
    });

    it('re-selecting the already-selected initiator keeps siblings deselected', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });

        b.setSelected(true);
        selectVia(group, b);
        selectVia(group, b);            // re-run on the already-selected initiator

        expect(b.isSelected()).toBe(true);
        expect(a.isSelected()).toBe(false);
    });

    it('addButtons flattens nested arrays and getButtons returns them all', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const c = new ToggleButton('C');
        const d = new ToggleButton('D');
        const group = new ButtonGroup();

        group.addButtons(a, [b, c], d);

        expect(group.getButtons()).toHaveLength(4);
        expect(group.getButtons()).toEqual([a, b, c, d]);
    });

    it('removeButton drops the member', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });

        group.removeButton(a);

        expect(group.getButtons()).toEqual([b]);
    });

    it('removeButton of a non-member is a no-op', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const stray = new ToggleButton('S');
        const group = new ButtonGroup({ buttons: [a] });

        expect(() => group.removeButton(stray)).not.toThrow();
        expect(group.getButtons()).toEqual([a]);
    });

    it('default: clicking the selected button off re-selects it (one always selected)', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });

        b.setSelected(true);
        selectVia(group, b);

        // A click on the active button toggles it off, then updateButtonStates
        // runs — the radio invariant snaps it back on.
        b.setSelected(false);
        selectVia(group, b);

        expect(b.isSelected()).toBe(true);
    });

    it('allowDeselect: clicking the selected button off leaves the group with nothing selected', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b], allowDeselect: true });
        const onSelection = vi.fn();
        group.on('selection', onSelection);

        b.setSelected(true);
        selectVia(group, b);            // select b (deselects a)
        expect(b.isSelected()).toBe(true);

        b.setSelected(false);
        selectVia(group, b);            // click b off — stays off

        expect(b.isSelected()).toBe(false);
        expect(a.isSelected()).toBe(false);
        // selection still fires, carrying the now-deselected initiator.
        expect(onSelection).toHaveBeenLastCalledWith(b);
    });

    it('allowDeselect still enforces mutual exclusivity on select', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b], allowDeselect: true });

        a.setSelected(true);
        selectVia(group, a);
        b.setSelected(true);
        selectVia(group, b);            // choosing b deselects a

        expect(b.isSelected()).toBe(true);
        expect(a.isSelected()).toBe(false);
    });

    it('setAllowDeselect toggles the behaviour at runtime', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const group = new ButtonGroup({ buttons: [a] });

        group.setAllowDeselect(true);

        a.setSelected(true);
        selectVia(group, a);
        a.setSelected(false);
        selectVia(group, a);

        expect(a.isSelected()).toBe(false);
    });

    it('RadioButton members receive the shared radioName (the group id)', () => {
        installTestDOM(CONFIG);

        const r1 = new RadioButton('One');
        const r2 = new RadioButton('Two');
        const group = new ButtonGroup({ buttons: [r1, r2] });

        const groupId = (group as any)._groupId as string;

        expect(r1.getRadioName()).toBe(groupId);
        expect(r2.getRadioName()).toBe(groupId);
    });
});

describe('ButtonGroup.dispose()', () => {
    afterEach(() => DOM.reset());

    it('clears the selection bag so a subsequent selection change does not fire it', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });
        const onSelection = vi.fn();

        group.on('selection', onSelection);
        group.dispose();

        b.setSelected(true);
        selectVia(group, b);

        expect(onSelection).not.toHaveBeenCalled();
    });

    it('is idempotent', () => {
        installTestDOM(CONFIG);

        const group = new ButtonGroup();

        group.dispose();

        expect(() => group.dispose()).not.toThrow();
    });
});

// The group registers an `"action"` listener on every member and a subtree
// `"keydown"` on every container it is handed. Neither registration is the
// button's or the container's to release, so the group has to take each one
// away itself — and until it did, a button the group had let go of still
// deselected its former siblings on the next click.
describe('ButtonGroup releases the registrations it made', () => {
    afterEach(() => DOM.reset());

    it('a removed member stops deselecting its former siblings', () => {
        freshEventWindow();

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });

        b.setSelected(true);
        group.removeButton(a);

        clickButton(a);

        expect(a.isSelected()).toBe(true);
        expect(b.isSelected()).toBe(true);
    });

    it('a disposed group stops reconciling its former members', () => {
        freshEventWindow();

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });

        b.setSelected(true);
        group.dispose();

        clickButton(a);

        expect(a.isSelected()).toBe(true);
        expect(b.isSelected()).toBe(true);
    });

    // A second add of the same button would overwrite the held handler and
    // strand the first, re-opening the leak the map exists to close — so the
    // second call does nothing at all.
    it('adding a button already in the group is a no-op', () => {
        freshEventWindow();

        const a = new ToggleButton('A');
        const group = new ButtonGroup({ buttons: [a] });
        const onSelection = vi.fn();

        group.addButton(a);
        group.on('selection', onSelection);

        clickButton(a);

        expect(group.getButtons()).toEqual([a]);
        expect(onSelection).toHaveBeenCalledOnce();
    });

    // A bare `new Component()` holds no other `Event` registration, so its
    // presence in the registry is an exact signal for the group's own subtree
    // `"keydown"` listener and nothing else.
    it('setContainer unwires the container it wired last', () => {
        freshEventWindow();

        const group = new ButtonGroup({ buttons: [new ToggleButton('A')] });
        const first  = new Component();
        const second = new Component();

        first.getElement(true);
        second.getElement(true);

        group.setContainer(first);
        group.setContainer(second);

        const registered = Event._registeredComponentIds();

        expect(registered).not.toContain(first.getId());
        expect(registered).toContain(second.getId());
    });

    it('dispose unwires the container it was given', () => {
        freshEventWindow();

        const group = new ButtonGroup({ buttons: [new ToggleButton('A')] });
        const container = new Component();

        container.getElement(true);
        group.setContainer(container);

        expect(Event._registeredComponentIds()).toContain(container.getId());

        group.dispose();

        expect(Event._registeredComponentIds()).not.toContain(container.getId());
    });
});

// directional-panel-navigation plan, Expected Behaviour #23: SpatialNavigation's
// chord claims the arrow key first, so the group's own roving-focus step must
// stand down entirely while it does.
describe('ButtonGroup keydown — stands down while SpatialNavigation claims the key', () => {
    afterEach(() => {
        DOM.reset();
        vi.restoreAllMocks();
    });

    /** A materialised container wired to `group` via setContainer, ready to dispatch a real keydown onto. */
    function wiredContainer(group: ButtonGroup): Component {
        const container = new Component();
        container.getElement(true);
        group.setContainer(container);

        return container;
    }

    it('ArrowRight moves the roving tab index forward when the key is unclaimed', () => {
        freshEventWindow();

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });
        const container = wiredContainer(group);

        Event.fireEvent(container, makeEvent(container.getElement(true)!, 'keydown', { key: 'ArrowRight' }) as any);

        expect((group as any)._rovingTabIndex.getActiveIndex()).toBe(1);
    });

    it('a claimed ArrowRight does not move the roving tab index', () => {
        freshEventWindow();

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });
        const container = wiredContainer(group);

        vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true);
        const moveNext = vi.spyOn((group as any)._rovingTabIndex, 'moveNext');

        Event.fireEvent(container, makeEvent(container.getElement(true)!, 'keydown', { key: 'ArrowRight' }) as any);

        expect(moveNext).not.toHaveBeenCalled();
        expect((group as any)._rovingTabIndex.getActiveIndex()).toBe(0);
    });
});
