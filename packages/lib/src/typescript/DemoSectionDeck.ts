// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Container } from '@jimka/typescript-ui/core';
import type { ContainerOptions } from '@jimka/typescript-ui/core';
import { Card } from '@jimka/typescript-ui/layout';
import type { DemoSection } from "./demoSections.js";

/**
 * The demo app's content pane: a `Card` deck holding one unbuilt page per
 * section, each keyed by its slug so a URL segment selects it directly.
 *
 * `Container` rather than `Panel`: every demo panel configures its own
 * `autoScroll`, so the pane itself must not add a second scroll host.
 *
 * @remarks A class rather than a `Container({ layoutManager: Card() })` built
 * inline in `main.ts` because the two rules below are demo-app mistakes no
 * library test can catch, and a class is the only seam a unit test can reach —
 * `main.ts` is a top-level-`await` module that mounts the `Body` and pulls in
 * all 32 panels, so a test cannot import it.
 */
class DemoSectionDeck extends Container {

    private readonly _card: Card;

    /**
     * Registers every section as an unbuilt keyed page on an internal `Card`.
     *
     * @param sections - The sections to register, in any order; the deck shows
     *   one at a time and never reads the order.
     * @param options - Caller-supplied container options.
     */
    constructor(sections: readonly DemoSection[], options?: ContainerOptions) {
        super(options, { layoutManager: new Card() });

        // Resolving the manager is also what attaches it: a subclass-default
        // layout manager is attached lazily, on its first `getLayoutManager()`.
        // So this line is what gives the card a container to schedule against,
        // before the loop below offers it the first factory.
        this._card = this.getLayoutManager() as Card;

        // The `key` is what makes each factory deferrable: Card declines a
        // keyless factory, and Component.addComponent would then build all 32
        // panels here. The key is the slug, so `show` can pass a URL segment
        // straight through.
        for (const section of sections) {
            this.addComponent(section.factory, { key: section.slug });
        }
    }

    /**
     * Shows `slug`'s panel. `Card` builds that panel on the first call for the
     * slug and reuses it afterwards.
     *
     * @param slug - The section's URL segment, as registered.
     * @returns `true` when `slug` names a registered section, `false` (having
     *   left the card untouched) when it does not.
     */
    show(slug: string): boolean {
        // Asked before told: an unregistered key is Card's fall-back-to-first-
        // child path, so a mistyped URL segment would silently open the wrong
        // panel rather than being reported back to the router.
        if (!this._card.hasKey(slug)) {
            return false;
        }

        this._card.setVisibleKey(slug);

        return true;
    }
}

const DemoSectionDeckCallable = callable(DemoSectionDeck);
type DemoSectionDeckCallable = DemoSectionDeck;
export {
    DemoSectionDeck         as _DemoSectionDeck,
    DemoSectionDeckCallable as DemoSectionDeck,
};
