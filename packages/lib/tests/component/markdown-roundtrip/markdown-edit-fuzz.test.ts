import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot, $isRootNode, $isTextNode } from 'lexical';
import type { LexicalEditor, LexicalNode, TextNode } from 'lexical';
import { $dfs, $findMatchingParent } from '@lexical/utils';
import type { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $isReferenceLinkNode } from '~/component/editor/markdownReferenceLinkNode';
import { $readDefinitions } from '~/component/editor/markdownSerializer';
import type { MarkdownSourceMap } from '~/component/editor/markdownSourceMap';
import { $isMarkdownRawBlockNode, $isMarkdownSourceTextNode, type MarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { canonicalSave, checkTitle, editorDefinitions, loadAndSave, viewerDefinitions } from './harness';
import { editorSurfaceModel, viewerModel } from './viewModel';
import { CORPUS } from './corpus';
import type { CorpusCase, HarnessCheck } from './corpus/types';

// A deterministic, bounded edit fuzz: random edits through the editor's Lexical
// API over every corpus document, so a save that mixes blocks written as their
// source with edited blocks in the standard form stays correct. Each case's
// random stream is seeded from its name, so a failure reproduces on its own.

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** The fixed seed every case's random stream starts from; changing it explores other edits. */
const FUZZ_SEED = 0x5eed;

/** Edit sequences per corpus case: with about 300 cases this keeps the whole file to a few seconds. */
const SEQUENCES_PER_CASE = 8;

/** The most edits one sequence makes; the plan's fuzz used one- and two-step edits. */
const MAX_EDITS_PER_SEQUENCE = 2;

/** A word, as the loss check compares them: a run of ASCII letters and digits, which no escaping splits. */
const WORD = /[A-Za-z0-9]+/g;

/** The four edits the fuzz makes, as the plan's own fuzz pass did. */
type EditKind = 'appendText' | 'deleteBlock' | 'insertBefore' | 'insertAfter';

/** The edits, in the order a random index picks them. */
const EDIT_KINDS: readonly EditKind[] = ['appendText', 'deleteBlock', 'insertBefore', 'insertAfter'];

/** What a sequence of edits did, for the word-loss check. */
interface EditRecord {
    /** Words the edits wrote into the document. */
    readonly inserted: Set<string>;
    /** Words of the source the edits may have removed or rewritten: deleted and edited blocks' source and text. */
    readonly released: Set<string>;
}

/**
 * A seeded pseudo-random stream (mulberry32): small, fast and the same on every run.
 * The constants are mulberry32's own (Tommy Ettinger's), which give it a full 2^32 period.
 *
 * @param seed - The stream's seed.
 * @returns A function returning the next number in [0, 1).
 */
function randomStream(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), state | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Hashes a case name into a seed (FNV-1a, 32-bit; its offset basis and prime are the algorithm's), so each case has
 * its own stream whatever order the cases run in.
 *
 * @param name - The case name.
 * @returns The case's seed.
 */
function seedOf(name: string): number {
    let hash = 0x811c9dc5 ^ FUZZ_SEED;

    for (let index = 0; index < name.length; index++) {
        hash = Math.imul(hash ^ name.charCodeAt(index), 0x01000193);
    }

    return hash >>> 0;
}

/**
 * The words of a text. A table's cell break (a backslash and an `n`, written between a cell's paragraphs) is
 * a break between words, not a letter `n` glued to the next word.
 *
 * @param text - The text.
 * @returns Its words.
 */
function wordsOf(text: string): Set<string> {
    return new Set(text.replaceAll('\\n', ' ').match(WORD) ?? []);
}

/**
 * Reaches the private Lexical editor.
 *
 * @param editor - The Markdown editor.
 * @returns Its Lexical editor.
 */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/**
 * The source a top-level block was loaded from, read from the editor's private source map.
 *
 * @param editor - The Markdown editor.
 * @param block - A top-level block.
 * @returns Its source, or `""` for a block no import loaded.
 */
function loadedSource(editor: MarkdownEditor, block: LexicalNode): string {
    return (editor as unknown as { _sourceMap: MarkdownSourceMap })._sourceMap.blocks.get(block.getKey())?.body ?? '';
}

/**
 * The root's child holding a node — not `getTopLevelElement`, which stops at a fence column or table cell.
 *
 * @param node - A node in the document.
 * @returns Its top-level block.
 */
function $rootChildOf(node: LexicalNode): LexicalNode {
    return $findMatchingParent(node, (candidate) => $isRootNode(candidate.getParent())) ?? node;
}

/**
 * The text nodes a user can type into: an atomic (token) or segmented node — a kept-source run, which stands for
 * its source as a whole — takes no typed text.
 *
 * @returns The editable text nodes, in document order.
 */
function $editableTextNodes(): TextNode[] {
    return $dfs().map(({ node }) => node).filter($isTextNode).filter((text) => !text.isToken() && !text.isSegmented());
}

/**
 * The words the text nodes in and under a node show, taken node by node: a node's text content runs two adjacent
 * text nodes together (`fuzz` before a link `q` reads `fuzzq`), which a save separates.
 *
 * @param node - The node.
 * @returns The words, in document order.
 */
function $shownWords(node: LexicalNode): string[] {
    return $dfs(node).map(({ node: candidate }) => candidate).filter($isTextNode)
        .flatMap((text) => [...wordsOf(text.getTextContent())]);
}

/**
 * Releases a top-level block's words: what its source and text held may leave the save once it is edited or deleted.
 *
 * @param editor - The Markdown editor.
 * @param block - The top-level block.
 * @param record - The sequence's record.
 */
function release(editor: MarkdownEditor, block: LexicalNode, record: EditRecord): void {
    for (const word of [...wordsOf(loadedSource(editor, block)), ...$shownWords(block)]) {
        record.released.add(word);
    }
}

/**
 * Makes one random edit as one discrete update.
 *
 * @param editor - The Markdown editor.
 * @param random - The case's random stream.
 * @param record - The sequence's record.
 * @param step - The edit's number, which makes the word it writes unique.
 * @returns What the edit did, for the failure message.
 */
function editOnce(editor: MarkdownEditor, random: () => number, record: EditRecord, step: number): string {
    const kind = EDIT_KINDS[Math.floor(random() * EDIT_KINDS.length)]!;
    const word = `fuzz${step}`;
    let done = 'nothing';

    lexicalOf(editor).update(() => {
        const blocks = $getRoot().getChildren();
        const block = blocks[Math.floor(random() * blocks.length)]!;

        if (kind === 'appendText') {
            const texts = $editableTextNodes();

            if (texts.length > 0) {
                const text = texts[Math.floor(random() * texts.length)]!;

                release(editor, $rootChildOf(text), record);
                text.setTextContent(`${text.getTextContent()} ${word}`);
                record.inserted.add(word);
                done = `appended '${word}' to '${text.getTextContent()}'`;
            }
        } else if (kind === 'deleteBlock') {
            if (blocks.length > 1) {
                release(editor, block, record);
                block.remove();
                done = `deleted block ${blocks.indexOf(block)}`;
            }
        } else {
            const paragraph = $createParagraphNode().append($createTextNode(word));

            if (kind === 'insertBefore') {
                block.insertBefore(paragraph);
            } else {
                block.insertAfter(paragraph);
            }

            record.inserted.add(word);
            done = `${kind} block ${blocks.indexOf(block)}`;
        }
    }, { discrete: true });

    return done;
}

/**
 * Tells whether a case lists a harness check as a known divergence, so the fuzz check that rests on it is skipped:
 * a random edit may or may not reach the divergent block, so it cannot be asserted to fail as the harness does.
 *
 * @param testCase - The corpus case.
 * @param check - The harness check the fuzz check rests on.
 * @returns `true` when the case lists it.
 */
function knownDivergence(testCase: CorpusCase, check: HarnessCheck): boolean {
    return testCase.known?.[check] !== undefined;
}

/** One edit sequence's result, as the checks read it. */
interface FuzzRun {
    /** The edited editor. */
    readonly editor:   MarkdownEditor;
    /** Its save. */
    readonly saved:    string;
    /** The save loaded into a fresh editor, and that editor's save. */
    readonly reloaded: { editor: MarkdownEditor; saved: string };
    /** What the edits did. */
    readonly record:   EditRecord;
    /** Whether the edits changed the document's link reference definitions. */
    readonly definitionsChanged: boolean;
    /** The failure message: the case, the edits and the save. */
    readonly context:  string;
}

/**
 * Loads a case, makes one random edit sequence and saves.
 *
 * @param testCase - The corpus case.
 * @param random - The case's random stream.
 * @returns The run.
 */
function runSequence(testCase: CorpusCase, random: () => number): FuzzRun {
    const { editor } = loadAndSave(testCase.source);
    const record: EditRecord = { inserted: new Set(), released: new Set() };
    const edits = 1 + Math.floor(random() * MAX_EDITS_PER_SEQUENCE);
    const definitionsBefore = lexicalOf(editor).read(() => $readDefinitions().key);
    const done = Array.from({ length: edits }, (_, step) => editOnce(editor, random, record, step));
    const definitionsChanged = lexicalOf(editor).read(() => $readDefinitions().key !== definitionsBefore);
    const saved = editor.getValue();

    return {
        editor, saved, reloaded: loadAndSave(saved), record, definitionsChanged,
        context: `${testCase.name} after ${done.join(', ')}:\n${saved}`,
    };
}

/**
 * Checks that the save re-lexes to what the editor shows, also after an edit typed into Markdown source: a raw block
 * shows the blocks its text reads as (`***` with a word after it shows as a paragraph). An edit that changes the
 * definitions is checked like any other: a block holding a kept-source run they change shows anew as its save reads.
 * The check rests on the editor reading the document as the viewer does, so a known `surface` or `parity` divergence
 * skips it, as a known `edits` one does.
 *
 * @param testCase - The corpus case.
 * @param run - The run.
 */
function checkRelexes(testCase: CorpusCase, run: FuzzRun): void {
    const known = (['edits', 'surface', 'parity'] as const).some((check) => knownDivergence(testCase, check));

    if (known) {
        return;
    }

    expect(editorSurfaceModel(run.reloaded.editor), run.context).toEqual(editorSurfaceModel(run.editor));
}

/**
 * Checks that no word is lost: every word of the source outside the edited and deleted blocks, and every word the
 * edited document holds — the edited blocks' text and the words the edits wrote included. A reference link's label
 * is not required: the link is written inline once its definition no longer resolves it.
 *
 * @param testCase - The corpus case.
 * @param run - The run.
 */
function checkNoWordLost(testCase: CorpusCase, run: FuzzRun): void {
    const { shown, labels } = lexicalOf(run.editor).read(() => {
        const nodes = $dfs().map(({ node }) => node);

        return {
            shown:  $shownWords($getRoot()),
            labels: new Set(nodes.filter($isReferenceLinkNode).flatMap((link) => [...wordsOf(link.getReference().label)])),
        };
    });
    const kept = [...wordsOf(testCase.source)].filter((word) => !run.record.released.has(word) && !labels.has(word));
    const savedWords = wordsOf(run.saved);

    expect([...run.record.inserted].filter((word) => !shown.includes(word) && !run.record.released.has(word)), run.context)
        .toEqual([]);
    expect([...kept, ...shown].filter((word) => !savedWords.has(word)), run.context).toEqual([]);
}

/**
 * Runs one random edit sequence on a case and checks the save.
 *
 * @param testCase - The corpus case.
 * @param random - The case's random stream.
 */
function fuzzSequence(testCase: CorpusCase, random: () => number): void {
    const run = runSequence(testCase, random);

    try {
        checkRelexes(testCase, run);

        // Saving the reloaded save changes nothing.
        if (!knownDivergence(testCase, 'idempotence')) {
            expect(run.reloaded.saved, run.context).toBe(run.saved);
        }

        // The save reads in the viewer as the standard form of the same document does.
        if (!knownDivergence(testCase, 'canonical')) {
            expect(viewerModel(run.saved), run.context).toEqual(viewerModel(canonicalSave(run.editor)));
        }

        checkNoWordLost(testCase, run);

        // The editor reads the definitions the viewer reads off the save.
        if (!knownDivergence(testCase, 'definitions')) {
            const own = editorDefinitions(run.editor);

            expect(own, run.context).toEqual(viewerDefinitions(run.saved, own));
        }
    } finally {
        run.editor.dispose();
        run.reloaded.editor.dispose();
    }
}

describe('edit fuzz over the corpus', () => {
    const cases = CORPUS.map((testCase) => [`${testCase.name}: ${checkTitle(testCase, 'edits')}`, testCase] as const);

    it.each(cases)('%s', (_title, testCase) => {
        const random = randomStream(seedOf(testCase.name));

        for (let sequence = 0; sequence < SEQUENCES_PER_CASE; sequence++) {
            fuzzSequence(testCase, random);
        }
    });
});

/**
 * Whether a case holds both a raw block, which may hold definitions, and a kept-source run naming a label in
 * brackets, which a definition can change the reading of.
 *
 * @param source - The case's source.
 * @returns `true` when deleting its raw blocks one at a time is a definition edit worth checking.
 */
function holdsDefinitionDependentRun(source: string): boolean {
    const { editor } = loadAndSave(source);

    try {
        return lexicalOf(editor).read(() => {
            const nodes = $dfs().map(({ node }) => node);

            return nodes.some($isMarkdownRawBlockNode)
                && nodes.some((node) => $isMarkdownSourceTextNode(node) && node.getSource().includes('['));
        });
    } finally {
        editor.dispose();
    }
}

describe('definition edits over the corpus: removing each raw block keeps the editor showing what is saved', () => {
    // A deterministic companion to the random fuzz, which reaches a definition only now and then: every raw block of
    // every case whose kept-source runs a definition can change is removed in turn, and the save must read in the
    // viewer, and after a reload, as the editor shows it.
    const cases = CORPUS
        .filter((testCase) => !(['edits', 'surface', 'parity'] as const).some((check) => knownDivergence(testCase, check)))
        .filter((testCase) => holdsDefinitionDependentRun(testCase.source))
        .map((testCase) => [testCase.name, testCase] as const);

    it.each(cases)('%s', (_name, testCase) => {
        const count = lexicalOf(loadAndSave(testCase.source).editor).read(() => $dfs().filter(({ node }) => $isMarkdownRawBlockNode(node)).length);

        for (let index = 0; index < count; index++) {
            const { editor } = loadAndSave(testCase.source);

            try {
                lexicalOf(editor).update(() => {
                    $dfs().map(({ node }) => node).filter($isMarkdownRawBlockNode)[index]!.remove();
                }, { discrete: true });

                const saved = editor.getValue();
                const context = `${testCase.name} without raw block ${index}:\n${saved}`;
                const reloaded = loadAndSave(saved);

                expect(viewerModel(saved).blocks, context).toEqual(editorSurfaceModel(editor));
                expect(editorSurfaceModel(reloaded.editor), context).toEqual(editorSurfaceModel(editor));
                reloaded.editor.dispose();
            } finally {
                editor.dispose();
            }
        }
    });
});

/** Documents holding one raw HTML block, each named by where that block stands. */
const RAW_BLOCK_POSITIONS: ReadonlyArray<readonly [string, string]> = [
    ['the last block of the document', 'a\n\n<div>\nw\n</div>'],
    ['the last block of a document ending in a line end', 'a\n\n<div>\nw\n</div>\n'],
    ['the only block', '<div>\nw\n</div>'],
    ['a block mid-document', 'a\n\n<div>\nw\n</div>\n\nb'],
    ['the last block of a column', '::: columns\na\n\n<div>\nw\n</div>\n|||\nb\n:::'],
    ['the last block of the last column', '::: columns\na\n|||\nb\n\n<div>\nw\n</div>\n:::'],
    ['the last block of a one-column fence', '::: {align=center}\na\n\n<div>\nw\n</div>\n:::'],
    ['a block mid-column', '::: columns\n<div>\nw\n</div>\n\na\n|||\nb\n:::'],
    ['the last block of a list item', '- a\n\n  <div>\n  w\n  </div>\n\n- b'],
    ['the block opening a list item', '- a\n\n- <div>\n  w\n  </div>\n\n- b'],
    ['a block of a list item before a paragraph', '- a\n\n  <div>\n  w\n  </div>\n\n  c\n\n- b'],
    ['a block of a list item before a nested list', '- a\n\n  <div>\n  w\n  </div>\n\n  - n\n\n- b'],
    ['a block of a list item between two nested lists', '- a\n  - n\n\n  <div>\n  w\n  </div>\n\n  * d\n\n- b'],
    ['the last block of a list item after its nested list', '- a\n  - n\n\n  <div>\n  w\n  </div>\n\n- b'],
    ['the block opening an item of a tight list', '- a\n- <div>\n  w\n  </div>\n- b'],
    ['the block opening the only item of a list', '- <div>\n  w\n  </div>'],
    ['the block opening an item of a tight nested list', '- a\n  - <div>\n    w\n    </div>\n  - m\n- b'],
    ['the block opening the first item of a list nested under text', '- a\n  - <div>\n    w\n    </div>'],
    ['the block opening an ordered item', '1. a\n2. <div>\n   w\n   </div>\n3. b'],
    ['the block opening a task-list neighbour', '- [ ] a\n- <div>\n  w\n  </div>\n- [x] b'],
    ['the block opening an item of a list in a column', '::: columns\n- a\n- <div>\n  w\n  </div>\n|||\nb\n:::'],
    ['the last block of a list item in a column', '::: columns\n- a\n\n  <div>\n  w\n  </div>\n|||\nb\n:::'],
    ['the block under the text of a list\'s only item', '- a\n\n  <div>\n  w\n  </div>'],
    ['a block after a list', '- a\n\n<div>\nw\n</div>'],
    // A definition after the block, and a reference to it: left open, the block must not hide the definition.
    ['a block before a definition', '<div>\nw\n</div>\n\n[x]: /k\n\nb [x] c'],
    ['the only block of a column before a column holding a definition', '::: columns\n<div>\nw\n</div>\n|||\n[x]: /k\n:::\n\nb [x] c'],
    ['the last block of a list item before an item holding a reference', '- a\n\n  <div>\n  w\n  </div>\n- b [x] c\n\n[x]: /k'],
];

/** What an edit leaves of the raw block's text: HTML block starts first, then every other shape it can read as. */
const RAW_BLOCK_TEXTS: readonly string[] = [
    '<div', '<div ', '<div>', '</div', '</div>', '<pre', '<script', '<style', '<textarea', '<DIV', '   <div', '<h1', '<p',
    '<', '<a', '<a>', 'plain', '# h', '- item', '> q', '```', '[a]: /u', '---', '<!--', '<!-- x', '<?', '<!D', '',
    '<div\n</div', '<div>\nw\n</div', '<div>\nw\n</di', '<div>\nw\n<',
    // A first or last line holding nothing, and spaces before the block: none is part of what the block reads as.
    '\n<div>', '\n\n<div>', '\n<div', ' \n<div>', '<div>\n', '<div>\n\n', '\n<div>\n', '  <div>', ' <div', '   <div>\nw\n</div>',
    // Runs of definitions, and a quote before a line without `>` that starts an HTML block.
    '[a]: /u\n[b]: /v', '[a]: /u\n\n[b]: /v', '> q\n<div', '> q\n</div',
    // Whitespace alone, which writes nothing.
    ' ', ' \n ', '\n',
    // Lines a `:::` fence around the block would read: a closer, an opener, a column separator.
    '<div>\n:::\n</div>', '<div>\n::: x\n</div>', '<div>\n|||\n</div>',
];

/**
 * Replaces a raw block's text as an edit leaves it: one text node per non-empty line, a line break between lines.
 *
 * @param block - The raw block.
 * @param text - Its new text.
 */
function $setRawBlockText(block: MarkdownRawBlockNode, text: string): void {
    block.clear();

    text.split('\n').forEach((line, index) => {
        if (index > 0) {
            block.append($createLineBreakNode());
        }

        if (line !== '') {
            block.append($createTextNode(line));
        }
    });
}

describe('raw block edits: a raw block shows what its save reads as, wherever it stands', () => {
    // A deterministic companion to the random fuzz, whose `appendText` only ever lengthens a raw block: the one raw
    // block of each document is set to each text an edit can leave in it, and the save must read in the viewer, and
    // after a reload, as the editor shows it, and save again unchanged; the editor reads the definitions the viewer
    // reads off the save.
    const cases = RAW_BLOCK_POSITIONS.flatMap(([position, source]) =>
        RAW_BLOCK_TEXTS.map((text) => [`${JSON.stringify(text)} as ${position}`, source, text] as const));

    it.each(cases)('RB. %s', (_title, source, text) => {
        const { editor } = loadAndSave(source);

        lexicalOf(editor).update(() => {
            const block = $dfs().map(({ node }) => node).filter($isMarkdownRawBlockNode)[0]!;

            $setRawBlockText(block, text);
        }, { discrete: true });

        const saved = editor.getValue();
        const context = `${JSON.stringify(text)} in ${JSON.stringify(source)}:\n${saved}`;
        const reloaded = loadAndSave(saved);

        try {
            expect(viewerModel(saved).blocks, context).toEqual(editorSurfaceModel(editor));
            expect(editorSurfaceModel(reloaded.editor), context).toEqual(editorSurfaceModel(editor));
            expect(reloaded.saved, context).toBe(saved);

            const own = editorDefinitions(editor);

            expect(own, context).toEqual(viewerDefinitions(saved, own));
        } finally {
            editor.dispose();
            reloaded.editor.dispose();
        }
    });
});
