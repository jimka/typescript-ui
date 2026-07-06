import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Markdown } from '~/component/display/Markdown';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Container } from '~/core/Container';
import { Fit } from '~/layout/Fit';
import { ThemeManager, DarkTheme, ModernTheme } from '~/core/Theme';
import { installTestDOM, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => { sink = installTestDOM(CONFIG); });
afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

/** The tags passed to every `createElement`, in creation order. */
function createdTags(): string[] {
    return sink.writes
        .filter((w) => w.op === 'createElement')
        .map((w) => w.args[0] as string);
}

/** Every `{ text }` payload written through `apply`, in order. */
function textWrites(): string[] {
    return sink.writes
        .filter((w) => w.op === 'apply' && (w.args[1] as { text?: string }).text !== undefined)
        .map((w) => (w.args[1] as { text: string }).text);
}

/** Every `{ setAttr }` payload written through `apply`. */
function attrWrites(): Record<string, string>[] {
    return sink.writes
        .filter((w) => w.op === 'apply' && (w.args[1] as { setAttr?: object }).setAttr !== undefined)
        .map((w) => (w.args[1] as { setAttr: Record<string, string> }).setAttr);
}

/** The uppercase tag names of children appended to any element with `parentTag`. */
function childTagsOf(parentTag: string): string[] {
    return sink.writes
        .filter((w) => w.op === 'appendChild')
        .map((w) => [
            DOM.source.getTagName(w.args[0] as Handle),
            DOM.source.getTagName(w.args[1] as Handle),
        ])
        .filter(([parent]) => parent === parentTag.toUpperCase())
        .map(([, child]) => child);
}

describe('Markdown headings', () => {
    it('builds <h1>..<h6> from # .. ###### with the heading text', () => {
        for (let depth = 1; depth <= 6; depth += 1) {
            sink = installTestDOM(CONFIG);

            const hashes = '#'.repeat(depth);

            new Markdown(`${hashes} Title${depth}`).getElement(true);

            expect(createdTags()).toContain(`h${depth}`);
            expect(textWrites()).toContain(`Title${depth}`);
        }
    });
});

describe('Markdown paragraph', () => {
    it('builds a <p> whose text is the paragraph content', () => {
        new Markdown('hello world').getElement(true);

        expect(createdTags()).toContain('p');
        expect(textWrites()).toContain('hello world');
    });
});

describe('Markdown emphasis', () => {
    it('builds <strong> for **bold** with the text inside it', () => {
        new Markdown('**b**').getElement(true);

        expect(createdTags()).toContain('strong');
        expect(childTagsOf('p')).toContain('STRONG');
        expect(textWrites()).toContain('b');
    });
    it('builds <em> for *italic* with the text inside it', () => {
        new Markdown('*i*').getElement(true);

        expect(createdTags()).toContain('em');
        expect(childTagsOf('p')).toContain('EM');
        expect(textWrites()).toContain('i');
    });
});

describe('Markdown inline code', () => {
    it('builds a <code> with the codespan text', () => {
        new Markdown('`x`').getElement(true);

        expect(createdTags()).toContain('code');
        expect(childTagsOf('p')).toContain('CODE');
        expect(textWrites()).toContain('x');
    });
});

describe('Markdown fenced code block', () => {
    it('builds <pre> > <code> preserving the literal code with newlines', () => {
        new Markdown('```js\nconst a = 1;\nconst b = 2;\n```').getElement(true);

        expect(createdTags()).toContain('pre');
        expect(childTagsOf('pre')).toContain('CODE');
        expect(textWrites()).toContain('const a = 1;\nconst b = 2;');
    });
});

describe('Markdown links', () => {
    it('builds <a> with href/target/rel and inner text', () => {
        new Markdown('[t](https://e.com)').getElement(true);

        expect(createdTags()).toContain('a');
        expect(childTagsOf('p')).toContain('A');
        expect(textWrites()).toContain('t');

        const linkAttr = attrWrites().find((a) => a.href === 'https://e.com');

        expect(linkAttr).toBeDefined();
        expect(linkAttr!.target).toBe('_blank');
        expect(linkAttr!.rel).toBe('noopener noreferrer');
    });
});

describe('Markdown unordered list', () => {
    it('builds <ul> with two <li> children carrying the item text', () => {
        new Markdown('- a\n- b').getElement(true);

        expect(createdTags()).toContain('ul');
        expect(childTagsOf('ul')).toEqual(['LI', 'LI']);
        expect(textWrites()).toContain('a');
        expect(textWrites()).toContain('b');
    });
});

describe('Markdown ordered list', () => {
    it('builds <ol> with two <li> children', () => {
        new Markdown('1. a\n2. b').getElement(true);

        expect(createdTags()).toContain('ol');
        expect(childTagsOf('ol')).toEqual(['LI', 'LI']);
    });
});

describe('Markdown blockquote', () => {
    it('builds a <blockquote> containing the quoted content', () => {
        new Markdown('> quote').getElement(true);

        expect(createdTags()).toContain('blockquote');
        expect(textWrites()).toContain('quote');
    });
});

describe('Markdown nested inline in a heading', () => {
    it('nests <strong> inside the <h2> for ## **bold** head', () => {
        new Markdown('## **bold** head').getElement(true);

        expect(createdTags()).toContain('h2');
        expect(childTagsOf('h2')).toContain('STRONG');
        expect(textWrites()).toContain('bold');
    });
});

describe('Markdown fallback for unsupported tokens', () => {
    it('renders a table as text without creating <table>', () => {
        const table = '| a | b |\n| - | - |\n| 1 | 2 |';

        expect(() => new Markdown(table).getElement(true)).not.toThrow();
        expect(createdTags()).not.toContain('table');
        expect(createdTags()).not.toContain('td');
    });
    it('renders an image as text without creating <img>', () => {
        expect(() => new Markdown('![alt](x.png)').getElement(true)).not.toThrow();
        expect(createdTags()).not.toContain('img');
    });
});

describe('Markdown empty source', () => {
    it('renders a root with no prose children for an empty string', () => {
        new Markdown('').getElement(true);

        expect(childTagsOf('div')).toEqual([]);
    });
    it('renders a root with no prose children for whitespace-only source', () => {
        new Markdown('   ').getElement(true);

        expect(childTagsOf('div')).toEqual([]);
    });
});

describe('Markdown getMarkdown', () => {
    it('returns "" when unset', () => {
        expect(new Markdown().getMarkdown()).toBe('');
    });
    it('returns the constructor value', () => {
        expect(new Markdown('# A').getMarkdown()).toBe('# A');
    });
    it('returns the setMarkdown value', () => {
        const md = new Markdown('# A');

        md.setMarkdown('# B');

        expect(md.getMarkdown()).toBe('# B');
    });
});

describe('Markdown setMarkdown rebuild', () => {
    it('removes the old nodes and rebuilds when the element exists', () => {
        const md = new Markdown('# A');

        md.getElement(true);

        const removesBefore = sink.writes.filter((w) => w.op === 'removeElement').length;

        md.setMarkdown('# B');

        const removesAfter = sink.writes.filter((w) => w.op === 'removeElement').length;

        // The rebuild detached the first render's nodes before building again.
        expect(removesAfter).toBeGreaterThan(removesBefore);
        expect(textWrites()).toContain('B');

        // A removeElement write precedes the second heading's text write.
        const firstRebuildRemove = sink.writes.findIndex((w, i) =>
            w.op === 'removeElement' && i >= sink.writes.findIndex((x) => x.op === 'removeElement'));
        const bTextWrite = sink.writes.findIndex((w) =>
            w.op === 'apply' && (w.args[1] as { text?: string }).text === 'B');

        expect(firstRebuildRemove).toBeLessThan(bTextWrite);
    });
});

describe('Markdown construction parity', () => {
    it('produces the same tree from positional and options-bag construction', () => {
        new Markdown('# A').getElement(true);
        const positional = createdTags();

        sink = installTestDOM(CONFIG);
        new Markdown(undefined, { markdown: '# A' }).getElement(true);
        const bag = createdTags();

        expect(bag).toEqual(positional);
    });
    it('works through the callable form Markdown("# A")', () => {
        expect(() => Markdown('# A').getElement(true)).not.toThrow();
        expect(createdTags()).toContain('h1');
    });
});

// The modelled source reports scrollHeight === clientHeight (no real overflow),
// so real flowed-text height cannot be produced offline. These tests inject the
// content height by stubbing the seam read, exercising the size-negotiation fold
// and its invalidation wiring against the real seam — the browser's block-flow
// computation itself is covered by the manual-verify step in the plan.
function stubScrollHeight(height: number) {
    return vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
        scrollTop: 0, scrollLeft: 0,
        scrollWidth: 0, scrollHeight: height,
        clientWidth: 0, clientHeight: height,
    });
}

describe('Markdown prose wrapping', () => {
    it('sets white-space:normal so prose flows and wraps instead of inheriting the nowrap default', () => {
        const md = new Markdown('hello world');

        expect(md.getWhiteSpace()).toBe('normal');
    });
});

describe('Markdown content-height measurement', () => {
    it('folds the measured content height into getMinSize (height axis only)', () => {
        stubScrollHeight(500);
        const md = new Markdown('# A');
        md.getElement(true);

        md.setWidth(300);   // width change → measure at the assigned width

        expect(md.getMinSize()!.height).toBe(500);
        expect(md.getMinSize()!.width).toBe(0);   // width stays freely assignable
    });

    it('reports the measured height through getPreferredSize', () => {
        stubScrollHeight(420);
        const md = new Markdown('# A');
        md.getElement(true);

        md.setWidth(300);

        expect(md.getPreferredSize()!.height).toBe(420);
    });

    it('lets an explicit preferredSize win over the measured height', () => {
        stubScrollHeight(500);
        const md = new Markdown('# A', { preferredSize: { width: 300, height: 999 } });
        md.getElement(true);

        md.setWidth(300);

        expect(md.getPreferredSize()!.height).toBe(999);
    });

    it('keeps an explicit setMinSize floor when it exceeds the measured height', () => {
        stubScrollHeight(500);
        const md = new Markdown('# A');
        md.getElement(true);
        md.setMinSize(0, 900);

        md.setWidth(300);

        expect(md.getMinSize()!.height).toBe(900);   // Math.max(900, 500)
    });

    it('reports no spurious height for empty source (measured 0)', () => {
        stubScrollHeight(0);
        const md = new Markdown('');
        md.getElement(true);

        md.setWidth(300);

        expect(md.getMinSize()?.height ?? 0).toBe(0);
    });

    it('re-measures a taller height when the content grows', () => {
        const spy = stubScrollHeight(200);
        const md = new Markdown('# A');
        md.getElement(true);
        md.setWidth(300);
        expect(md.getMinSize()!.height).toBe(200);

        spy.mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 0, scrollHeight: 600,
            clientWidth: 0, clientHeight: 600,
        });
        md.setMarkdown('# A\n\nmore prose');   // content change → re-measure

        expect(md.getMinSize()!.height).toBe(600);
    });

    it('does not re-layout when a re-measure reads the same height', () => {
        stubScrollHeight(300);
        const md = new Markdown('# A');
        md.getElement(true);
        md.setWidth(300);

        const spy = vi.spyOn(md, 'scheduleLayout');
        md.setMarkdown('# A');   // unchanged stubbed height → no re-layout

        expect(spy).not.toHaveBeenCalled();
    });

    it('re-measures on theme change', () => {
        const spy = stubScrollHeight(300);
        const md = new Markdown('# A');
        md.getElement(true);
        md.setWidth(300);
        expect(md.getMinSize()!.height).toBe(300);

        spy.mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 0, scrollHeight: 700,
            clientWidth: 0, clientHeight: 700,
        });
        try {
            ThemeManager.setTheme(DarkTheme);
            expect(md.getMinSize()!.height).toBe(700);
        } finally {
            ThemeManager.setTheme(ModernTheme);   // restore the default for later tests
        }
    });

    it('dispose() detaches the theme listener so a later theme change does not re-measure', () => {
        const spy = stubScrollHeight(300);
        const md = new Markdown('# A');
        md.getElement(true);
        md.setWidth(300);
        expect(md.getMinSize()!.height).toBe(300);

        md.dispose();

        spy.mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 0, scrollHeight: 700,
            clientWidth: 0, clientHeight: 700,
        });
        try {
            ThemeManager.setTheme(DarkTheme);
            expect(md.getMinSize()!.height).toBe(300);   // unchanged: listener detached
        } finally {
            ThemeManager.setTheme(ModernTheme);
        }
    });

    it('grows a Fit scroll host past its inner height to the measured content height', () => {
        stubScrollHeight(500);
        const host = new Container({ layoutManager: new Fit() });
        host.getElement(true);
        host.setWidth(300);
        host.setHeight(100);
        host.clearInsets();

        const md = new Markdown('# A');
        host.addComponent(md);
        host.getLayoutManager().setOverflowing(false, true);

        host.doLayout();   // pass 1: seeds the measure (child laid to inner height)
        host.doLayout();   // pass 2: inflates to the measured content height

        expect(md.getHeight()).toBeGreaterThanOrEqual(500);
        expect(md.getHeight()).toBeGreaterThan(host.getInnerSize()!.height);
    });
});
