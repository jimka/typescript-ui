// @vitest-environment jsdom
//
// The seam's same-value style-write filter, exercised through the real
// ProductionDOMSink against a real `document` and the real
// `<style id="Base">` sheet — the pragma and afterEach teardown mirror
// style-rule-index.test.ts. The offline recording sink implements `DOMSink`
// directly and never reaches `writeDeclaration`, so this is the only
// automated cover the filter has.
//
// Pins Expected Behaviour rows 1-10 of
// plans/in-progress/same-value-style-write-filter.md, plus row 11 — the
// shorthand removal the plan's hazard analysis missed (see its
// `## Implementation Notes`).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM, ProductionDOMSink, ProductionDOMSource } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { StyleRule } from '~/core/StyleTarget';

const sink   = (): ProductionDOMSink   => DOM.sink   as ProductionDOMSink;
const source = (): ProductionDOMSource => DOM.source as ProductionDOMSource;

/** A live counter over one accessor, plus the undo that puts the accessor back. */
interface AccessorCounter {
    count:   () => number;
    restore: () => void;
}

/** Installed counters, restored in `afterEach` whether or not a test threw. */
const installed: AccessorCounter[] = [];

/**
 * Counts native assignments to `target[key]`, the camelCase style path.
 *
 * The accessor is not necessarily on `CSSStyleDeclaration.prototype` — under
 * jsdom the CSS longhands live on `CSSStyleProperties.prototype` — so the
 * owner is found by walking the prototype chain from a live declaration
 * rather than assumed. The wrapper counts only assignments whose receiver is
 * `target`, so a count taken on a rule's declaration cannot be inflated by the
 * seam's detached scratch declaration sharing the same prototype.
 *
 * @param target - The declaration whose assignments are counted.
 * @param key - The camelCase property name, e.g. `top` or `cssText`.
 * @returns The live count and the restore that uninstalls the wrapper.
 */
function countSets(target: CSSStyleDeclaration, key: string): AccessorCounter {
    let host: object | null = target;

    while (host && !Object.getOwnPropertyDescriptor(host, key)) {
        host = Object.getPrototypeOf(host) as object | null;
    }

    const descriptor = Object.getOwnPropertyDescriptor(host!, key)!;
    const write      = descriptor.set!;
    let   calls      = 0;

    Object.defineProperty(host!, key, {
        ...descriptor,
        set(this: CSSStyleDeclaration, value: string): void {
            if (this === target) {
                calls += 1;
            }

            write.call(this, value);
        },
    });

    const counter = {
        count:   (): number => calls,
        restore: (): void => {
            Object.defineProperty(host!, key, descriptor);
        },
    };

    installed.push(counter);

    return counter;
}

/** An element interned into the production registry, plus its live declaration. */
function interned(): { handle: Handle; style: CSSStyleDeclaration } {
    const element = document.createElement('div');

    document.body.appendChild(element);

    return { handle: source().intern(element), style: element.style };
}

describe('same-value style write filter', () => {
    afterEach(() => {
        while (installed.length > 0) {
            installed.pop()!.restore();
        }

        vi.restoreAllMocks();
        document.body.replaceChildren();

        const base = document.getElementById('Base');

        if (base) {
            base.remove();
        }

        DOM.reset();
    });

    it('1. an identical camelCase write performs no second native set', () => {
        const { handle, style } = interned();
        const sets = countSets(style, 'top');

        sink().apply(handle, { style: { top: '12px' } });
        sink().apply(handle, { style: { top: '12px' } });

        expect(sets.count()).toBe(1);
        expect(style.top).toBe('12px');
    });

    it('2. a changed camelCase write performs a second native set', () => {
        const { handle, style } = interned();
        const sets = countSets(style, 'top');

        sink().apply(handle, { style: { top: '12px' } });
        sink().apply(handle, { style: { top: '13px' } });

        expect(sets.count()).toBe(2);
        expect(style.top).toBe('13px');
    });

    it('3. null removes a held camelCase property, and a removal is never skipped', () => {
        const { handle, style } = interned();
        const held   = countSets(style, 'top');
        const absent = countSets(style, 'left');

        sink().apply(handle, { style: { top: '12px' } });
        sink().apply(handle, { style: { top: null } });
        sink().apply(handle, { style: { left: null } });

        expect(held.count()).toBe(2);
        expect(style.top).toBe('');

        // An empty read cannot distinguish an absent longhand from a shorthand
        // whose longhands are only partly present (behaviour 11), so the guard
        // covers values only and a removal always reaches the declaration.
        expect(absent.count()).toBe(1);
        expect(style.left).toBe('');
    });

    it('4. a custom property takes the hyphenated path with the same three outcomes', () => {
        const { handle, style } = interned();
        const set    = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
        const remove = vi.spyOn(CSSStyleDeclaration.prototype, 'removeProperty');

        sink().apply(handle, { style: { '--gap': '4px' } });
        sink().apply(handle, { style: { '--gap': '4px' } });

        expect(set).toHaveBeenCalledTimes(1);
        expect(style.getPropertyValue('--gap')).toBe('4px');

        sink().apply(handle, { style: { '--gap': '8px' } });

        expect(set).toHaveBeenCalledTimes(2);
        expect(style.getPropertyValue('--gap')).toBe('8px');

        sink().apply(handle, { style: { '--absent': null } });

        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('5. a standard hyphenated key behaves the same as a custom property', () => {
        const { handle, style } = interned();
        const set    = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
        const remove = vi.spyOn(CSSStyleDeclaration.prototype, 'removeProperty');

        sink().apply(handle, { style: { 'background-color': 'red' } });
        sink().apply(handle, { style: { 'background-color': 'red' } });

        expect(set).toHaveBeenCalledTimes(1);
        expect(style.getPropertyValue('background-color')).toBe('red');

        sink().apply(handle, { style: { 'background-color': 'blue' } });

        expect(set).toHaveBeenCalledTimes(2);
        expect(style.getPropertyValue('background-color')).toBe('blue');

        sink().apply(handle, { style: { 'background-color': null } });

        expect(remove).toHaveBeenCalledTimes(1);
        expect(style.getPropertyValue('background-color')).toBe('');

        sink().apply(handle, { style: { 'border-top-color': null } });

        expect(remove).toHaveBeenCalledTimes(2);
    });

    it('6. the removeAttr style wipe leaves nothing that could skip the replay', () => {
        const { handle, style } = interned();

        sink().apply(handle, { style: { top: '12px' } });
        sink().apply(handle, { removeAttr: ['style'] });

        expect(style.top).toBe('');

        const sets = countSets(style, 'top');

        sink().apply(handle, { style: { top: '12px' } });

        expect(sets.count()).toBe(1);
        expect(style.top).toBe('12px');
    });

    it('7. the comparison reads the live declaration, not a record of its own writes', () => {
        const { style, handle } = interned();

        style.top = '12px';

        const sets = countSets(style, 'top');

        sink().apply(handle, { style: { top: '12px' } });

        expect(sets.count()).toBe(0);
        expect(style.top).toBe('12px');

        sink().apply(handle, { style: { top: '13px' } });

        expect(sets.count()).toBe(1);
        expect(style.top).toBe('13px');
    });

    it('8. a single-key rule flush skips a declaration the rule already carries', () => {
        const rule = sink().ensureStyleRule('#svf-single');

        sink().setRuleStyles(rule, { top: '0px' });

        const sets = countSets(rule.style, 'top');

        sink().setRuleStyles(rule, { top: '0px' });

        expect(sets.count()).toBe(0);
        expect(rule.style.top).toBe('0px');

        sink().setRuleStyles(rule, { top: '4px' });

        expect(sets.count()).toBe(1);
        expect(rule.style.top).toBe('4px');

        sink().setRuleStyles(rule, { top: '0px' });

        expect(sets.count()).toBe(2);
        expect(rule.style.top).toBe('0px');
    });

    it('9. a multi-key rule flush assigns the rule body only when the merge changed it', () => {
        const rule = sink().ensureStyleRule('#svf-merged');

        sink().setRuleStyles(rule, { top: '0px', left: '0px' });

        const bodies = countSets(rule.style, 'cssText');

        sink().setRuleStyles(rule, { top: '0px', left: '0px' });

        expect(bodies.count()).toBe(0);
        expect(rule.style.top).toBe('0px');
        expect(rule.style.left).toBe('0px');

        sink().setRuleStyles(rule, { top: '4px', left: '0px' });

        expect(bodies.count()).toBe(1);
        expect(rule.style.top).toBe('4px');
        expect(rule.style.left).toBe('0px');
    });

    it('10. two StyleRule instances over one selector dedup against the shared rule', () => {
        const first  = new StyleRule({ scope: 'selector', name: '#svf-shared' });
        const second = new StyleRule({ scope: 'selector', name: '#svf-shared' });
        const rule   = first.ensure();

        expect(second.ensure()).toBe(rule);

        first.set('top', '7px');

        const sets = countSets(rule.style, 'top');

        second.set('top', '7px');

        expect(sets.count()).toBe(0);
        expect(rule.style.top).toBe('7px');

        first.dispose();
        second.dispose();
    });

    it('11. an empty read never authorises a skip, in either spelling of a removal', () => {
        const { handle, style } = interned();

        sink().apply(handle, { style: { backgroundColor: 'red' } });

        // The ambiguity the guard must not fall into: a shorthand serialises to
        // the empty string while one of its longhands is set, so a guard reading
        // "empty means absent" would skip every clear below.
        expect(style.background).toBe('');

        sink().apply(handle, { style: { background: null } });

        expect(style.getPropertyValue('background-color')).toBe('');

        // `""` is the other spelling of the same removal, and it reaches the
        // seam: `STYLE_WRITERS.background` forwards it verbatim, because `??`
        // only catches `null`.
        sink().apply(handle, { style: { backgroundColor: 'red' } });
        sink().apply(handle, { style: { background: '' } });

        expect(style.getPropertyValue('background-color')).toBe('');

        // Same rule on the hyphenated path, where CSSOM defines
        // `setProperty(key, "")` as a removal.
        const set = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');

        sink().apply(handle, { style: { '--absent': '' } });

        expect(set).toHaveBeenCalledTimes(1);

        const rule = sink().ensureStyleRule('#svf-shorthand');

        sink().setRuleStyles(rule, { backgroundColor: 'red' });

        expect(rule.style.background).toBe('');

        sink().setRuleStyles(rule, { background: '' });

        expect(rule.style.getPropertyValue('background-color')).toBe('');
    });
});
