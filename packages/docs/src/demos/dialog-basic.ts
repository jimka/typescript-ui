import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
import { Text } from '@jimka/typescript-ui/component/input';
import { Dialog } from '@jimka/typescript-ui/overlay';
import type { DialogResult } from '@jimka/typescript-ui/overlay';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is the open button plus room around the frame for the stage's border;
 * the dialog itself floats above the page via `LayerManager`, outside this
 * frame.
 */
export const height: number = 64;

/**
 * A button that opens a modal `Dialog` with a message and two buttons; the
 * result is echoed in a `Text`.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const resultText = Text('Result: (none yet)');

    // `Dialog.show()` mounts the dialog outside this demo's own component
    // tree (via `LayerManager`, appended to `document.documentElement`), so
    // `DocsContent`'s dispose-then-rebuild on navigation never reaches it.
    // `DialogHost` holds the open instance itself and closes it from its own
    // `destructor()` override, so navigating away mid-dialog still tears it
    // down. See docs-component-demo-set-remaining.md's "A demo can close its
    // own overlay in destructor()" for why this is the one demo module that
    // declares a class.
    class DialogHost extends Panel {
        private _dialog: Dialog | null = null;

        private readonly handleOpen: () => void = () => this.onOpen();

        constructor() {
            super({ layoutManager: HBox() });

            const openButton = Button({
                text:      'Open dialog',
                listeners: { action: this.handleOpen },
            });

            this.addComponent(openButton);
        }

        private onOpen(): void {
            this._dialog = Dialog({
                title:   'Confirm',
                message: 'Proceed with this action?',
                buttons: [
                    { text: 'Cancel',  result: 'cancel'  },
                    { text: 'Confirm', result: 'confirm', primary: true },
                ],
            });

            void this._dialog.show().then((result: DialogResult) => {
                resultText.setText(`Result: ${result}`);
                this._dialog = null;
            });
        }

        protected destructor(): void {
            this._dialog?.hide('close');
            super.destructor();
        }
    }

    const host = new DialogHost();

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [host, resultText],
    });
}
