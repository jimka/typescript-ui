// Page helpers: waits, paint checks and synthetic mouse events. Ported from
// Loom's qa-harness.ts; nothing here runs at import time.

/**
 * How often `waitFor` re-runs its probe. Loom's value: short enough that a
 * wait ends within a frame or three of its condition turning true, long
 * enough that the polling itself costs nothing measurable.
 */
const WAIT_POLL_MS = 50;

// `MouseEvent.button` and `MouseEvent.buttons` values, fixed by the UI Events
// spec: `button` 0 is the primary button, and `buttons` is a bitmask whose
// bit 0 is the primary button.
const PRIMARY_BUTTON = 0;
const NO_BUTTONS_HELD = 0;
const PRIMARY_BUTTON_HELD = 1;

/**
 * Resolves after `ms` milliseconds.
 *
 * @param ms - How long to wait.
 * @returns A promise that resolves after the delay.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `probe` until it returns a truthy value.
 *
 * @param probe - Returns the awaited value, or a falsy value while not ready.
 * @param timeoutMs - How long to keep polling.
 * @param label - Names what is awaited in the timeout error.
 * @returns The probe's first truthy value.
 * @throws Error - `timeout waiting for <label>` once `timeoutMs` has passed.
 */
export async function waitFor<T>(probe: () => T | null | undefined | false, timeoutMs: number, label: string): Promise<T> {
    const start = performance.now();

    while (performance.now() - start < timeoutMs) {
        const value = probe();

        if (value) {
            return value;
        }

        await sleep(WAIT_POLL_MS);
    }

    throw new Error(`timeout waiting for ${label}`);
}

/**
 * Whether `el` is painted: its box is non-empty and inside the viewport, and
 * neither it nor any ancestor is `visibility: hidden` or `display: none`.
 *
 * @param el - The element to check.
 * @returns `true` when the element is painted.
 */
export function isPainted(el: Element): boolean {
    const rect = el.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
        return false;
    }

    if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) {
        return false;
    }

    let node: Element | null = el;

    while (node) {
        const style = getComputedStyle(node);

        if (style.visibility === 'hidden' || style.display === 'none') {
            return false;
        }

        node = node.parentElement;
    }

    return true;
}

/**
 * Counts the painted elements matching `selector`.
 *
 * @param selector - A CSS selector.
 * @returns How many matches are painted.
 */
export function countPainted(selector: string): number {
    return Array.from(document.querySelectorAll(selector)).filter(isPainted).length;
}

/**
 * Finds the first button whose text or `aria-label` contains `text`.
 *
 * @param text - The text to look for.
 * @returns The matching button element.
 * @throws Error - `no button with text <text>` when nothing matches.
 */
export function findButtonByText(text: string): HTMLElement {
    const all = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
    const hit = all.find((b) => (b.textContent ?? '').includes(text) || (b.getAttribute('aria-label') ?? '').includes(text));

    if (!hit) {
        throw new Error(`no button with text ${text}`);
    }

    return hit;
}

/**
 * Dispatches a bubbling, cancelable `MouseEvent` with the primary button.
 *
 * Without `init.buttons` the event reports the primary button held for every
 * type except `mouseup` (Loom's rule, which a drag needs); a hover passes
 * `{ buttons: 0 }` so a handler does not read its moves as a drag.
 *
 * @param type - The event type, e.g. `mousemove`.
 * @param target - What the event is dispatched on.
 * @param x - The event's `clientX`.
 * @param y - The event's `clientY`.
 * @param init - Optional `buttons` state and `relatedTarget`.
 */
export function fireMouse(type: string, target: EventTarget, x: number, y: number, init: { buttons?: number; relatedTarget?: EventTarget | null } = {}): void {
    const buttons = init.buttons ?? (type === 'mouseup' ? NO_BUTTONS_HELD : PRIMARY_BUTTON_HELD);
    const relatedTarget = init.relatedTarget ?? null;

    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: PRIMARY_BUTTON, buttons, relatedTarget }));
}

/**
 * The element of a component: a component's element id is its component id.
 *
 * @param component - Anything with a component id.
 * @returns The element, or `null` when none carries that id.
 */
export function elementOf(component: { getId(): string }): HTMLElement | null {
    const id = component.getId();

    return id ? document.getElementById(id) : null;
}
