import type { CorpusCase } from './types';

/**
 * What Enter leaves inside HTML that sits in a blockquote or list item, in the built-in `"markdown"` language: the
 * documents the typing rows of `code-editor.test.ts` end with, each named by its row, four with text typed on a new
 * line that starts with a tab, and one whose lines all carry a space-and-tab prefix. Every new line starts with the
 * prefix of the line Enter was pressed on, so it stays in the quote or list item of that line
 * (`markdown-roundtrip.test.ts` checks that on the viewer's reading, and names the one document it does not hold for).
 */
export const ENTER_INSIDE_HTML_CASES: readonly CorpusCase[] = [
    { name: 'Enter in quoted HTML (M33)', source: '> <div>\n> \n> x', known: { surface: 'quoteBlocks' } },
    { name: 'Enter in quoted HTML, then text (C1)', source: '> <div>\n> :::\n> x', known: { surface: 'quoteBlocks' } },
    { name: 'Enter in the middle of a quoted HTML line (C2)', source: '> <div>foo\n> bar\n> x', known: { surface: 'quoteBlocks' } },
    { name: 'Enter on a deeper-indented quoted HTML line (C3)', source: '>   <div>\n>     foo\n>     \n>   </div>', known: { surface: 'quoteBlocks' } },
    { name: 'Enter in quoted HTML with no space after the marker (C4)', source: '><div>\n>\n>x', known: { surface: 'quoteBlocks' } },
    { name: 'Enter in HTML in a nested quote (C5)', source: '> > <div>\n> > \n> > x', known: { surface: 'quoteBlocks' } },
    { name: 'Enter after a quoted close tag (C6)', source: '> <div>\n> x\n> </div>\n> \n> after', known: { surface: 'quoteBlocks' } },
    { name: 'Enter on an item marker line in a quote (M26)', source: '> - <div>\n>   \n>   x\n>   </div>', known: { surface: 'quoteBlocks' } },
    { name: 'Enter on the marker line of an item holding a quote (C7)', source: '- > <div>\n  > \n  > x', known: { surface: 'quoteBlocks' } },
    { name: 'Enter on an item continuation line in a quote (C8)', source: '> - <div>\n>   x\n>   \n>   </div>', known: { surface: 'quoteBlocks' } },
    { name: 'Enter on an ordered item marker line in a quote (C9)', source: '> 1. <div>\n>    \n>    x', known: { surface: 'quoteBlocks' } },
    { name: 'Enter in HTML three containers deep (C10)', source: '> - > <div>\n>   > \n>   > x', known: { surface: 'quoteBlocks' } },
    { name: 'Enter between adjacent tags on an item marker line (M32)', source: '- <div>\n  \n  </div>' },
    { name: 'Enter between adjacent tags in a quote (C11)', source: '> <div>\n> \n> </div>', known: { surface: 'quoteBlocks' } },
    { name: 'Enter between adjacent tags on an item marker line in a quote (C12)', source: '> - <div>\n>   \n>   </div>', known: { surface: 'quoteBlocks' } },
    { name: 'Enter between adjacent tags on a nested item marker line (C13)', source: '- a\n  - <div>\n    \n    </div>' },
    { name: 'Enter on a tab-indented nested item marker line (C14)', source: '- a\n\t- <div>\n\t  \n\t  x' },
    { name: 'Enter on a tab-indented nested item marker line, then text', source: '- a\n\t- <div>\n\t  y\n\t  x' },
    { name: 'Enter on a tab-indented nested item marker line over space-indented lines (M34)', source: '- a\n\t- <div>\n\t  \n      x\n      </div>' },
    { name: 'Enter on a marker line indented by a space and a tab (M36)', source: '- a\n \t- <div>\n \t  \n      x\n      </div>' },
    { name: 'Enter on a marker line indented by a space and a tab, over lines with its prefix', source: '- a\n \t- <div>\n \t  \n \t  x' },
    { name: 'Enter on an item marker line with a tab after the marker (C16)', source: '-\t<div>\n \t\n\tx' },
    { name: 'Enter on an item marker line with a tab after the marker, then text', source: '-\t<div>\n \ty\n\tx' },
    { name: 'Enter on a tab-indented item continuation line (C17)', source: '1. a\n\t<div>\n\t\n\tx\n\t</div>' },
    { name: 'Enter on a tab-indented item continuation line, then text', source: '1. a\n\t<div>\n\ty\n\tx\n\t</div>', known: { surface: 'listItemBlocks' } },
    { name: 'Enter in quoted HTML with a tab after the marker (C18)', source: '>\t<div>\n>\t\n>\tx', known: { surface: 'quoteBlocks' } },
    { name: 'Enter in quoted HTML with a tab after the marker, then text', source: '>\t<div>\n>\ty\n>\tx', known: { surface: 'quoteBlocks' } },
    { name: 'Enter between a quote marker and deeper-indented HTML (C21)', source: '> <div>\n> \n>   x', known: { surface: 'quoteBlocks' } },
    { name: 'Enter three times in a quoted pre block (C23)', source: '> <pre>\n> \n> \n> \n> x\n> </pre>', known: { surface: 'quoteBlocks' } },
    { name: 'Enter twice in a pre block in a list item (C24)', source: '- <pre>\n  \n  \n  x\n  </pre>' },
    { name: 'Enter inside an inline tag in a quote (C28)', source: '> text <a href="x"\n> title="y"> more\n> next' },
    { name: 'Enter between two inline tags in a quote (C29)', source: '> a <b>\n> </b> c\n> d' },
    { name: 'Enter inside a quoted HTML comment (C31)', source: '> <!-- a\n> \n> b -->', known: { surface: 'quoteBlocks' } },
    { name: 'Enter inside a quoted script (C32)', source: '> <script>\n> function f() {\n> \n> }\n> </script>', known: { surface: 'quoteBlocks' } },
    { name: 'Enter inside a script in a list item (C33)', source: '- a\n  <script>\n  if (x) {\n  \n  }\n  </script>', known: { surface: 'listItemBlocks' } },
    { name: 'Enter at two carets in quoted HTML (C37)', source: '> <div>\n> \n> x\n> \n> </div>', known: { surface: 'quoteBlocks' } },
];
