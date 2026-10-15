import { vi } from 'vitest';
import { DOM } from '~/core/DOM';

/**
 * Makes `DOM.source.contains` throw, as production's does, when either handle
 * is released. The modelled DOM's `contains` walks its parent table and
 * answers instead. Restore with `vi.restoreAllMocks()`.
 */
export function throwOnReleasedHandle(): void {
    const realContains = DOM.source.contains.bind(DOM.source);

    vi.spyOn(DOM.source, 'contains').mockImplementation((ancestor, node) => {
        const ancestorLive = DOM.source.isRegistered(ancestor);
        const nodeLive     = node === null || DOM.source.isRegistered(node);

        if (!ancestorLive || !nodeLive) {
            throw new Error('DOM handle is not registered');
        }

        return realContains(ancestor, node);
    });
}
