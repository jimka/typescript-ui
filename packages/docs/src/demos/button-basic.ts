import { Panel } from '@jimka/typescript-ui/core';
import type { Component } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';

// One row of default-height buttons, plus room around the frame for the
// stage's border.
export const height: number = 64;

export function create(): Component {
    return Panel({ layoutManager: HBox(), components: [new Button('Save'), new Button('Cancel')] });
}
