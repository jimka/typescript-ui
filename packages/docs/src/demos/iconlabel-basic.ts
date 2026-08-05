import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { IconLabel, Glyph } from '@jimka/typescript-ui/component/display';
import { TextField } from '@jimka/typescript-ui/component/input';
import { envelope } from '@jimka/typescript-ui/glyphs/solid/envelope';
import { lock } from '@jimka/typescript-ui/glyphs/solid/lock';
import { user } from '@jimka/typescript-ui/glyphs/solid/user';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one row of `IconLabel`s and their associated fields plus room around
 * the frame for the stage's border.
 */
export const height: number = 64;

/**
 * Three `IconLabel`s, each pairing a glyph with a form-control label for a
 * `TextField`; clicking a label focuses its field.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    Glyph.register(envelope, lock, user);

    const nameField = TextField();
    const emailField = TextField();
    const passwordField = TextField();

    const nameLabel = IconLabel('user', 'Name:', nameField.getId());
    const emailLabel = IconLabel('envelope', 'Email:', emailField.getId());
    const passwordLabel = IconLabel('lock', 'Password:', passwordField.getId());

    return Panel({
        layoutManager: HBox({ spacing: 8 }),
        components:    [nameLabel, nameField, emailLabel, emailField, passwordLabel, passwordField],
    });
}
