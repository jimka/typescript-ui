// @vitest-environment jsdom
//
// PROTOTYPE proof. Exercises the handle seam against real jsdom elements to
// show the three properties the investigation flagged as the unknowns:
// canonicalization, strong/weak lifecycle, and the one-resolve batched write.
import { describe, it, expect } from 'vitest';
import { HandleRegistry, HandleSink } from '~/core/HandleSeam.prototype';

describe('HandleRegistry — canonicalization', () => {
    it('maps a node to the same handle every time, so handle === mirrors node ===', () => {
        const reg = new HandleRegistry();
        const a   = document.createElement('div');
        const b   = document.createElement('div');

        const ha1 = reg.intern(a);
        const ha2 = reg.intern(a);
        const hb  = reg.intern(b);

        expect(ha1).toBe(ha2);        // same node -> same handle
        expect(ha1).not.toBe(hb);     // different node -> different handle
    });

    it('retain and intern agree on the canonical handle for one node', () => {
        const reg = new HandleRegistry();
        const el  = document.createElement('span');

        // Whether the node was first seen as owned or browser-supplied, equality holds.
        expect(reg.retain(el)).toBe(reg.intern(el));
    });

    it('round-trips a handle back to its exact node', () => {
        const reg = new HandleRegistry();
        const el  = document.createElement('p');

        expect(reg.resolve(reg.retain(el))).toBe(el);
    });
});

describe('HandleRegistry — lifecycle', () => {
    it('keeps a retained (owned) handle resolvable while the framework holds only the handle', () => {
        const reg = new HandleRegistry();
        // Create, retain, and deliberately keep no other reference to the element:
        // a detached clipFrame held only by its handle must still resolve.
        const handle = reg.retain(document.createElement('div'));

        expect(() => reg.resolve(handle)).not.toThrow();
        expect(reg.size).toBe(1);
    });

    it('release drops both directions and turns later resolves into a loud failure', () => {
        const reg = new HandleRegistry();
        const el  = document.createElement('div');
        const h   = reg.retain(el);

        reg.release(h);

        expect(reg.size).toBe(0);
        expect(() => reg.resolve(h)).toThrow(/not registered/);
        // Re-interning the same node after release mints a FRESH handle (the old
        // one is gone), proving release cleared the reverse map too.
        expect(reg.intern(el)).not.toBe(h);
    });

    it('release is idempotent', () => {
        const reg = new HandleRegistry();
        const h   = reg.retain(document.createElement('div'));

        reg.release(h);
        expect(() => reg.release(h)).not.toThrow();
    });

    it('resolving a never-minted handle throws rather than silently no-opping', () => {
        const reg = new HandleRegistry();

        expect(() => reg.resolve(999 as never)).toThrow(/not registered/);
    });
});

describe('HandleSink — batched multi-write', () => {
    it('applies width + height + two classes + an attribute with ONE handle resolve', () => {
        const reg  = new HandleRegistry();
        const sink = new HandleSink(reg);
        const h    = sink.createElement('div');

        const before = reg.resolveCount;

        sink.apply(h, {
            style:    { width: '120px', height: '40px', '--ts-accent': 'red' },
            addClass: ['Panel', 'active'],
            setAttr:  { role: 'group' },
        });

        // Five logical mutations, exactly one resolve.
        expect(reg.resolveCount - before).toBe(1);

        const el = reg.resolve(h) as HTMLElement;   // (+1 resolve, for the assertion)

        expect(el.style.width).toBe('120px');
        expect(el.style.height).toBe('40px');
        expect(el.style.getPropertyValue('--ts-accent')).toBe('red');
        expect(el.classList.contains('Panel')).toBe(true);
        expect(el.classList.contains('active')).toBe(true);
        expect(el.getAttribute('role')).toBe('group');
    });

    it('the equivalent imperative sequence would cost one resolve PER write', () => {
        const reg  = new HandleRegistry();
        const sink = new HandleSink(reg);
        const h    = sink.createElement('div');

        // Simulate the un-batched path: five separate apply() calls.
        const before = reg.resolveCount;

        sink.apply(h, { style: { width:  '120px' } });
        sink.apply(h, { style: { height: '40px' } });
        sink.apply(h, { addClass: ['Panel'] });
        sink.apply(h, { addClass: ['active'] });
        sink.apply(h, { setAttr:  { role: 'group' } });

        expect(reg.resolveCount - before).toBe(5);   // contrast: batched did it in 1
    });

    it('removals apply before additions (toggle off+on lands on)', () => {
        const reg  = new HandleRegistry();
        const sink = new HandleSink(reg);
        const h    = sink.createElement('div');

        sink.apply(h, { addClass: ['x'] });
        sink.apply(h, { removeClass: ['x'], addClass: ['x'] });

        expect((reg.resolve(h) as HTMLElement).classList.contains('x')).toBe(true);
    });

    it('fluent edit() compiles to a single batched apply', () => {
        const reg  = new HandleRegistry();
        const sink = new HandleSink(reg);
        const h    = sink.createElement('div');

        const before = reg.resolveCount;

        sink.edit(h)
            .style('width', '10px')
            .addClass('a')
            .attr('data-k', 'v')
            .text('hi')
            .commit();

        expect(reg.resolveCount - before).toBe(1);

        const el = reg.resolve(h) as HTMLElement;

        expect(el.style.width).toBe('10px');
        expect(el.classList.contains('a')).toBe(true);
        expect(el.getAttribute('data-k')).toBe('v');
        expect(el.textContent).toBe('hi');
    });
});

describe('HandleSink — cross-element op cost', () => {
    it('appendChild costs two resolves (irreducible — one per element)', () => {
        const reg    = new HandleRegistry();
        const sink   = new HandleSink(reg);
        const parent = sink.createElement('div');
        const child  = sink.createElement('span');

        const before = reg.resolveCount;

        sink.appendChild(parent, child);

        expect(reg.resolveCount - before).toBe(2);
        expect((reg.resolve(parent) as HTMLElement).firstElementChild).toBe(reg.resolve(child));
    });
});
