import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox, HBox, BoxLayout } from '@jimka/typescript-ui/layout';
import { ScrollStrip } from '@jimka/typescript-ui/component/container';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is the strip's band plus the reveal-button row beneath it.
 */
export const height: number = 120;

/**
 * A horizontal `ScrollStrip` of ten labelled chips; a button scrolls the
 * sixth chip into view.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    // Fixed pixel size of the strip's band. Deliberately narrower than the
    // ten chips laid end to end, so the strip always overflows regardless of
    // the page's own width — a non-stretching row keeps the strip pinned at
    // this size across any window resize.
    const stripWidth = 360;
    const stripHeight = 32;

    const strip = ScrollStrip({
        orientation:   'horizontal',
        scrollable:    false,
        preferredSize: { width: stripWidth, height: stripHeight },
    });

    for (let i = 1; i <= 10; i += 1) {
        strip.addItem(Button({ text: `Chip ${i}` }));
    }

    // ScrollStrip's clip defaults to "equal" mode, which always divides the
    // clip's own (narrow, band-derived) width evenly across every item —
    // exactly TabBar's shrink-to-fit tab sizing, not what a fixed-width chip
    // rail needs. Switching to "preferred" mode plus setOverflowing lets each
    // chip keep its own natural width and the clip's content spill past the
    // band instead of being squeezed, which is what native overflow-hidden
    // scrolling needs to have something to scroll — the same pairing
    // TabBar.applyTabWidths uses for its own scroll-on-overflow strip.
    const contentBox = strip.getContentBox() as BoxLayout;
    contentBox.setMode('preferred');
    contentBox.setOverflowing(true, false);

    // ScrollStrip has no doLayout of its own — the owner sizes the band and
    // asks the strip to lay out its clip. This demo's band is a fixed size
    // (see stripWidth/stripHeight above), so the one-time call below is
    // enough; it never needs to re-run on resize.
    strip.setWidth(stripWidth).setHeight(stripHeight);
    strip.layoutContent(0, 0);
    strip.layoutItems();

    const revealButton = Button({ text: 'Reveal chip 6', listeners: { action: handleReveal } });

    function handleReveal(): void {
        const target = strip.getItems()[5];
        const element = target?.getElement();

        if (element) {
            strip.revealItem(element);
        }
    }

    const revealRow = Panel({
        layoutManager: HBox(),
        components:    [revealButton],
    });

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [strip, revealRow],
    });
}
