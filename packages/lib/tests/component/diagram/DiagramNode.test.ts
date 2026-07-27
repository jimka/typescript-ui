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

describe('DiagramNode — badge', () => {
    it('has no badge and keeps the bare Text as _content when none is given', () => {
        const node = new DiagramNode({ label: 'users' }) as any;

        expect(node.getBadge()).toBeNull();
        expect(node._content).toBe(node._label);
    });

    it('wraps the label and badge in a pointer-transparent row when a badge is given', () => {
        const node = new DiagramNode({ label: 'users', badge: '+3→' }) as any;

        expect(node.getBadge()).toBe('+3→');
        expect(node._content).not.toBe(node._label);
        expect(node._content.getPointerEvents()).toBe('none');
        expect(node._badge.getText()).toBe('+3→');
    });

    it('reports a wider preferred width for a badged node than the same node unbadged', () => {
        const plain  = new DiagramNode({ label: 'users' }) as any;
        const badged = new DiagramNode({ label: 'users', badge: '+3→' }) as any;

        expect(badged.getPreferredSize().width).toBeGreaterThan(plain.getPreferredSize().width);
    });

    it('setLabel updates the label and leaves the badge unchanged', () => {
        const node = new DiagramNode({ label: 'users', badge: '+3→' }) as any;

        node.setLabel('orders');

        expect(node.getLabel()).toBe('orders');
        expect(node.getBadge()).toBe('+3→');
    });

    it('treats an empty-string badge as a badge, not as "none"', () => {
        const node = new DiagramNode({ label: 'users', badge: '' }) as any;

        expect(node.getBadge()).toBe('');
        expect(node._content).not.toBe(node._label);
    });
});
