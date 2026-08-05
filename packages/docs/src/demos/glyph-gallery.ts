import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox, HFlow } from '@jimka/typescript-ui/layout';
import { Glyph } from '@jimka/typescript-ui/component/display';
import { Button } from '@jimka/typescript-ui/component/button';
import { star } from '@jimka/typescript-ui/glyphs/solid/star';
import { heart } from '@jimka/typescript-ui/glyphs/solid/heart';
import { bell } from '@jimka/typescript-ui/glyphs/solid/bell';
import { house } from '@jimka/typescript-ui/glyphs/solid/house';
import { file } from '@jimka/typescript-ui/glyphs/solid/file';
import { eye } from '@jimka/typescript-ui/glyphs/solid/eye';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is the wrapped glyph row plus the cycle button beneath it.
 */
export const height: number = 120;

/**
 * Six named `Glyph`s in an `HFlow`, plus a button cycling one of them
 * through `spin` / `pulse` / `beat` / no animation.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    // The animation cycle the button steps `cyclingGlyph` through, in order.
    const animationCycle = ['spin', 'pulse', 'beat', 'none'] as const;

    Glyph.register(star, heart, bell, house, file, eye);

    const starGlyph = Glyph('star');
    const heartGlyph = Glyph('heart');
    const bellGlyph = Glyph('bell');
    const houseGlyph = Glyph('house');
    const fileGlyph = Glyph('file');
    const cyclingGlyph = Glyph('eye');

    const gallery = Panel({
        layoutManager: HFlow({ spacing: 12 }),
        components:    [starGlyph, heartGlyph, bellGlyph, houseGlyph, fileGlyph, cyclingGlyph],
    });

    let cycleIndex = 0;

    const cycleButton = Button({ text: 'Cycle animation', listeners: { action: handleCycle } });

    function handleCycle(): void {
        cycleIndex = (cycleIndex + 1) % animationCycle.length;

        const kind = animationCycle[cycleIndex];

        if (kind === 'none') {
            cyclingGlyph.clearAnimated();
        } else {
            cyclingGlyph.setAnimated(kind);
        }
    }

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [gallery, cycleButton],
    });
}
