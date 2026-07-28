import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
import { Glyph } from '@jimka/typescript-ui/component/display';
import { floppy_disk } from '@jimka/typescript-ui/glyphs/solid/floppy_disk';
import { trash } from '@jimka/typescript-ui/glyphs/solid/trash';
import { gear } from '@jimka/typescript-ui/glyphs/solid/gear';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is one row holding a two-line button (title plus description) plus the
 * surrounding frame.
 */
export const height: number = 120;

/**
 * Three buttons: glyph plus title, glyph plus title plus description, and a
 * `showText: false` icon-only button whose title still surfaces on hover.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    Glyph.register(floppy_disk, trash, gear);

    const saveButton = Button({ text: 'Save', glyph: 'floppy-disk' });

    const deleteButton = Button({
        text:        'Delete',
        glyph:       'trash',
        description: 'This action cannot be undone',
    });

    const settingsButton = Button({ glyph: 'gear', text: 'Settings', showText: false });

    return Panel({
        layoutManager: HBox({ spacing: 8 }),
        components:    [saveButton, deleteButton, settingsButton],
    });
}
