//
// Coverage for Card's keyed-child surface: a `key` layout constraint names a
// child slot, and a factory registered under one is kept unbuilt until its key
// is first selected. Selection by key and selection by component id share one
// slot, so each setter retires the other.
//
// The companion file Card.test.ts covers id-based selection; DeferredChild.test.ts
// covers the addDeferredComponent seam itself, against HBox and Tab.
//
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Card } from '~/layout/Card';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

function hostCard(width: number, height: number, card: Card): Container {
    const host = new Container({ layoutManager: card });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

// Records every build, in order, so a case can assert what was and was not
// constructed. A list, not a flag: "the factory ran" and "the factory ran
// exactly once" are different claims, and only the list pins the second.
function recordingFactory(label: string, built: string[], panels: Map<string, Component>): () => Component {
    return () => {
        built.push(label);

        const panel = new Component({ preferredSize: { width: 10, height: 10 } });

        panels.set(label, panel);

        return panel;
    };
}

function constraints(fields: Partial<LayoutConstraints>): LayoutConstraints {
    return Object.assign(new LayoutConstraints(), fields);
}

function panel(): Component {
    return new Component({ preferredSize: { width: 10, height: 10 } });
}

describe('Card deferred keyed children', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    it('registration builds nothing and adds nothing (case 1)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));
        host.addComponent(recordingFactory('c', built, panels), constraints({ key: 'c' }));

        expect(built).toEqual([]);
        expect(host.getComponents()).toEqual([]);
    });

    it('hasKey answers for a pending slot, a built slot and an unknown key (case 2)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));
        host.addComponent(recordingFactory('c', built, panels), constraints({ key: 'c' }));

        expect(card.hasKey('a')).toBe(true);

        card.setVisibleKey('a');

        // The load-bearing arm: a hasKey that only consults the pending map
        // answers false once the child exists, which breaks the second visit to
        // a page.
        expect(card.hasKey('a')).toBe(true);
        expect(card.hasKey('nope')).toBe(false);
    });

    it('the first selection builds exactly the requested slot (case 3)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));
        host.addComponent(recordingFactory('c', built, panels), constraints({ key: 'c' }));

        card.setVisibleKey('b');

        expect(built).toEqual(['b']);
        expect(host.getComponents()).toEqual([panels.get('b')]);
    });

    it('an unselected slot\'s factory has not run (case 4)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));
        host.addComponent(recordingFactory('c', built, panels), constraints({ key: 'c' }));

        card.setVisibleKey('b');

        // The exact array, not three membership checks: a build of the wrong
        // slot alongside the right one has to fail here too.
        expect(built).toEqual(['b']);
    });

    it('repeated selection builds each slot exactly once (case 5)', () => {
        installTestDOM(CONFIG);

        const warn   = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));

        card.setVisibleKey('a');
        card.setVisibleKey('b');
        card.setVisibleKey('a');

        // A boolean "the factory ran" would pass here without the once-only
        // property; the array pins the count.
        expect(built).toEqual(['a', 'b']);
        expect(host.getComponents()).toHaveLength(2);

        // Returning to a built page must be silent. The counts above cannot see
        // a slot left in the pending registry after its factory ran: the
        // build-time collision guard catches the re-entry and suppresses the
        // rebuild, so the only visible trace of the stale entry is the collision
        // it reports on a page the caller merely revisited.
        expect(warn).not.toHaveBeenCalled();
    });

    it('switching displays the new page and undisplays the old (case 6)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));

        card.setVisibleKey('a');
        card.setVisibleKey('b');
        card.setVisibleKey('a');

        // Both arms, so a state where neither is displayed cannot pass. The
        // `b` arm is also the only thing in the suite that sees the build and
        // the sync being run in the wrong order.
        expect(panels.get('a')!.isDisplayed()).toBe(true);
        expect(panels.get('b')!.isDisplayed()).toBe(false);
    });

    it('selecting a key retires the configured id (case 7)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));

        card.setVisibleKey('b');
        card.setVisibleComponentId(panels.get('b')!.getId());
        card.setVisibleKey('a');

        expect(card.getVisibleKey()).toBe('a');

        // The load-bearing assertion: without the clear the resolver's
        // key-first branch still resolves 'a', so only the stale id reading
        // exposes the miss.
        expect(card.getVisibleComponentId()).toBe(null);
        expect(card.getVisibleComponent()).toBe(panels.get('a'));
    });

    it('selecting an id retires the key (case 8)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));

        card.setVisibleKey('a');
        card.setVisibleKey('b');
        card.setVisibleComponentId(panels.get('a')!.getId());

        expect(card.getVisibleKey()).toBe(null);
        expect(card.getVisibleComponentId()).toBe(panels.get('a')!.getId());

        // The load-bearing assertion: without the clear the resolver takes the
        // key branch and the card shows `b` while its id says `a`.
        expect(card.getVisibleComponent()).toBe(panels.get('a'));
    });

    it('lazy: false on a keyed factory builds it at registration (case 9)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a', lazy: false }));

        expect(built).toEqual(['a']);
        expect(host.getComponents()).toHaveLength(1);

        // True because the live child carries the key, not because anything is
        // still pending.
        expect(card.hasKey('a')).toBe(true);

        card.setVisibleKey('a');

        expect(built).toEqual(['a']);
        expect(card.getVisibleComponent()).toBe(panels.get('a'));
    });

    it('a factory with no key is built at registration, both spellings (case 10)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        // Both arms, because one guard covers the missing-constraints case and
        // the missing-key case together, and a single-arm case list would not
        // notice which half broke.
        host.addComponent(recordingFactory('a', built, panels));
        host.addComponent(recordingFactory('b', built, panels), constraints({ name: 'B' }));

        expect(built).toEqual(['a', 'b']);
        expect(host.getComponents()).toHaveLength(2);
    });

    it('a key selected before its slot exists is built by the next layout pass (case 11)', () => {
        installTestDOM(CONFIG);

        // Selecting a key no slot carries is the reported state, so the warning
        // is expected here rather than asserted on.
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        card.setVisibleKey('a');

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));

        expect(built).toEqual([]);

        host.doLayout();

        expect(built).toEqual(['a']);
        expect(card.getVisibleComponent()).toBe(panels.get('a'));
    });

    it('CardOptions.visibleKey is honoured (case 12)', () => {
        installTestDOM(CONFIG);

        const card   = new Card({ visibleKey: 'a' });
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        expect(card.getVisibleKey()).toBe('a');

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.doLayout();

        expect(built).toEqual(['a']);
        expect(card.getVisibleComponent()).toBe(panels.get('a'));
    });

    it('a promise-returning factory throws and is not retried (case 13)', () => {
        installTestDOM(CONFIG);

        // The layout pass that follows the failed build reports the now-slotless
        // key, which is expected rather than asserted on.
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const card = new Card();
        const host = hostCard(200, 150, card);
        let calls  = 0;

        host.addComponent(
            async () => {
                calls += 1;

                return panel();
            },
            constraints({ key: 'a' }),
        );

        // The regex matters: without the promise check the failure comes out of
        // insertComponent instead and carries a different message.
        expect(() => card.setVisibleKey('a')).toThrow(/returned a promise/);

        // An async function body runs synchronously up to its first await, so
        // the factory did run.
        expect(calls).toBe(1);

        // Re-checked with doLayout rather than a second setVisibleKey, whose
        // same-value early return would swallow the call and pass regardless.
        expect(() => host.doLayout()).not.toThrow();
        expect(calls).toBe(1);
    });

    it('a duplicate key is reported and discarded, and the first registration keeps the key (case 14)', () => {
        installTestDOM(CONFIG);

        const warn   = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('first', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('second', built, panels), constraints({ key: 'a' }));

        expect(warn).toHaveBeenCalledTimes(1);
        expect(built).toEqual([]);
        expect(host.getComponents()).toEqual([]);
        expect(card.hasKey('a')).toBe(true);

        card.setVisibleKey('a');

        // The load-bearing half: a guard that overwrote the map entry rather
        // than discarding the registration leaves every pre-selection count
        // identical, and only the built label differs.
        expect(built).toEqual(['first']);
        expect(host.getComponents()).toHaveLength(1);
        expect(card.getVisibleComponent()).toBe(panels.get('first'));
    });

    it('a throwing factory propagates once and is not re-run (case 15)', () => {
        installTestDOM(CONFIG);

        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const card = new Card();
        const host = hostCard(200, 150, card);
        let calls  = 0;

        host.addComponent(
            () => {
                calls += 1;

                throw new Error('factory boom');
            },
            constraints({ key: 'a' }),
        );

        expect(() => card.setVisibleKey('a')).toThrow('factory boom');
        expect(calls).toBe(1);

        expect(() => host.doLayout()).not.toThrow();
        expect(calls).toBe(1);

        expect(card.getVisibleKey()).toBe('a');

        // Falls back exactly as an unresolvable id does — and there is no live
        // child to fall back to here.
        expect(card.getVisibleComponent()).toBe(null);
    });

    it('a failed build falls back to the first live child, not the outgoing page (case 15b)', () => {
        installTestDOM(CONFIG);

        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();
        const panelX = panel();
        let calls    = 0;

        host.addComponent(panelX, constraints({ key: 'x' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));
        host.addComponent(
            () => {
                calls += 1;

                throw new Error('factory boom');
            },
            constraints({ key: 'a' }),
        );

        card.setVisibleKey('b');

        expect(card.getVisibleComponent()).toBe(panels.get('b'));

        // The non-empty arm of case 15's contract: a failed build resolves like
        // any other key no slot answers to, which is the card's first live
        // child. Leaving the outgoing page resolved would have the card show `b`
        // while getVisibleKey() reports 'a' — a page the card no longer claims
        // to be showing, and one no later layout pass re-resolves, because
        // doLayout re-syncs only when nothing is currently visible.
        expect(() => card.setVisibleKey('a')).toThrow('factory boom');
        expect(calls).toBe(1);
        expect(card.getVisibleKey()).toBe('a');
        expect(card.getVisibleComponent()).toBe(panelX);
        expect(panelX.isDisplayed()).toBe(true);
        expect(panels.get('b')!.isDisplayed()).toBe(false);
    });

    it('an unbuilt slot contributes no size; a built one does (case 16)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));

        expect(card.getPreferredSize()).toBe(null);

        card.setVisibleKey('a');

        // The pair is what matters: the null alone is also what an empty card
        // reports, so only the second assertion proves the null came from the
        // slot being unbuilt rather than from a card that can never size.
        expect(card.getPreferredSize()).toEqual({ width: 10, height: 10 });
    });

    it('lazy: true with no key is reported, and a keyless factory without it is not (case 17)', () => {
        installTestDOM(CONFIG);

        const warn   = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        const reported = hostCard(200, 150, new Card());

        reported.addComponent(recordingFactory('a', built, panels), constraints({ lazy: true }));

        expect(warn).toHaveBeenCalledTimes(1);
        expect(built).toEqual(['a']);
        expect(reported.getComponents()).toHaveLength(1);

        // Both arms, so the warning is pinned to the explicit unsatisfiable
        // request and not to every keyless factory.
        const quiet = hostCard(200, 150, new Card());

        quiet.addComponent(recordingFactory('b', built, panels));

        expect(warn).toHaveBeenCalledTimes(1);
        expect(built).toEqual(['a', 'b']);
        expect(quiet.getComponents()).toHaveLength(1);
    });

    it('a key that already names a built child is discarded too (case 18)', () => {
        installTestDOM(CONFIG);

        const warn   = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));

        card.setVisibleKey('a');

        // The first slot has left the pending map by now, so only hasKey's
        // live-child scan still sees the key.
        host.addComponent(recordingFactory('c', built, panels), constraints({ key: 'a' }));

        expect(warn).toHaveBeenCalledTimes(1);
        expect(built).toEqual(['a']);
        expect(host.getComponents()).toHaveLength(1);

        card.setVisibleKey('b');
        card.setVisibleKey('a');

        expect(built).toEqual(['a', 'b']);
        expect(host.getComponents()).toHaveLength(2);
        expect(card.getVisibleComponent()).toBe(panels.get('a'));
    });

    it('a lazy: false registration under a taken key is discarded, not built (case 19)', () => {
        installTestDOM(CONFIG);

        const warn   = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('first', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('second', built, panels), constraints({ key: 'a', lazy: false }));

        // Pins the guard order. With the collision check below the lazy: false
        // return this registration is declined, the container builds it, and it
        // shadows the still-pending slot.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(built).toEqual([]);
        expect(host.getComponents()).toEqual([]);

        card.setVisibleKey('a');

        expect(built).toEqual(['first']);
        expect(host.getComponents()).toHaveLength(1);
    });

    it('a live child that takes a pending key wins and the factory is dropped (case 20)', () => {
        installTestDOM(CONFIG);

        const warn   = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();
        const panelX = panel();

        host.addComponent(recordingFactory('first', built, panels), constraints({ key: 'a' }));

        // A live component, so no claim hook runs and the registration survives.
        host.addComponent(panelX, constraints({ key: 'a' }));

        // Nothing has been selected and no layout pass has run, so the card has
        // no current visible child yet — the state the first-sync undisplay loop
        // handles.
        card.setVisibleKey('a');

        expect(warn).toHaveBeenCalledTimes(1);

        // The load-bearing assertion: without the check the factory runs and its
        // panel is appended behind panelX, where the first-sync undisplay loop
        // then hides it — parented, invisible and unreachable.
        expect(built).toEqual([]);
        expect(host.getComponents()).toEqual([panelX]);
        expect(card.getVisibleComponent()).toBe(panelX);
        expect(panelX.isDisplayed()).toBe(true);
        expect(card.hasKey('a')).toBe(true);
    });

    it('the same collision while another page is showing undisplays only the old page (case 21)', () => {
        installTestDOM(CONFIG);

        const warn   = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();
        const panelX = panel();

        host.addComponent(recordingFactory('first', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));

        card.setVisibleKey('b');

        host.addComponent(panelX, constraints({ key: 'a' }));

        card.setVisibleKey('a');

        expect(warn).toHaveBeenCalledTimes(1);
        expect(built).toEqual(['b']);
        expect(host.getComponents()).toHaveLength(2);
        expect(card.getVisibleComponent()).toBe(panelX);

        // Both display arms, so a state where neither shows cannot pass.
        // Without the check the else branch undisplays only `b`, leaving the
        // freshly built panel displayed and overlapping panelX.
        expect(panelX.isDisplayed()).toBe(true);
        expect(panels.get('b')!.isDisplayed()).toBe(false);

        // The collision branch drops the pending entry, not just this one
        // build. Revisiting the key is therefore silent instead of reporting
        // the same collision on every visit, and the discarded factory can
        // never run later. A single collision, as the assertions above make on
        // their own, passes whether or not the entry was dropped.
        card.setVisibleKey('b');
        card.setVisibleKey('a');

        expect(warn).toHaveBeenCalledTimes(1);
        expect(built).toEqual(['b']);
        expect(card.getVisibleComponent()).toBe(panelX);
    });

    it('a key on two live children resolves to the first in container order (case 22)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const panelX = panel();
        const panelY = panel();

        host.addComponent(panelX, constraints({ key: 'a' }));
        host.addComponent(panelY, constraints({ key: 'a' }));

        card.setVisibleKey('a');

        // Pins liveChildForKey's first-match rule, which the resolver and the
        // collision check both depend on: a last-match lookup would have the
        // check protect one child while the resolver showed the other.
        expect(card.getVisibleComponent()).toBe(panelX);
        expect(panelY.isDisplayed()).toBe(false);
    });

    it('an async factory reached through doLayout throws there and names the key, not a setter (case 23)', () => {
        installTestDOM(CONFIG);

        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const card = new Card({ visibleKey: 'a' });
        const host = hostCard(200, 150, card);
        let calls  = 0;

        // setVisibleKey is never called: the only route to the build is
        // doLayout's catch-up.
        host.addComponent(
            async () => {
                calls += 1;

                return panel();
            },
            constraints({ key: 'a' }),
        );

        let caught: Error | null = null;

        try {
            host.doLayout();
        } catch (error) {
            caught = error as Error;
        }

        expect(caught).not.toBe(null);
        expect(caught!.message).toMatch(/returned a promise/);

        // The load-bearing assertion: a message hard-coding a setter's name is
        // true on the other path and false here, and no other case reaches the
        // throw from a layout pass.
        expect(caught!.message).not.toMatch(/setVisibleKey/);
        expect(calls).toBe(1);

        expect(() => host.doLayout()).not.toThrow();
        expect(calls).toBe(1);
    });

    it('an element-less pass builds nothing; the first rendered pass builds (case 24)', () => {
        installTestDOM(CONFIG);

        const card   = new Card({ visibleKey: 'a' });
        const built: string[] = [];
        const panels = new Map<string, Component>();

        // Deliberately not hostCard, which renders the container: this arm needs
        // a container with no element.
        const host = new Container({ layoutManager: card });

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));

        expect(() => host.doLayout()).not.toThrow();
        expect(built).toEqual([]);
        expect(host.getComponents()).toEqual([]);

        // The slot is intact, not consumed.
        expect(card.hasKey('a')).toBe(true);

        // Both arms are required: the first alone passes on a card that never
        // builds at all, and the second alone on one that builds too early.
        host.getElement(true);
        host.setWidth(200);
        host.setHeight(150);
        host.clearInsets();
        host.doLayout();

        expect(built).toEqual(['a']);
        expect(card.getVisibleComponent()).toBe(panels.get('a'));
    });

    it('setVisibleKey still builds on an unrendered container, unlike the layout catch-up (case 25)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const built: string[] = [];
        const panels = new Map<string, Component>();
        const host   = new Container({ layoutManager: card });

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));

        // The element gate belongs to the layout pass, not to the build itself:
        // setVisibleKey runs the factory on the caller's stack whatever the
        // container's render state. Without this arm the gate can be moved down
        // into buildDeferredChild — where it also suppresses this build — and
        // case 24 stays green, so the whole suite would pass on an
        // implementation that quietly narrows setVisibleKey's contract.
        card.setVisibleKey('a');

        expect(built).toEqual(['a']);
        expect(host.getComponents()).toEqual([panels.get('a')]);
    });

    it('a registered-but-unbuilt key is not reported, unlike a key no slot carries (case 26)', () => {
        installTestDOM(CONFIG);

        const warn   = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const card   = new Card({ visibleKey: 'a' });
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));

        // Row four of the resolution table: the slot is pending, so the resolver
        // finds no live child — but "not built yet" is not "not found", and the
        // layout pass that follows will build it. A resolver that reported on
        // the missing child alone would make every keyed card noisy at startup,
        // since a size query lands here before the first pass.
        expect(card.getPreferredSize()).toBe(null);
        expect(warn).not.toHaveBeenCalled();

        // Nothing was built to answer the measurement.
        expect(built).toEqual([]);

        // The contrast that makes the suppression a rule rather than blanket
        // silence: a key no slot carries at all is still reported.
        card.setVisibleKey('nope');
        card.getPreferredSize();

        expect(warn).toHaveBeenCalled();
    });

    it('the layout catch-up switches away from the page that was already showing (case 27)', () => {
        installTestDOM(CONFIG);

        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();
        const panelX = panel();

        host.addComponent(panelX, constraints({ key: 'x' }));

        // Selected while no slot carries it: reported, and the card falls back
        // to its first live child — so a page *is* showing by the time the
        // catch-up runs.
        card.setVisibleKey('a');

        expect(card.getVisibleComponent()).toBe(panelX);

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.doLayout();

        // The arm cases 11, 12, 23 and 24 cannot reach: each of those starts
        // from an empty card, where doLayout's own `if (!_currentVisible)`
        // re-sync stands in for the one inside the catch-up. With something
        // already resolved only the catch-up's own sync can switch the card
        // over, and without it the built page is added displayed while panelX
        // stays resolved — two pages overlapping, with nothing to report it.
        expect(built).toEqual(['a']);
        expect(card.getVisibleComponent()).toBe(panels.get('a'));
        expect(panels.get('a')!.isDisplayed()).toBe(true);
        expect(panelX.isDisplayed()).toBe(false);
    });

    it('registering a keyed factory schedules the pass that builds a pre-selected key (case 28)', () => {
        installTestDOM(CONFIG);

        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        card.setVisibleKey('a');

        const scheduled = vi.spyOn(host, 'scheduleLayout');

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));

        // A claimed factory returns from `addComponent` before `insertComponent`
        // runs, so this registration schedules nothing else — and a second
        // `setVisibleKey('a')` cannot stand in for it, because the same-value
        // early return swallows it. That makes this call the only thing that
        // brings the pass case 11 drives by hand. Spied the way Card.test.ts
        // already pins `setVisibleComponentId`'s own schedule.
        expect(scheduled).toHaveBeenCalled();
        expect(built).toEqual([]);
    });

    it('selecting an already-built key still schedules a layout (case 29)', () => {
        installTestDOM(CONFIG);

        const card   = new Card();
        const host   = hostCard(200, 150, card);
        const built: string[] = [];
        const panels = new Map<string, Component>();

        host.addComponent(recordingFactory('a', built, panels), constraints({ key: 'a' }));
        host.addComponent(recordingFactory('b', built, panels), constraints({ key: 'b' }));

        card.setVisibleKey('a');
        card.setVisibleKey('b');

        const scheduled = vi.spyOn(host, 'scheduleLayout');

        // Both pages are built by now, so no `addComponent` runs and the
        // setter's own call is the only scheduler left to observe. doLayout
        // lays out just the visible child, so a page shown again here was last
        // sized under whatever bounds it had when it was hidden.
        card.setVisibleKey('a');

        expect(panels.get('a')!.isDisplayed()).toBe(true);
        expect(scheduled).toHaveBeenCalled();
    });
});
