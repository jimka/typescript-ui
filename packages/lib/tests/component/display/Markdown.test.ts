import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Markdown, mapFenceLangToEditorId, extractMarkdownHeadings, findActiveHeading } from '~/component/display/Markdown';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { Event } from '~/core/Event';
import { Fit } from '~/layout/Fit';
import { ThemeManager, DarkTheme, ModernTheme } from '~/core/Theme';
import { installTestDOM, setScrollExtent, type RecordingDOMSink } from '../../dom/TestDOM';
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

/** Every `{ addClass }` payload written through `apply`, in order. */
function classWrites(): string[][] {
    return sink.writes
        .filter((w) => w.op === 'apply' && (w.args[1] as { addClass?: string[] }).addClass !== undefined)
        .map((w) => (w.args[1] as { addClass: string[] }).addClass);
}

/** The most recently `setRuleStyles`-written value for `prop`, or `undefined` if never written. */
function lastRuleStyle(prop: string): string | null | undefined {
    const writes = sink.writes.filter((w) => w.op === 'setRuleStyles') as
        Array<{ op: string; args: [string, Record<string, string | null>] }>;

    for (let i = writes.length - 1; i >= 0; i--) {
        const styles = writes[i].args[1];

        if (prop in styles) {
            return styles[prop];
        }
    }

    return undefined;
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

describe('Markdown heading ids', () => {
    it('emits a slugified id on the heading element', () => {
        new Markdown('## Some Heading').getElement(true);

        const headingAttr = attrWrites().find((a) => a.id !== undefined);

        expect(headingAttr).toBeDefined();
        expect(headingAttr!.id).toBe('some-heading');
    });

    it('dedupes identical heading text within one render with a "-N" suffix', () => {
        new Markdown('## Dup\n\n## Dup').getElement(true);

        const ids = attrWrites().map((a) => a.id).filter((id) => id !== undefined);

        expect(ids).toEqual(['dup', 'dup-1']);
    });

    it('collapses punctuation-heavy heading text with no leading, trailing, or doubled hyphens', () => {
        new Markdown('### setX() / getX()').getElement(true);

        const headingAttr = attrWrites().find((a) => a.id !== undefined);

        expect(headingAttr!.id).toBe('setx-getx');
    });

    it('re-renders the same id on a second setMarkdown call with the same single-heading source', () => {
        const md = new Markdown('## Repeat');

        md.getElement(true);
        const firstId = attrWrites().find((a) => a.id !== undefined)!.id;

        md.setMarkdown('## Repeat');
        const secondId = attrWrites().filter((a) => a.id !== undefined).pop()!.id;

        expect(secondId).toBe(firstId);
        expect(secondId).toBe('repeat');
    });
});

describe('extractMarkdownHeadings', () => {
    it('extracts top-level headings in document order with their depth', () => {
        expect(extractMarkdownHeadings('# A\n\n## B\n')).toEqual([
            { id: 'a', text: 'A', depth: 1 },
            { id: 'b', text: 'B', depth: 2 },
        ]);
    });

    it('dedupes identical heading text with a "-N" suffix, matching Markdown\'s own dedupe rule', () => {
        const headings = extractMarkdownHeadings('## Overview\n\n## Overview\n');

        expect(headings.map((h) => h.id)).toEqual(['overview', 'overview-1']);
    });

    // marked's own ATX-heading tokenizer only recognizes 1-6 leading `#`s
    // (CommonMark spec); a 7th makes the whole line a paragraph, not a
    // "heading" token with depth 7 — so this exercises the same "not a
    // heading" outcome appendHeading's DOM render produces for this input,
    // rather than the depth-clamp branch (which no realistic Markdown source
    // can trigger, since marked never emits a heading token outside [1, 6]).
    it('does not treat a 7-hash line as a heading, matching appendHeading\'s DOM render', () => {
        expect(extractMarkdownHeadings('####### Too Deep\n')).toEqual([]);
    });

    it('finds a heading nested inside a blockquote', () => {
        expect(extractMarkdownHeadings('> ## Quoted Heading\n')).toEqual([
            { id: 'quoted-heading', text: 'Quoted Heading', depth: 2 },
        ]);
    });

    it('finds a heading nested inside a loose list item', () => {
        expect(extractMarkdownHeadings('- item\n\n  ## Nested Heading\n')).toEqual([
            { id: 'nested-heading', text: 'Nested Heading', depth: 2 },
        ]);
    });

    it('strips inline markup from the displayed text but keeps it in the slug input', () => {
        // The link's URL segment ("text") only survives into the slug if the
        // id is built from the raw `heading.text` — it never appears in the
        // displayed text, so a fixture without a link (where stripping
        // markup happens to leave the slug unchanged either way) couldn't
        // catch nextHeadingId being fed the wrong string.
        expect(extractMarkdownHeadings('### `setX()` and [bold](/text)\n')).toEqual([
            { id: 'setx-and-bold-text', text: 'setX() and bold', depth: 3 },
        ]);
    });

    it('returns an empty array for source with no headings', () => {
        expect(extractMarkdownHeadings('')).toEqual([]);
        expect(extractMarkdownHeadings('Just prose.\n')).toEqual([]);
    });

    it('produces the same id as the corresponding rendered <h1>-<h6> element', () => {
        // A link in the heading, repeated to also exercise dedupe: its
        // rendered text ("Guide") and raw source ("[Guide](/setup)") slugify
        // to different strings ("guide" vs "guide-setup"), so this fails if
        // extractMarkdownHeadings and appendHeading ever stop feeding
        // nextHeadingId the same one of the two.
        const source = '## [Guide](/setup)\n\n## [Guide](/setup)\n';

        new Markdown(source).getElement(true);

        const renderedIds = attrWrites().map((a) => a.id).filter((id) => id !== undefined);
        const extractedIds = extractMarkdownHeadings(source).map((h) => h.id);

        expect(extractedIds).toEqual(['guide-setup', 'guide-setup-1']);
        expect(extractedIds).toEqual(renderedIds);
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

describe('Markdown strikethrough', () => {
    it('builds <del> for ~~struck~~ with the text inside it', () => {
        new Markdown('~~s~~').getElement(true);

        expect(createdTags()).toContain('del');
        expect(childTagsOf('p')).toContain('DEL');
        expect(textWrites()).toContain('s');
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

    it('renders a plain <pre> with no code-host wrapper for an unmapped language', () => {
        new Markdown('```python\nprint(1)\n```').getElement(true);

        expect(createdTags()).toContain('pre');
        expect(childTagsOf('pre')).toContain('CODE');
        expect(classWrites()).not.toContainEqual(['ts-ui-md-code-host']);
    });

    it('renders a plain <pre> with no code-host wrapper when the fence has no info string', () => {
        new Markdown('```\nplain\n```').getElement(true);

        expect(createdTags()).toContain('pre');
        expect(classWrites()).not.toContainEqual(['ts-ui-md-code-host']);
    });

    it('wraps a supported-language fenced block in a ts-ui-md-code-host wrapper', () => {
        new Markdown('```js\nconst a = 1;\n```').getElement(true);

        expect(classWrites()).toContainEqual(['ts-ui-md-code-host']);
    });
});

describe('Markdown fenced code block — CodeEditor upgrade wiring', () => {
    // `onFirstLayout` (Component's per-instance "mounted and sized" hook, with
    // its own dedicated coverage in OnFirstLayout.test.ts) drains through a
    // module-level, rAF-coalesced flush queue shared across every component in
    // the process — a queue this shared test file's *other* describe blocks
    // already prime via ordinary construction, so a locally-mocked
    // `requestAnimationFrame` can no longer observe it being (re-)scheduled.
    // These tests sidestep that entirely: they assert Markdown registers the
    // deferred hook (not a synchronous call), then invoke the captured
    // callback directly — the same effect a real layout flush would have,
    // without depending on that shared, hard-to-isolate queue.

    it('defers the CodeEditor swap via onFirstLayout rather than calling the loader synchronously', () => {
        const onFirstLayoutSpy = vi.spyOn(Markdown.prototype as any, 'onFirstLayout');
        const loadSpy = vi.spyOn(Markdown.prototype as any, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());

        new Markdown('```js\nconst a = 1;\n```').getElement(true);

        expect(onFirstLayoutSpy).toHaveBeenCalled();
        expect(loadSpy).not.toHaveBeenCalled();
    });

    it('the deferred callback invokes loadCodeEditorUpgrade with the fenced block\'s text and mapped language', () => {
        const onFirstLayoutSpy = vi.spyOn(Markdown.prototype as any, 'onFirstLayout');
        const loadSpy = vi.spyOn(Markdown.prototype as any, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());

        new Markdown('```js\nconst a = 1;\n```').getElement(true);

        // The constructor's own onFirstLayout(measureContentHeight) call
        // registers first; appendCode's registration is the last call.
        const callback = onFirstLayoutSpy.mock.calls.at(-1)![0] as () => void;
        callback();

        expect(loadSpy).toHaveBeenCalledTimes(1);
        expect(loadSpy.mock.calls[0]![3]).toBe('const a = 1;');
        expect(loadSpy.mock.calls[0]![4]).toBe('javascript');
    });

    it('a displayed:false Markdown never calls the loader, even if its deferred callback is invoked', () => {
        const onFirstLayoutSpy = vi.spyOn(Markdown.prototype as any, 'onFirstLayout');
        const loadSpy = vi.spyOn(Markdown.prototype as any, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());

        const md = new Markdown('```typescript\nconst a: number = 1;\n```', { displayed: false });
        md.getElement(true);

        expect(loadSpy).not.toHaveBeenCalled();

        // Explicitly invoke the deferred callback (mirroring what Component's
        // own "already connected" fast path would do on the next flush, since
        // that path fires unconditionally with no displayed-gating — see
        // Component.ts's onFirstLayout/afterNextLayout). Must still not call
        // the loader: appendCode's kickoff routes through startCodeEditorImport,
        // which re-checks isEffectivelyVisible() itself rather than trusting
        // onFirstLayout alone for this case.
        const callback = onFirstLayoutSpy.mock.calls.at(-1)![0] as () => void;
        callback();

        expect(loadSpy).not.toHaveBeenCalled();
    });

    it('a kickoff invoked while hidden queues instead of starting the import, and onEffectiveVisibilityChange flushes it — not a per-frame poll', () => {
        const onFirstLayoutSpy = vi.spyOn(Markdown.prototype as any, 'onFirstLayout');
        const loadSpy = vi.spyOn(Markdown.prototype as any, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());

        const md = new Markdown('```js\nconst a = 1;\n```', { displayed: false });
        md.getElement(true);
        const anyMd = md as any;

        const kickoff = onFirstLayoutSpy.mock.calls.at(-1)![0] as () => void;
        const onFirstLayoutCallsBefore = onFirstLayoutSpy.mock.calls.length;

        kickoff();   // fires while hidden: must queue, not call the loader

        expect(loadSpy).not.toHaveBeenCalled();
        expect(anyMd._awaitingVisibilityKickoffs).toHaveLength(1);
        // No self-re-registration through onFirstLayout — the edge-triggered
        // onEffectiveVisibilityChange hook is what flushes the queue later,
        // not a per-frame re-arm (which would poll forever while hidden).
        expect(onFirstLayoutSpy.mock.calls.length).toBe(onFirstLayoutCallsBefore);

        // Drives the real edge-triggered propagation (Component.setDisplayed
        // -> propagateEffectiveVisibility -> onEffectiveVisibilityChange),
        // flushed synchronously via the same escape hatch the framework
        // documents for tests (the offline sink drops real rAF callbacks).
        md.setDisplayed(true);
        Component.flushEffectiveVisibility();

        expect(loadSpy).toHaveBeenCalledTimes(1);
        expect(anyMd._awaitingVisibilityKickoffs).toHaveLength(0);
    });

    it('onEffectiveVisibilityChange(false) does not flush a queued kickoff (guard clause, called directly)', () => {
        const md = new Markdown('hello', { displayed: false });
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);

        anyMd._awaitingVisibilityKickoffs.push({
            wrapper, pre, code, text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration,
        });

        const loadSpy = vi.spyOn(Markdown.prototype as any, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());
        anyMd.onEffectiveVisibilityChange(false);

        expect(loadSpy).not.toHaveBeenCalled();
        expect(anyMd._awaitingVisibilityKickoffs).toHaveLength(1);
    });

    it('becoming effectively visible schedules a viewport pass for an entry already queued in _awaitingViewportKickoffs', () => {
        const md = new Markdown('hello', { displayed: false });
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);

        anyMd._awaitingViewportKickoffs.push({
            wrapper, pre, code, text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration,
        });

        const scheduleSpy = vi.spyOn(Markdown.prototype as any, 'scheduleViewportPass');

        // Drives the real edge-triggered propagation (Component.setDisplayed
        // -> propagateEffectiveVisibility -> onEffectiveVisibilityChange),
        // mirroring the visibility-kickoff test above.
        md.setDisplayed(true);
        Component.flushEffectiveVisibility();

        expect(scheduleSpy).toHaveBeenCalled();
    });

    it('onEffectiveVisibilityChange(false) does not schedule a viewport pass (guard clause, called directly)', () => {
        const md = new Markdown('hello', { displayed: false });
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);

        anyMd._awaitingViewportKickoffs.push({
            wrapper, pre, code, text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration,
        });

        const scheduleSpy = vi.spyOn(Markdown.prototype as any, 'scheduleViewportPass');
        anyMd.onEffectiveVisibilityChange(false);

        expect(scheduleSpy).not.toHaveBeenCalled();
    });

    it('upgrades to a live CodeEditor once the deferred callback runs, replacing the placeholder', async () => {
        const onFirstLayoutSpy = vi.spyOn(Markdown.prototype as any, 'onFirstLayout');
        // No mockImplementation: calls through to the real (async) loader, so
        // its recorded return value is the real dynamic-import promise —
        // genuinely transforming/loading CodeMirror's module graph through
        // Vite's test runner, not a same-tick microtask, so the test awaits
        // that specific promise rather than guessing a fixed tick count.
        const loadSpy = vi.spyOn(Markdown.prototype as any, 'loadCodeEditorUpgrade');

        const md = new Markdown('```js\nconst a = 1;\n```');
        md.getElement(true);

        const callback = onFirstLayoutSpy.mock.calls.at(-1)![0] as () => void;
        callback();

        await loadSpy.mock.results[0]!.value;

        const anyMd = md as any;
        expect(anyMd._codeEditors).toHaveLength(1);
        expect(anyMd._codeEditors[0].editor.getLanguage()).toBe('javascript');
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

    it('renders no target/rel and the resolved href when a linkResolver marks the link non-external', () => {
        new Markdown('[t](/guide/)', {
            linkResolver: () => ({ href: '#/guide/', external: false }),
        }).getElement(true);

        const linkAttr = attrWrites().find((a) => a.href === '#/guide/');

        expect(linkAttr).toBeDefined();
        expect(linkAttr!.target).toBeUndefined();
        expect(linkAttr!.rel).toBeUndefined();
    });
});

describe('Markdown linkResolver accessors', () => {
    it('getLinkResolver returns the default resolver (not null) on a freshly constructed Markdown', () => {
        expect(new Markdown().getLinkResolver()).not.toBeNull();
    });

    it('setLinkResolver/getLinkResolver round-trip a custom resolver', () => {
        const md = new Markdown();
        const resolver = (href: string) => ({ href, external: false });

        md.setLinkResolver(resolver);

        expect(md.getLinkResolver()).toBe(resolver);
    });
});

describe('Markdown setMaxMeasure / getMaxMeasure', () => {
    it('defaults to null, writing the theme-var maxWidth', () => {
        new Markdown('x').getElement(true);

        expect(new Markdown().getMaxMeasure()).toBeNull();
        expect(lastRuleStyle('maxWidth')).toBe('var(--ts-ui-md-max-measure, 70ch)');
    });

    it('normalises a bare number to a "ch" string and writes it as the maxWidth rule', () => {
        const md = new Markdown('x', { maxMeasure: 60 });

        md.getElement(true);

        expect(md.getMaxMeasure()).toBe(60);
        expect(lastRuleStyle('maxWidth')).toBe('60ch');
    });

    it('accepts a raw CSS width string', () => {
        const md = new Markdown('x');

        md.getElement(true);
        md.setMaxMeasure('80%');

        expect(md.getMaxMeasure()).toBe('80%');
        expect(lastRuleStyle('maxWidth')).toBe('80%');
    });

    it('setMaxMeasure(null) reverts to the theme-var default, not a resolved literal', () => {
        const md = new Markdown('x', { maxMeasure: 60 });

        md.getElement(true);
        md.setMaxMeasure(null);

        expect(md.getMaxMeasure()).toBeNull();
        expect(lastRuleStyle('maxWidth')).toBe('var(--ts-ui-md-max-measure, 70ch)');
    });
});

describe('Markdown setFontScale / getFontScale', () => {
    it('defaults to 1, writing a cleared (null) fontSize rather than "100%"', () => {
        new Markdown('x').getElement(true);

        expect(new Markdown().getFontScale()).toBe(1);
        expect(lastRuleStyle('fontSize')).toBeNull();
    });

    it('writes a percentage fontSize for a non-1 scale', () => {
        const md = new Markdown('x', { fontScale: 1.3 });

        md.getElement(true);

        expect(md.getFontScale()).toBe(1.3);
        expect(lastRuleStyle('fontSize')).toBe('130%');
    });

    it('setFontScale(1) clears the inline override by writing null, not "100%"', () => {
        const md = new Markdown('x', { fontScale: 1.3 });

        md.getElement(true);
        md.setFontScale(1);

        expect(md.getFontScale()).toBe(1);
        expect(lastRuleStyle('fontSize')).toBeNull();
    });
});

describe('findActiveHeading', () => {
    /** Builds a Markdown with three headings and stages their document-order rects at `tops`. */
    function stageHeadings(tops: [number, number, number]) {
        const md = new Markdown('# Introduction\n\n## Getting Started\n\n### Install\n');
        const handle = md.getElement(true)!;

        DOM.sink.apply(handle, { style: { left: '0px', top: '0px', width: '400px', height: '2000px' } });

        const headings = extractMarkdownHeadings(md.getMarkdown());

        headings.forEach((heading, i) => {
            const headingHandle = DOM.source.getElementById(heading.id)!;

            DOM.sink.apply(headingHandle, { style: { left: '0px', top: `${tops[i]}px`, width: '10px', height: '10px' } });
        });

        return { handle, headings };
    }

    it('returns the last heading whose top is at or above the pane\'s own top, per the worked example', () => {
        const { handle, headings } = stageHeadings([100, 600, 900]);

        DOM.sink.apply(handle, { scrollTop: 500 });
        expect(findActiveHeading(handle, headings)).toBe(headings[0].id);

        DOM.sink.apply(handle, { scrollTop: 650 });
        expect(findActiveHeading(handle, headings)).toBe(headings[1].id);

        DOM.sink.apply(handle, { scrollTop: 950 });
        expect(findActiveHeading(handle, headings)).toBe(headings[2].id);
    });

    it('returns null when the pane top is above every heading', () => {
        const { handle, headings } = stageHeadings([100, 600, 900]);

        DOM.sink.apply(handle, { scrollTop: 0 });

        expect(findActiveHeading(handle, headings)).toBeNull();
    });

    it('treats a heading a fraction of a pixel past the pane\'s top as still active, absorbing native scrollTop rounding', () => {
        const { handle, headings } = stageHeadings([100, 600, 900]);

        // Lands the second heading's viewport top at +0.4px — just past the
        // pane's own top, the way a scroll-to-heading landing a hair short of
        // exact alignment would. A strict `<=` comparison would reject this
        // heading and fall back to the first one instead.
        DOM.sink.apply(handle, { scrollTop: 599.6 });

        expect(findActiveHeading(handle, headings)).toBe(headings[1].id);
    });

    it('treats the last heading as active once the pane has scrolled to its maximum, even when that heading cannot reach the pane\'s own top (not enough content left below it)', () => {
        const { handle, headings } = stageHeadings([100, 600, 900]);

        // clientHeight is 2000 (staged by stageHeadings); a scroll extent of
        // 2850 caps the max scroll at 850, leaving the third heading's
        // viewport top at 900 - 850 = 50px — still below the pane's top, the
        // way a heading near the document's end can never reach it (there
        // isn't a full viewport's worth of content left below it to scroll
        // into place). The strict top-crossing rule alone would resolve to
        // the second heading instead.
        setScrollExtent(handle, { width: 400, height: 2850 });
        DOM.sink.apply(handle, { scrollTop: 850 });

        expect(findActiveHeading(handle, headings)).toBe(headings[2].id);
    });

    it('treats the first not-yet-reached heading as active once at max scroll, even when a later heading is also clustered past the fold', () => {
        const { handle, headings } = stageHeadings([100, 600, 900]);

        // A scroll extent of 2300 caps the max scroll at 300, leaving both
        // the second heading (600 - 300 = 300px) and the third (900 - 300 =
        // 600px) below the pane's top — clicking either lands the exact same
        // clamped scrollTop, so the first of the two that hasn't been reached
        // yet (the second heading) is the one the click actually targeted,
        // not whichever heading is last in the document.
        setScrollExtent(handle, { width: 400, height: 2300 });
        DOM.sink.apply(handle, { scrollTop: 300 });

        expect(findActiveHeading(handle, headings)).toBe(headings[1].id);
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
    it('renders an image as text without creating <img>', () => {
        expect(() => new Markdown('![alt](x.png)').getElement(true)).not.toThrow();
        expect(createdTags()).not.toContain('img');
    });
});

describe('Markdown table', () => {
    const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |';

    it('builds a wrapper div, table, thead, tbody, two tr, two th, and two td', () => {
        new Markdown(TABLE).getElement(true);

        expect(createdTags()).toContain('div');
        expect(createdTags()).toContain('table');
        expect(createdTags()).toContain('thead');
        expect(createdTags()).toContain('tbody');
        expect(createdTags().filter((t) => t === 'tr')).toHaveLength(2);
        expect(createdTags().filter((t) => t === 'th')).toHaveLength(2);
        expect(createdTags().filter((t) => t === 'td')).toHaveLength(2);
    });

    it('nests thead/tbody each with one tr', () => {
        new Markdown(TABLE).getElement(true);

        expect(childTagsOf('thead')).toEqual(['TR']);
        expect(childTagsOf('tbody')).toEqual(['TR']);
    });

    it('the header row holds two th then the body row holds two td, flattened across both rows', () => {
        new Markdown(TABLE).getElement(true);

        expect(childTagsOf('tr')).toEqual(['TH', 'TH', 'TD', 'TD']);
    });

    it('writes the cell texts a, b, 1, 2', () => {
        new Markdown(TABLE).getElement(true);

        const texts = textWrites();

        expect(texts).toContain('a');
        expect(texts).toContain('b');
        expect(texts).toContain('1');
        expect(texts).toContain('2');
    });

    it('nests <strong> inside a <th> for a bold header cell', () => {
        new Markdown('| **b** | c |\n| --- | --- |\n| 1 | 2 |').getElement(true);

        expect(childTagsOf('th')).toContain('STRONG');
    });

    it('applies the alignment classes from the delimiter row to header and body cells alike', () => {
        new Markdown('| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |').getElement(true);

        const classes = classWrites();

        expect(classes.filter((c) => c.includes('ts-ui-md-align-left'))).toHaveLength(2);
        expect(classes.filter((c) => c.includes('ts-ui-md-align-center'))).toHaveLength(2);
        expect(classes.filter((c) => c.includes('ts-ui-md-align-right'))).toHaveLength(2);
    });

    it('applies no alignment class for an unaligned delimiter row', () => {
        new Markdown(TABLE).getElement(true);

        const classes = classWrites();

        expect(classes.some((c) => c.some((name) => name.startsWith('ts-ui-md-align-')))).toBe(false);
    });

    it('resolves an escaped pipe in a cell to the literal text before rendering', () => {
        new Markdown('| a | b |\n| --- | --- |\n| `x \\| y` | 2 |').getElement(true);

        expect(textWrites()).toContain('x | y');
    });

    it('renders the same structure when leading and trailing pipes are omitted', () => {
        new Markdown('a | b\n--- | ---\n1 | 2').getElement(true);

        expect(createdTags()).toContain('table');
        expect(createdTags()).toContain('thead');
        expect(createdTags()).toContain('tbody');
    });

    it('creates no table element for two pipe rows with no delimiter row', () => {
        new Markdown('| a | b |\n| 1 | 2 |').getElement(true);

        expect(createdTags()).not.toContain('table');
    });

    it('creates no table element when the delimiter row is narrower than the header', () => {
        new Markdown('| a | b |\n| --- |\n| 1 | 2 |').getElement(true);

        expect(createdTags()).not.toContain('table');
    });

    it('gives an empty header or body cell a <br> so its row does not collapse shorter than a text-bearing row', () => {
        new Markdown('|  |  |\n| --- | --- |\n|  |  |').getElement(true);

        expect(childTagsOf('th')).toEqual(['BR', 'BR']);
        expect(childTagsOf('td')).toEqual(['BR', 'BR']);
    });

    it('does not add a <br> to a cell that has text', () => {
        new Markdown(TABLE).getElement(true);

        expect(childTagsOf('th')).not.toContain('BR');
        expect(childTagsOf('td')).not.toContain('BR');
    });

    it('splits a cell\'s escaped paragraph break (two adjacent Lexical paragraphs from one Enter) into one <br>, not a blank line', () => {
        // '\\n\\n' here is the literal four-character sequence — two escaped
        // newlines — that markdownTableTransformer.ts's escapeCellText always
        // writes for one paragraph-to-paragraph boundary, since
        // $convertToMarkdownString joins a cell's Lexical paragraphs (one
        // plain Enter in the editor makes two) with a raw two-newline
        // separator, not one. Splitting on a lone single-newline escape
        // instead double-counts every boundary into a blank line the WYSIWYG
        // editor itself never shows (its cell paragraphs render flush,
        // margin: 0).
        new Markdown('| line1\\n\\nline2 | b |\n| --- | --- |\n| 1 | 2 |').getElement(true);

        expect(childTagsOf('th').filter((tag) => tag === 'BR')).toHaveLength(1);

        const texts = textWrites();

        expect(texts).toContain('line1');
        expect(texts).toContain('line2');
        expect(texts.some((t) => t.includes('\\n'))).toBe(false);
    });

    it('splits every paragraph-break pair in a cell with more than one boundary, one <br> per boundary', () => {
        new Markdown('| a\\n\\nb\\n\\nc | d |\n| --- | --- |\n| 1 | 2 |').getElement(true);

        expect(childTagsOf('th').filter((tag) => tag === 'BR')).toHaveLength(2);
    });

    it('renders a genuinely empty paragraph between two cell paragraphs as two <br> (a real blank line)', () => {
        // Three Lexical paragraphs "a", "", "b" (Enter, Enter) export as two
        // back-to-back paragraph-join separators with nothing between them —
        // four raw newlines, escaped to four consecutive tokens — which must
        // still read as a blank line, unlike the flush two-paragraph case above.
        new Markdown('| a\\n\\n\\n\\nb | c |\n| --- | --- |\n| 1 | 2 |').getElement(true);

        expect(childTagsOf('th').filter((tag) => tag === 'BR')).toHaveLength(2);
    });

    it('does not split an escaped newline outside a table cell', () => {
        new Markdown('a\\nb').getElement(true);

        expect(createdTags()).not.toContain('br');
        expect(textWrites()).toContain('a\\nb');
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
//
// Manual-verify only (offline-inexpressible): `measureContentHeight` collapses
// the box to `height:auto` before reading `scrollHeight`, because `scrollHeight`
// is floored at `clientHeight` — without the collapse a document that reflows
// wider or is edited shorter could only ever *grow*, never shrink. The stub
// returns a fixed height regardless of that collapse, so shrink-on-widen cannot
// be pinned here; verified live in-browser (narrow→wide reflow shrank the
// measured height 434→402px, and the panel scroll extent tracked it).
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
        md.setMinSize({ width: 0, height: 900 });

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

describe('mapFenceLangToEditorId', () => {
    const rows: Array<[string, string]> = [
        ['js', 'javascript'], ['javascript', 'javascript'], ['jsx', 'javascript'],
        ['mjs', 'javascript'], ['cjs', 'javascript'],
        ['ts', 'javascript'], ['typescript', 'javascript'], ['tsx', 'javascript'],
        ['json', 'json'],
        ['html', 'html'], ['htm', 'html'],
        ['sql', 'sql'],
        ['md', 'markdown'], ['markdown', 'markdown'],
    ];

    it.each(rows)('maps fence lang %s to editor id %s', (lang, id) => {
        expect(mapFenceLangToEditorId(lang)).toBe(id);
    });

    it('is case-insensitive', () => {
        expect(mapFenceLangToEditorId('JS')).toBe('javascript');
        expect(mapFenceLangToEditorId('TypeScript')).toBe('javascript');
    });

    it('takes only the first whitespace-delimited word (shebang-style modifiers)', () => {
        expect(mapFenceLangToEditorId('js {1,3}')).toBe('javascript');
    });

    it('returns null for an unrecognised language', () => {
        expect(mapFenceLangToEditorId('python')).toBeNull();
        expect(mapFenceLangToEditorId('rust')).toBeNull();
        expect(mapFenceLangToEditorId('typo')).toBeNull();
    });

    it('returns null for undefined or empty input', () => {
        expect(mapFenceLangToEditorId(undefined)).toBeNull();
        expect(mapFenceLangToEditorId('')).toBeNull();
    });
});

/** A structurally-CodeEditor-shaped stand-in: no CodeMirror, no dynamic import. */
class FakeCodeEditor {
    readonly value: string;
    readonly language: string;
    readonly autoHeightMaxRows: number | undefined;
    private readonly _el: Handle;
    disposed = false;
    heightChangeListener: ((payload: { height: number }) => void) | null = null;

    constructor(value: string, options: { readOnly: true; language: string; autoHeightMaxRows?: number }) {
        this.value = value;
        this.language = options.language;
        this.autoHeightMaxRows = options.autoHeightMaxRows;
        this._el = DOM.sink.createElement('div');
    }

    setX(): this { return this; }
    setY(): this { return this; }
    setWidth(): this { return this; }
    setHeight(): this { return this; }
    getElement(_force?: boolean): Handle { return this._el; }
    dispose(): void { this.disposed = true; }

    on(event: string, listener: (payload: { height: number }) => void): this {
        if (event === 'heightchange') {
            this.heightChangeListener = listener;
        }

        return this;
    }
}

describe('Markdown.applyCodeEditorUpgrade (private, called directly)', () => {
    it('replaces the placeholder pre/code with a live CodeEditor', () => {
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 0, scrollHeight: 240,
            clientWidth: 500, clientHeight: 240,
        });

        const md = new Markdown('hello');
        md.getElement(true);

        const anyMd = md as any;
        const wrapper = anyMd.create('div');
        const pre     = anyMd.create('pre');
        const code    = anyMd.create('code');
        DOM.sink.appendChild(pre, code);
        DOM.sink.appendChild(wrapper, pre);

        expect(anyMd._contentHandles).toContain(pre);
        expect(anyMd._contentHandles).toContain(code);

        anyMd.applyCodeEditorUpgrade(FakeCodeEditor, wrapper, pre, code, 'const a = 1;', 'javascript');

        expect(anyMd._contentHandles).not.toContain(pre);
        expect(anyMd._contentHandles).not.toContain(code);
        expect(anyMd._codeEditors).toHaveLength(1);
        expect(anyMd._codeEditors[0].editor).toBeInstanceOf(FakeCodeEditor);
        expect(anyMd._codeEditors[0].editor.value).toBe('const a = 1;');
        expect(anyMd._codeEditors[0].editor.language).toBe('javascript');
        expect(anyMd._codeEditors[0].wrapper).toBe(wrapper);
    });

    it('wires a heightchange listener that resizes the wrapper and re-measures', () => {
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 0, scrollHeight: 240,
            clientWidth: 500, clientHeight: 240,
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const md = new Markdown('hello');
        md.getElement(true);

        const anyMd = md as any;
        const scheduleMeasureSpy = vi.spyOn(anyMd, 'scheduleContentMeasure');
        const wrapper = anyMd.create('div');
        const pre     = anyMd.create('pre');
        const code    = anyMd.create('code');
        DOM.sink.appendChild(pre, code);
        DOM.sink.appendChild(wrapper, pre);

        anyMd.applyCodeEditorUpgrade(FakeCodeEditor, wrapper, pre, code, 'const a = 1;', 'javascript');

        const editor: FakeCodeEditor = anyMd._codeEditors[0].editor;

        expect(editor.heightChangeListener).not.toBeNull();
        expect(editor.autoHeightMaxRows).toBe(20); // Markdown.ts's CODE_BLOCK_MAX_AUTO_ROWS

        scheduleMeasureSpy.mockClear();
        editor.heightChangeListener!({ height: 360 });

        const heightWrite = sink.writes.find(
            (w) => w.op === 'apply' && w.args[0] === wrapper
                && (w.args[1] as { style?: { height?: string } }).style?.height === '360px',
        );

        expect(heightWrite).toBeDefined();
        expect(scheduleMeasureSpy).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });

    it('does not warn when the first heightchange payload is within 8px of the guess', () => {
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 0, scrollHeight: 240,
            clientWidth: 500, clientHeight: 240,
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);

        anyMd.applyCodeEditorUpgrade(FakeCodeEditor, wrapper, pre, code, 'const a = 1;', 'javascript');
        const editor: FakeCodeEditor = anyMd._codeEditors[0].editor;

        editor.heightChangeListener!({ height: 245 }); // 5px delta, under the 8px threshold

        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('warns once with the language id and both heights when the correction exceeds 8px', () => {
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 0, scrollHeight: 240,
            clientWidth: 500, clientHeight: 240,
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);

        anyMd.applyCodeEditorUpgrade(FakeCodeEditor, wrapper, pre, code, 'const a = 1;', 'javascript');
        const editor: FakeCodeEditor = anyMd._codeEditors[0].editor;

        editor.heightChangeListener!({ height: 360 }); // 120px delta

        expect(warnSpy).toHaveBeenCalledOnce();
        const message = warnSpy.mock.calls[0][0] as string;
        expect(message).toContain('javascript');
        expect(message).toContain('240');
        expect(message).toContain('360');
        warnSpy.mockRestore();
    });

    it('never warns more than once per editor, regardless of later heightchange deltas', () => {
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 0, scrollHeight: 240,
            clientWidth: 500, clientHeight: 240,
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);

        anyMd.applyCodeEditorUpgrade(FakeCodeEditor, wrapper, pre, code, 'const a = 1;', 'javascript');
        const editor: FakeCodeEditor = anyMd._codeEditors[0].editor;

        editor.heightChangeListener!({ height: 360 }); // 120px delta — warns
        editor.heightChangeListener!({ height: 500 }); // another large delta — must not warn again

        expect(warnSpy).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });
});

/** Builds a wrapper/pre/code trio tracked on `md`, mirroring `appendCode`'s shape. */
function buildCodeHostTrio(md: Markdown): { wrapper: Handle; pre: Handle; code: Handle } {
    const anyMd = md as any;
    const wrapper = anyMd.create('div');
    const pre     = anyMd.create('pre');
    const code    = anyMd.create('code');
    DOM.sink.appendChild(pre, code);
    DOM.sink.appendChild(wrapper, pre);
    return { wrapper, pre, code };
}

describe('Markdown.flushPendingCodeUpgrades (private, called directly)', () => {
    it('leaves a pending upgrade in place while not effectively visible', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);

        anyMd._pendingCodeUpgrades.push({
            CodeEditorClass: FakeCodeEditor, wrapper, pre, code,
            text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration,
        });

        vi.spyOn(md, 'isEffectivelyVisible').mockReturnValue(false);
        anyMd.flushPendingCodeUpgrades();

        expect(anyMd._pendingCodeUpgrades).toHaveLength(1);
        expect(anyMd._codeEditors).toHaveLength(0);
    });

    it('applies a pending upgrade once effectively visible', () => {
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 0, scrollHeight: 240,
            clientWidth: 500, clientHeight: 240,
        });

        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);

        anyMd._pendingCodeUpgrades.push({
            CodeEditorClass: FakeCodeEditor, wrapper, pre, code,
            text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration,
        });

        vi.spyOn(md, 'isEffectivelyVisible').mockReturnValue(true);
        anyMd.flushPendingCodeUpgrades();

        expect(anyMd._pendingCodeUpgrades).toHaveLength(0);
        expect(anyMd._codeEditors).toHaveLength(1);
    });
});

describe('Markdown.resyncCodeEditorWidths (private, called directly)', () => {
    it('re-syncs an already-applied editor width from its wrapper clientWidth', () => {
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 0, scrollHeight: 240,
            clientWidth: 640, clientHeight: 240,
        });

        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper } = buildCodeHostTrio(md);
        const editor = new FakeCodeEditor('x', { readOnly: true, language: 'javascript' });
        const setWidthSpy = vi.spyOn(editor, 'setWidth');
        anyMd._codeEditors.push({ editor, wrapper });

        anyMd.resyncCodeEditorWidths();

        expect(setWidthSpy).toHaveBeenCalledWith(640);
    });

    it('does not resync an already-applied editor width while not effectively visible', () => {
        // A hidden subtree's clientWidth reads 0 in a real browser; writing
        // that through would collapse a previously-applied editor with
        // nothing to correct it later, since a re-show with no accompanying
        // width change never re-triggers measureContentHeight.
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 0, scrollHeight: 0,
            clientWidth: 0, clientHeight: 0,
        });

        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper } = buildCodeHostTrio(md);
        const editor = new FakeCodeEditor('x', { readOnly: true, language: 'javascript' });
        const setWidthSpy = vi.spyOn(editor, 'setWidth');
        anyMd._codeEditors.push({ editor, wrapper });

        vi.spyOn(md, 'isEffectivelyVisible').mockReturnValue(false);
        anyMd.resyncCodeEditorWidths();

        expect(setWidthSpy).not.toHaveBeenCalled();
    });

    it('applies measureContentHeight() without calling setWidth on a live editor', () => {
        // Pins the split: the width resync used to run unconditionally as part
        // of measureContentHeight before this method existed; now a bare
        // measureContentHeight() must not touch editor widths at all.
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 240, scrollHeight: 240,
            clientWidth: 640, clientHeight: 240,
        });

        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper } = buildCodeHostTrio(md);
        const editor = new FakeCodeEditor('x', { readOnly: true, language: 'javascript' });
        const setWidthSpy = vi.spyOn(editor, 'setWidth');
        anyMd._codeEditors.push({ editor, wrapper });

        anyMd.measureContentHeight();

        expect(setWidthSpy).not.toHaveBeenCalled();
    });
});

describe('Markdown.resyncCodeEditorWidths — commitBounds width-flush ordering', () => {
    it('flushes a pending width write before resyncCodeEditorWidths reads wrapper geometry', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper } = buildCodeHostTrio(md);
        const editor = new FakeCodeEditor('x', { readOnly: true, language: 'javascript' });
        anyMd._codeEditors.push({ editor, wrapper });

        const scrollMetricsWriteCounts: number[] = [];
        vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => {
            scrollMetricsWriteCounts.push(sink.writes.length);
            return {
                scrollTop: 0, scrollLeft: 0, scrollWidth: 0,
                scrollHeight: 240, clientWidth: 640, clientHeight: 240,
            };
        });

        // Mirrors LayoutManager.commitBounds: Markdown.setWidth calls
        // resyncCodeEditorWidths synchronously from inside this window.
        md.setAutoCommitStyle(false);
        md.setWidth(300);
        md.setAutoCommitStyle(true);

        const widthWriteIndex = sink.writes.findIndex(
            (w) => w.op === 'apply' && w.args[0] === md.getElement()
                && (w.args[1] as { style?: { width?: string } }).style?.width === '300px',
        );

        expect(widthWriteIndex).toBeGreaterThanOrEqual(0);
        expect(scrollMetricsWriteCounts.length).toBeGreaterThan(0);
        expect(scrollMetricsWriteCounts[0]).toBeGreaterThan(widthWriteIndex);
    });
});

describe('Markdown.loadCodeEditorUpgrade (private, called directly)', () => {
    it('is a no-op when the render generation has advanced since queuing', async () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);
        const staleGeneration = anyMd._renderGeneration;

        anyMd._renderGeneration += 1;   // simulate a later setMarkdown() / dispose

        await anyMd.loadCodeEditorUpgrade(wrapper, pre, code, 'const a = 1;', 'javascript', staleGeneration);

        expect(anyMd._codeEditors).toHaveLength(0);
        expect(anyMd._pendingCodeUpgrades).toHaveLength(0);
    });

    it('queues the upgrade when it resolves while not effectively visible', async () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);

        vi.spyOn(md, 'isEffectivelyVisible').mockReturnValue(false);

        await anyMd.loadCodeEditorUpgrade(wrapper, pre, code, 'const a = 1;', 'javascript', anyMd._renderGeneration);

        expect(anyMd._codeEditors).toHaveLength(0);
        expect(anyMd._pendingCodeUpgrades).toHaveLength(1);
        expect(anyMd._pendingCodeUpgrades[0].wrapper).toBe(wrapper);
    });

    it('applies the upgrade immediately when it resolves while effectively visible', async () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);

        await anyMd.loadCodeEditorUpgrade(wrapper, pre, code, 'const a = 1;', 'javascript', anyMd._renderGeneration);

        expect(anyMd._codeEditors).toHaveLength(1);
        expect(anyMd._pendingCodeUpgrades).toHaveLength(0);
    });
});

/** Seeds a wrapper's rect via the recording sink's inline-style geometry fold. */
function seedRect(wrapper: Handle, top: number, height = 80): void {
    DOM.sink.apply(wrapper, { style: { left: '0px', top: `${top}px`, width: '600px', height: `${height}px` } });
}

describe('Markdown viewport gate (private, called directly)', () => {
    it('a block seeded beyond the lookahead cutoff queues instead of loading', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);
        seedRect(wrapper, 5000);

        const loadSpy = vi.spyOn(anyMd, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());
        const entry = { wrapper, pre, code, text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration };

        anyMd.startCodeEditorImport(entry);

        expect(loadSpy).not.toHaveBeenCalled();
        expect(anyMd._awaitingViewportKickoffs).toHaveLength(1);
    });

    it('a block seeded within the visible window loads immediately', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);
        seedRect(wrapper, 200);

        const loadSpy = vi.spyOn(anyMd, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());
        const entry = { wrapper, pre, code, text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration };

        anyMd.startCodeEditorImport(entry);

        expect(loadSpy).toHaveBeenCalledTimes(1);
        expect(anyMd._awaitingViewportKickoffs).toHaveLength(0);
    });

    it('a block seeded inside the 1600px lookahead loads immediately — the lookahead is live', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);
        seedRect(wrapper, 1500);

        const loadSpy = vi.spyOn(anyMd, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());
        const entry = { wrapper, pre, code, text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration };

        anyMd.startCodeEditorImport(entry);

        expect(loadSpy).toHaveBeenCalledTimes(1);
        expect(anyMd._awaitingViewportKickoffs).toHaveLength(0);
    });

    it('queueing a block arms the viewport watch', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);
        seedRect(wrapper, 5000);

        vi.spyOn(anyMd, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());
        const entry = { wrapper, pre, code, text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration };

        anyMd.startCodeEditorImport(entry);

        expect(anyMd._viewportWatchArmed).toBe(true);
        expect(Event._registeredComponentIds()).toContain(md.getId());
    });

    it('onViewportPass() loads a re-seeded queued block, empties the queue, and disarms the watch', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);
        seedRect(wrapper, 5000);

        const loadSpy = vi.spyOn(anyMd, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());
        const entry = { wrapper, pre, code, text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration };

        anyMd.startCodeEditorImport(entry);
        expect(anyMd._awaitingViewportKickoffs).toHaveLength(1);

        seedRect(wrapper, 200);
        anyMd.onViewportPass();

        expect(loadSpy).toHaveBeenCalledTimes(1);
        expect(anyMd._awaitingViewportKickoffs).toHaveLength(0);
        expect(anyMd._viewportWatchArmed).toBe(false);
        expect(Event._registeredComponentIds()).not.toContain(md.getId());
    });

    it('a queued block fully above the window stays queued after a pass — no upward lookahead', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);
        seedRect(wrapper, -900, 80); // bottom = -820: fully above the window

        const loadSpy = vi.spyOn(anyMd, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());
        const entry = { wrapper, pre, code, text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration };

        anyMd._awaitingViewportKickoffs.push(entry);
        anyMd.onViewportPass();

        expect(loadSpy).not.toHaveBeenCalled();
        expect(anyMd._awaitingViewportKickoffs).toHaveLength(1);
    });

    it('onViewportPass() on a not-effectively-visible Markdown leaves the queue untouched', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);
        seedRect(wrapper, 200);

        const loadSpy = vi.spyOn(anyMd, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());
        const entry = { wrapper, pre, code, text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration };

        anyMd._awaitingViewportKickoffs.push(entry);
        vi.spyOn(md, 'isEffectivelyVisible').mockReturnValue(false);

        anyMd.onViewportPass();

        expect(loadSpy).not.toHaveBeenCalled();
        expect(anyMd._awaitingViewportKickoffs).toHaveLength(1);
    });

    it('the pass breaks at the first out-of-range entry and trusts document order', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const first  = buildCodeHostTrio(md);
        const second = buildCodeHostTrio(md);
        const third  = buildCodeHostTrio(md);
        seedRect(first.wrapper, 200);
        seedRect(second.wrapper, 5000);
        seedRect(third.wrapper, 300); // geometrically eligible, but queued after the 5000 entry

        const loadSpy = vi.spyOn(anyMd, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());
        const toEntry = (h: typeof first) => ({
            wrapper: h.wrapper, pre: h.pre, code: h.code,
            text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration,
        });

        anyMd._awaitingViewportKickoffs.push(toEntry(first), toEntry(second), toEntry(third));
        anyMd.onViewportPass();

        expect(loadSpy).toHaveBeenCalledTimes(1);
        expect(loadSpy.mock.calls[0]![0]).toBe(first.wrapper);
        expect(anyMd._awaitingViewportKickoffs).toHaveLength(2);
    });

    it('dispose() on an instance with a queued block leaves no viewport-listener registration', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);
        seedRect(wrapper, 5000);

        vi.spyOn(anyMd, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());
        const entry = { wrapper, pre, code, text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration };

        anyMd.startCodeEditorImport(entry);
        expect(Event._registeredComponentIds()).toContain(md.getId());

        md.dispose();

        expect(Event._registeredComponentIds()).not.toContain(md.getId());
    });

    it('coalesces two scheduleContentMeasure() calls into one measureContentHeight() call', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const afterNextLayoutSpy = vi.spyOn(Component, 'afterNextLayout');
        const measureSpy = vi.spyOn(anyMd, 'measureContentHeight');

        anyMd.scheduleContentMeasure();
        anyMd.scheduleContentMeasure();

        expect(afterNextLayoutSpy).toHaveBeenCalledOnce();

        afterNextLayoutSpy.mock.calls[0]![0](); // run the queued callback, as a real flush would

        expect(measureSpy).toHaveBeenCalledOnce();
    });
});

describe('Markdown code editor disposal', () => {
    it('dispose() disposes every live CodeEditor child', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper } = buildCodeHostTrio(md);
        const editor = new FakeCodeEditor('x', { readOnly: true, language: 'javascript' });

        anyMd._codeEditors.push({ editor, wrapper });

        md.dispose();

        expect(editor.disposed).toBe(true);
        expect(anyMd._codeEditors).toHaveLength(0);
    });

    it('setMarkdown() disposes stale live CodeEditor children and bumps the render generation', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper } = buildCodeHostTrio(md);
        const editor = new FakeCodeEditor('x', { readOnly: true, language: 'javascript' });

        anyMd._codeEditors.push({ editor, wrapper });
        const generationBefore = anyMd._renderGeneration;

        md.setMarkdown('hello again');

        expect(editor.disposed).toBe(true);
        expect(anyMd._codeEditors).toHaveLength(0);
        expect(anyMd._renderGeneration).toBeGreaterThan(generationBefore);
    });

    it('setMarkdown() drops any still-pending upgrade queued before the rebuild', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);

        anyMd._pendingCodeUpgrades.push({
            CodeEditorClass: FakeCodeEditor, wrapper, pre, code,
            text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration,
        });

        md.setMarkdown('hello again');

        expect(anyMd._pendingCodeUpgrades).toHaveLength(0);
    });

    it('setMarkdown() drops any kickoff still awaiting visibility or viewport, queued before the rebuild', () => {
        const md = new Markdown('hello');
        md.getElement(true);
        const anyMd = md as any;
        const { wrapper, pre, code } = buildCodeHostTrio(md);

        anyMd._awaitingVisibilityKickoffs.push({
            wrapper, pre, code, text: 'x', languageId: 'javascript', generation: anyMd._renderGeneration,
        });
        anyMd._awaitingViewportKickoffs.push({
            wrapper, pre, code, text: 'y', languageId: 'javascript', generation: anyMd._renderGeneration,
        });
        anyMd.armViewportWatch();
        const generationBefore = anyMd._renderGeneration;

        md.setMarkdown('hello again');

        expect(anyMd._awaitingVisibilityKickoffs).toHaveLength(0);
        expect(anyMd._awaitingViewportKickoffs).toHaveLength(0);
        expect(anyMd._viewportWatchArmed).toBe(false);
        expect(Event._registeredComponentIds()).not.toContain(md.getId());
        expect(anyMd._renderGeneration).toBeGreaterThan(generationBefore);
    });
});

describe('Markdown selectable text', () => {
    it('opts the root into user-select: text so rendered prose can be selected', () => {
        expect(new Markdown('# Hi').getUserSelect()).toBe('text');
        expect(new Markdown('# Hi').getCursor()).toBe('text');
    });
});
