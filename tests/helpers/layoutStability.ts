// Shared offline detector for the silent relayout-loop bug class: a component
// whose doLayout (or a path it reaches) mutates its own subtree and relays a
// preferred-size change back into itself, re-arming the layout flush forever.
import { vi, expect } from 'vitest';

/**
 * Asserts a settled component does not re-dirty itself on a no-op relayout — the
 * offline signature of the silent relayout loop. The caller must have realised
 * the component's element and given it a size first; this settles it via
 * `flushLayout()`, then spies `scheduleLayout`, runs one more `doLayout()`, and
 * asserts the spy never fired. The test DOM's `requestAnimationFrame` only
 * records (never fires), so a real loop is detected as a self-reschedule rather
 * than by letting it spin.
 *
 * @param component - A component already mounted (`getElement(true)`) and sized.
 */
export function expectNoSelfReschedule(component: {
    flushLayout(): unknown;
    doLayout(): unknown;
    scheduleLayout(): unknown;
}): void {
    component.flushLayout();

    const spy = vi.spyOn(component, 'scheduleLayout');

    component.doLayout();

    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
}
