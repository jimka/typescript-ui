import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { _DiagramNode as DiagramNode } from '~/component/diagram/DiagramNode';
import { _IconText as IconText } from '~/component/display/IconText';
import { Glyph } from '~/component/display/Glyph';
import { xmark } from '~/glyphs/solid/xmark';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => {
    installTestDOM(CONFIG);
    Glyph.register(xmark);
});

afterEach(() => {
    DOM.reset();
});

describe('DiagramNode — hover cursor', () => {
    it('shows a pointer cursor on the node and frees its content from pointer events', () => {
        // A bare-label node (no glyph) wraps a single Text. Every Component
        // stamps its own `cursor` (defaulting to `default`), so without the
        // pointer-events opt-out the label would override the node's pointer
        // wherever it sits under the cursor.
        const node = new DiagramNode({ label: 'users' }) as any;

        expect(node.getCursor()).toBe('pointer');
        expect(node._content.getPointerEvents()).toBe('none');
    });

    it('frees the glyph+text content of a glyphed node from pointer events', () => {
        // With a glyph the content is an IconText (Glyph + Text). Setting
        // pointer-events on the IconText is enough: `pointer-events: none`
        // inherits, so the nested glyph and text are covered by the one call.
        const node = new DiagramNode({ glyph: 'xmark', label: 'users' }) as any;

        expect(node._content).toBeInstanceOf(IconText);
        expect(node._content.getPointerEvents()).toBe('none');
    });
});
