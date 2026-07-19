import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { _DiagramGroupNode as DiagramGroupNode } from '~/component/diagram/DiagramGroupNode';
import { _Text as Text } from '~/component/input/Text';
import { _IconText as IconText } from '~/component/display/IconText';
import { Glyph } from '~/component/display/Glyph';
import { folder } from '~/glyphs/solid/folder';
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
    Glyph.register(folder);
});

afterEach(() => {
    DOM.reset();
});

describe('DiagramGroupNode — a titled, translucent compound container box', () => {
    it('shows its label header and starts with no explicit background clip that would hide children', () => {
        const node = new DiagramGroupNode({ label: 'public' }) as any;

        expect(node._header).toBeInstanceOf(Text);
        expect(node._header.getText()).toBe('public');
        expect(node.getLabel()).toBe('public');
    });

    it('renders a glyph + label header (IconText) when a glyph is given', () => {
        const node = new DiagramGroupNode({ label: 'public', glyph: 'folder' }) as any;

        expect(node._header).toBeInstanceOf(IconText);
        expect(node._header.getTextComponent().getText()).toBe('public');
        expect(node.getLabel()).toBe('public');
    });

    it('setLabel updates the header text and getLabel', () => {
        const node = new DiagramGroupNode({ label: 'public' });

        node.setLabel('reporting');

        expect(node.getLabel()).toBe('reporting');
    });

    it('setLabel updates a glyphed (IconText) header too', () => {
        const node = new DiagramGroupNode({ label: 'public', glyph: 'folder' }) as any;

        node.setLabel('reporting');

        expect(node._header.getTextComponent().getText()).toBe('reporting');
        expect(node.getLabel()).toBe('reporting');
    });

    it('defaults to an empty header when no label is given', () => {
        const node = new DiagramGroupNode() as any;

        expect(node._header.getText()).toBe('');
        expect(node.getLabel()).toBeNull();
    });
});
