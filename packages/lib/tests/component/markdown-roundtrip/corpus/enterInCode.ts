import type { CorpusCase } from './types';

/** A block that holds no blocks itself: the path of the blockquote or list item that holds it, its kind, and a code block's text. */
export type LeafReading = readonly [container: string, kind: string, text?: string];

/** A corpus case with what the viewer must read off it. */
export interface EnterInCodeCase extends CorpusCase {
    /**
     * Every block that holds no blocks itself, in document order. The path is `''` at the top level, `'/0'` in a quote
     * that is the document's first block, and `'/0.1/2'` in a quote that is the third block of the second item of a
     * list that is the first block. The viewer shows a code block's text without the line break that ends it.
     */
    readonly reads: readonly LeafReading[];
}

/**
 * What Enter leaves in a code block, in the built-in `"markdown"` language: the documents the typing rows of
 * `code-editor.test.ts` end with, each named by its row, and some with text typed on the new line. Every new line
 * starts with the prefix of the line Enter was pressed on, so it stays in the code block and in the quote or list item
 * of that line. `reads` says so for each: one code block where the row started with one, holding the new line.
 * `markdown-roundtrip.test.ts` checks it on the viewer's reading.
 */
export const ENTER_IN_CODE_CASES: readonly EnterInCodeCase[] = [
    // A fenced block in a blockquote.
    { name: 'Enter in quoted fenced code (C35)', source: '> ```\n> code\n> \n> ```', reads: [['/0', 'code', 'code']] },
    { name: 'Enter in quoted fenced code, then text (F1)', source: '> ```\n> code\n> more\n> ```', reads: [['/0', 'code', 'code\nmore']] },
    { name: 'a fenced block typed in a quote (F2)', source: '> ```js\n> code\n> ```\n> ', reads: [['/0', 'code', 'code']] },
    { name: 'Enter after a quoted closing fence (F3)', source: '> ```\n> code\n> ```\n> \n> after', reads: [['/0', 'code', 'code'], ['/0', 'paragraph']] },
    { name: 'Enter in fenced code in a nested quote (F4)', source: '> > ```\n> > code\n> > \n> > ```', reads: [['/0/0', 'code', 'code']] },
    { name: 'Enter on a deeper-indented quoted code line (F5)', source: '> ```\n>     deep\n>     \n> ```', reads: [['/0', 'code', '    deep\n    ']] },
    { name: 'Enter in the middle of a quoted code line (F6)', source: '> ```\n> co\n> de\n> ```', reads: [['/0', 'code', 'co\nde']] },
    { name: 'Enter twice in quoted fenced code (F7)', source: '> ```\n> code\n> \n> \n> ```', reads: [['/0', 'code', 'code\n']] },
    { name: 'Enter three times in quoted fenced code left open (F7)', source: '> ```\n> code\n> \n> \n> ', reads: [['/0', 'code', 'code\n']] },
    { name: 'Enter in quoted fenced code with a tab after the marker', source: '>\t```\n>\tcode\n>\t\n>\t```', reads: [['/0', 'code', 'code']] },
    // A fenced block in a list item.
    { name: 'Enter after a fence opened on an item marker line (F9)', source: '- ```js\n  \n  code\n  ```', reads: [['/0.0', 'code', '\ncode']] },
    { name: 'Enter after a fence opened on an ordered item marker line (F10)', source: '1. ```\n   \n   code\n   ```', reads: [['/0.0', 'code', '\ncode']] },
    { name: 'a fenced block typed on an item marker line (F11)', source: '- ```\n  code\n  ```\n  ', reads: [['/0.0', 'code', 'code']] },
    { name: 'Enter on a code line of an item (F12)', source: '- ```\n  code\n  \n  ```', reads: [['/0.0', 'code', 'code']] },
    // Nested containers.
    { name: 'Enter in fenced code in an item in a quote (F13)', source: '> - ```\n>   code\n>   \n>   ```', reads: [['/0/0.0', 'code', 'code']] },
    { name: 'Enter in fenced code in a quote in an item (F14)', source: '- > ```\n  > code\n  > \n  > ```', reads: [['/0.0/0', 'code', 'code']] },
    { name: 'Enter after a fence opened on an item marker line in a quote (F15)', source: '> - ```\n>   \n>   code', reads: [['/0/0.0', 'code', '\ncode']] },
    // Tabs.
    { name: 'Enter on a tab-indented code line in a nested item (F16)', source: '- a\n  - b\n\t```\n\tcode\n\t\n\t```', reads: [['/0.0', 'paragraph'], ['/0.0/1.0', 'paragraph'], ['/0.0/1.0', 'code', 'code']], known: { surface: 'listItemBlocks' } },
    { name: 'Enter on a tab-indented code line in a nested item, then text', source: '- a\n  - b\n\t```\n\tcode\n\tmore\n\t```', reads: [['/0.0', 'paragraph'], ['/0.0/1.0', 'paragraph'], ['/0.0/1.0', 'code', 'code\nmore']], known: { surface: 'listItemBlocks' } },
    { name: 'Enter on a tab-indented line of top-level fenced code (F17)', source: '```\n\tcode\n\t\n```', reads: [['', 'code', '\tcode\n\t']] },
    { name: 'text typed after Enter in tab-indented code (F18)', source: 'p\n\n\tcode\n\tmore', reads: [['', 'paragraph'], ['', 'code', 'code\nmore']] },
    { name: 'Enter after a fence opened on an item marker line with a tab after the marker', source: '-\t```\n \t\n\tcode\n\t```', reads: [['/0.0', 'code', '\ncode']] },
    // An indented code block.
    { name: 'Enter in quoted indented code (F19)', source: '>     code\n>     \n>     more', reads: [['/0', 'code', 'code\n\nmore']] },
    { name: 'Enter in quoted indented code, then text', source: '>     code\n>     x\n>     more', reads: [['/0', 'code', 'code\nx\nmore']] },
    { name: 'Enter in indented code in a list item (F20)', source: '- a\n\n      code\n      \n      more', reads: [['/0.0', 'paragraph'], ['/0.0', 'code', 'code\n\nmore']] },
    { name: 'Enter in top-level indented code (F21)', source: 'p\n\n    code\n    ', reads: [['', 'paragraph'], ['', 'code', 'code']] },
    // An empty pair.
    { name: 'Enter between brackets in quoted fenced code (F24)', source: '> ```\n> f(\n> \n> )\n> ```', reads: [['/0', 'code', 'f(\n\n)']] },
    { name: 'Enter between brackets in fenced code in a list item (F25)', source: '- ```\n  f(\n  \n  )\n  ```', reads: [['/0.0', 'code', 'f(\n\n)']] },
    // A blank line.
    { name: 'Enter on a blank indented line of top-level fenced code (F29)', source: '```\n  code\n\n  ', reads: [['', 'code', '  code\n\n  ']] },
    { name: 'Enter on a blank indented line of fenced code in an item (F30)', source: '- ```\n  code\n\n  \n  ```', reads: [['/0.0', 'code', 'code\n']] },
    // A selection, and two carets.
    { name: 'Enter over a selection in quoted fenced code (S1)', source: '> ```\n> co\n> \n> ```', reads: [['/0', 'code', 'co']] },
    { name: 'Enter over a selection across two quoted code lines (S3)', source: '> ```\n> a\n> d\n> ```', reads: [['/0', 'code', 'a\nd']] },
    { name: 'Enter at two carets in quoted fenced code (S5)', source: '> ```\n> a\n> \n> b\n> \n> ```', reads: [['/0', 'code', 'a\n\nb']] },
];
