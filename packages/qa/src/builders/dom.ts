// Element lookups for panel targets. Each throws, naming the panel and what it
// looked for, rather than hand a driver a missing element.

import type { HarnessTools } from '../harness/types.js';

/** Which bar inside a `Dock` a gutter lookup wants: across the dock (`dock-h`) or down it (`dock-v`). */
export type DockGutterKind = 'dock-h' | 'dock-v';

/**
 * The first element under `root` that matches `selector`.
 *
 * @param root - Where to look.
 * @param selector - A CSS selector.
 * @param label - Names the panel in the error.
 * @returns The element.
 * @throws Error - `<label>: no element matches <selector>` when none does.
 */
export function requireElement(root: ParentNode, selector: string, label: string): HTMLElement {
    const element = root.querySelector<HTMLElement>(selector);

    if (!element) {
        throw new Error(`${label}: no element matches ${selector}`);
    }

    return element;
}

/**
 * The element of a component.
 *
 * @param tools - The harness tools.
 * @param component - The component.
 * @param label - Names the panel in the error.
 * @returns The component's element.
 * @throws Error - `<label>: no element matches #<id>` when the component has none.
 */
export function elementFor(tools: HarnessTools, component: { getId(): string }, label: string): HTMLElement {
    const element = tools.elementOf(component);

    if (!element) {
        throw new Error(`${label}: no element matches #${component.getId()}`);
    }

    return element;
}

/**
 * The gutter a `Split` or `Accordion` container owns: the first `.SplitGutter`
 * that is a direct child of the container's element, where both managers
 * append their gutters.
 *
 * @param tools - The harness tools.
 * @param container - The container whose layout manager owns the gutter.
 * @param label - Names the panel in the error.
 * @returns The gutter's element.
 * @throws Error - When the container has no element or no such gutter.
 */
export function childGutter(tools: HarnessTools, container: { getId(): string }, label: string): HTMLElement {
    return requireElement(elementFor(tools, container, label), ':scope > .SplitGutter', label);
}

/**
 * A gutter inside a `Dock`, picked by shape as Loom's `pickGutter` does:
 * `dock-v` is the tallest bar that is taller than wide, `dock-h` the first
 * bar, in document order, that is wider than tall.
 *
 * @param dockElement - The dock's element.
 * @param kind - Which bar.
 * @param label - Names the panel in the error.
 * @returns The gutter's element.
 * @throws Error - `<label>: no <kind> gutter` when no bar has that shape.
 */
export function dockGutter(dockElement: Element, kind: DockGutterKind, label: string): HTMLElement {
    const bars = Array.from(dockElement.querySelectorAll<HTMLElement>('.SplitGutter')).map((element) => ({ element, rect: element.getBoundingClientRect() }));
    let pick: HTMLElement | undefined;

    if (kind === 'dock-h') {
        pick = bars.find(({ rect }) => rect.width > rect.height)?.element;
    } else {
        pick = bars.filter(({ rect }) => rect.height > rect.width).sort((a, b) => b.rect.height - a.rect.height)[0]?.element;
    }

    if (!pick) {
        throw new Error(`${label}: no ${kind} gutter`);
    }

    return pick;
}

/**
 * The first element under `root` that matches `selector` and is painted — a
 * hidden tab's editor, say, is skipped.
 *
 * @param tools - The harness tools, for `isPainted`.
 * @param root - Where to look.
 * @param selector - A CSS selector.
 * @param label - Names the panel in the error.
 * @returns The element.
 * @throws Error - `<label>: no painted <selector>` when no match is painted.
 */
export function firstPainted(tools: HarnessTools, root: ParentNode, selector: string, label: string): HTMLElement {
    const element = Array.from(root.querySelectorAll<HTMLElement>(selector)).find((el) => tools.isPainted(el));

    if (!element) {
        throw new Error(`${label}: no painted ${selector}`);
    }

    return element;
}
