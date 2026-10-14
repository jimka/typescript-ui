---
depends-on: [markdown-language-readonly-and-fences]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts
  - packages/lib/tests/component/markdown-editor-command-crashes.test.ts
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Typing Shortcuts Only for Typing — Implementation Plan

## Overview

`MarkdownEditor` applies Markdown *typing shortcuts* in WYSIWYG mode: typing `- ` at a line's start makes a list item, `**x**` makes bold, a fence makes a code block. Today a shortcut is also applied by edits that type nothing. In the paragraph `\- .cd`, pressing Backspace after the `.` leaves text that reads as a list marker, and the paragraph becomes a list item. In `a \*x\*.b` the same Backspace makes `x` italic and loses the escapes. A cut, a paste of one character and a drop do the same. The tip of the stack, `master` and the releases behave this way.

This plan makes the rule the editor's own: **a shortcut is applied by typing, and by nothing else.** The change is in `registerMarkdownShortcutsOutsideRawBlocks` ([MarkdownEditor.ts:3546](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3546)), which already wraps Lexical's shortcut listener to keep it out of raw blocks, plus one new function that marks the updates that type text. Whether an update typed text is read from the browser's input event, which Lexical hands to its commands.

All line numbers are for the tip of `feature/markdown-language-readonly-and-fences` (`a11d86be6`). Everything was measured there on the installed Lexical 0.49.0 and `marked` 18.0.9: at command level in the test harness, and in headless Chromium with real keys and real compositions. Firefox and WebKit were not available; what is said about them is read from Lexical's source and marked so.

---

## Architecture Decisions

### The defect — Lexical's listener cannot tell typing from any other edit

Lexical's `registerMarkdownShortcuts` has no notion of typing. Its update listener takes any update that leaves a collapsed caret in changed text, at most one character further on than before, for a typed character, and reads the text before the caret for a shortcut.[^lexical-listener]

Measured on the tip, for each of the 14 kinds of shortcut text in the test file (five text formats, a link, three bullets, a list number, two headings, a quote, a code fence):

| Edit that leaves the caret right behind shortcut-shaped text | Today | Undo steps today |
|---|---|---|
| a typed character | applied | 2: the shortcut, then the character |
| Backspace; a selection removed by Delete, Backspace, a word or line delete, `REMOVE_TEXT_COMMAND` | applied | 2 |
| cut (Ctrl+X, `CUT_COMMAND`, `cut()`) | applied | 2 |
| paste of the one character that completes it (Ctrl+V, `PASTE_COMMAND`, `paste()`, pasted nodes) | applied | 2 |
| drop of that character | applied | 2 |
| an update that changes the text with no input behind it | applied | 2 |
| forward Delete with a collapsed caret | not applied | 1 |
| undo, redo | not applied | — |

The last two rows are right today for reasons of Lexical's own: a forward Delete does not move the caret, and Lexical skips the updates of undo and redo.[^measured-tip]

### One rule — a shortcut is applied by typing

*Typing* is input that enters text at the caret as the user produces it: a key's character, text composed with an input method or a dead key, dictated text, and the replacement a browser makes for what was just typed (autocorrect). Everything else is not typing: a removal, a cut, a paste, a drop, an undo or redo, a command, an API call, and a change of the text with no input behind it.

A browser says which it is. Typed text reaches the editor through an input event, whose `inputType` names the kind, or through the end of a composition. Lexical passes the input event, or the text it carries, through three commands, and tags the update that ends a composition. The table gives, for each path, how Lexical delivers it, whether it is typing, and what this plan reads to know. The last column says what was run: **run** is real input in Chromium, **simulated** is the path's events or commands produced by a script, **source** is read from `LexicalEvents.ts` and not run.

| # | Path | How Lexical delivers it | Typing | Read from | Evidence |
|---|---|---|---|---|---|
| 1 | A key's character where Lexical inserts it itself: over a selection, at a format's or a link's edge | `beforeinput` `insertText`, prevented; `CONTROLLED_TEXT_INSERTION_COMMAND` with the character | yes | the `beforeinput`'s type; the command's string | Chromium run; Firefox, WebKit source |
| 2 | A key's character the browser inserts | `beforeinput` `insertText` left alone; the `input` event; Lexical reads the text off the DOM | yes | the `input` event's type; the unprevented `beforeinput` when the text is read before the `input` event | Chromium run; the second order simulated; Firefox, WebKit source |
| 3 | A composition's end in Chromium, on Android and iOS | `compositionend`; Lexical tags the update `COMPOSITION_END_TAG` | yes | that tag | Chromium run; Android, iOS source |
| 4 | A composition's end in Firefox | the `input` event after `compositionend`; Lexical adds the same tag | yes | that tag | source |
| 5 | A composition's end in desktop Safari and macOS WebKit views[^webkit] | `beforeinput` `insertFromComposition`, prevented; the command with the event; no end tag | yes | the event's type | simulated; source |
| 6 | Android Chrome composing where Lexical inserts the text itself | `input` `insertCompositionText`; the command with the text | yes | the `input` event's type; the command's string | source |
| 7 | A text replacement: autocorrect, macOS double-space full stop, a picked spelling | `beforeinput` `insertReplacementText`, prevented; the command with the event | yes[^replacement] | the event's type | simulated; source |
| 8 | Dictation, an emoji picker, an input method that commits without composing | paths 1 to 3 | yes | as those paths | Chromium run for a commit without composing; else source |
| 9 | Paste | `PASTE_COMMAND`; `PASTE_TAG` | no | no typing mark | Chromium run |
| 10 | Drop, yank | `beforeinput` `insertFromDrop` / `insertFromYank`; the command with the event | no | the event's type | simulated |
| 11 | Backspace, Delete, word and line deletes, cut, `cut()` | the delete commands, `REMOVE_TEXT_COMMAND`, `CUT_COMMAND` | no | no typing mark | Chromium run |
| 12 | A deletion the browser makes itself (Android Chrome's Backspace) | `beforeinput` `deleteContentBackward` left alone; the `input` event | no | both events' types | simulated; source |
| 13 | Undo, redo | `HISTORIC_TAG` | no | no typing mark | Chromium run |
| 14 | A command or API call (`toggleBold`, `setValue`, `insertImage`, …) | an update with no input event | no | no typing mark | run at command level |
| 15 | Text changed in the DOM with no input event (a browser extension) | Lexical's mutation observer; an update with no command | no | no typing mark | simulated at command level |
| 16 | Enter | `KEY_ENTER_COMMAND`; Lexical's own Enter listener | its own path, see below | — | Chromium run |

A typed character over a selection is path 1. A mobile keyboard's word is a composition (paths 3, 6); its space arrives as path 1 or 2, or as the last character of the composed text, which Lexical's listener accepts at a composition's end. Speech input is path 8.

### The mechanism — the input event marks the update

One new function, `registerTypedTextMarks`, registers three command listeners. Each tags the update it runs in with `TYPED_TEXT_TAG` when its input types text:

| Listener | Tags when |
|---|---|
| `BEFORE_INPUT_COMMAND` | the event's `inputType` is `insertText`, `insertCompositionText`, `insertFromComposition` or `insertReplacementText` |
| `INPUT_COMMAND` | the same |
| `CONTROLLED_TEXT_INSERTION_COMMAND` | the payload is a string, or an event of one of those types |

The shortcut wrapper then hands an update to Lexical's listener only when the update is *typed*: it carries `TYPED_TEXT_TAG`, or Lexical's `COMPOSITION_END_TAG`, or it is committed while a typed `beforeinput` that Lexical left to the browser is still waiting for its `input` event.[^awaited] An update with none of the three is not typing. Nothing has to mark what is *not* typing.[^no-negative]

This follows the two patterns the code already has. The wrapper already decides per update whether Lexical's listener sees it ([MarkdownEditor.ts:3547](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3547)), and the file already tells its own edits apart by update tags (`PASTE_TAG` at [MarkdownEditor.ts:1669](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1669), `CUT_TAG` at [:2696](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2696)).[^first-attempt]

### The Enter path is not changed

Lexical's shortcuts have a second way in: on Enter, with the caret at the end of a block whose whole text is a marker (`- `, `1. `, `# `, `> `) or a fence opener (` ``` `, ` ```js `), the block is converted. Enter is a key press, and the fence shortcut depends on it, so this plan leaves the Enter path as it is.

One sequence gives a different result than before. In `\- x`, Backspace over the `x` leaves the text `- `. Today that Backspace makes the list item. With this plan the text stays text, and an Enter pressed right there makes the list item, by the Enter path.

### A completed shortcut stays two undo steps

A typed character that completes a shortcut is two undo steps, as today: the first undo takes the shortcut back and leaves the characters as typed, the second takes the character. The first undo is how a user declines a shortcut, so the steps stay separate.[^undo-steps]

### This plan beside `markdown-editor-raw-block-range-edits`

That branch is open and undecided. It holds a first version of this rule (commit "Apply a Markdown typing shortcut for typed text only" and its docs commit). This plan does not depend on it and is written against the tip without it. Step 1 checks which case holds:

| Base | What the implementer does |
|---|---|
| The branch is not below (`grep -c registerTypingTags MarkdownEditor.ts` prints 0) | Follow the steps as written. |
| The branch is below with its rule | Step 2 removes that rule's code first. The test file exists and is replaced whole. The two doc texts exist and are replaced. |
| The branch is below with a narrowed rule ("its own removals complete no shortcut") | The same as the row above for whatever of the listed names exist. A removal needs no mark under this plan, so a mark that only says "not typing" is removed with its check. |

The branch's row `TU1` types with `CONTROLLED_TEXT_INSERTION_COMMAND` and stays green as it is.

### Decisions that await the user's sign-off

1. **Pasting or dropping the one character that completes a shortcut no longer applies it.** Today `a \*x` with `*` pasted after the `x` goes italic. Recommended: a paste is not typing, so it applies nothing, like every longer paste today.
2. **A text replacement counts as typing.** Autocorrect and the macOS double-space full stop act while the user types, so `1` and two spaces on macOS still starts a numbered list. This is today's behaviour. The other choice is to count it as not typing; a spelling picked from a menu would then be the same, and it ends in a letter, which completes no shortcut either way.
3. **Text that changes with no input event completes no shortcut.** A browser extension that rewrites text in place is not the user typing. Today it can complete one.
4. **The Enter path stays, for every marker.** The other choice is to keep it for the code fence alone, so that Enter after a literal `- ` starts a new paragraph. That is a change to `SHORTCUT_TRANSFORMERS` in `markdownTransformers.ts` and can be made later without touching this plan's code.
5. **A completed shortcut stays two undo steps.** No change.

No consumer has to act on any of them: no API changes, and `paste()`, `cut()` and the keyboard keep their results except where a shortcut was applied by them.

### Results that change

Measured in Chromium with real keys, the parent against the prototype (this plan's code in a private copy of the tip); the drop's input event was built by script:

| Edit | Before | After |
|---|---|---|
| `\- .cd`, caret after `.`: Backspace or Ctrl+Backspace | list item `- cd`; two undos back | paragraph showing `- cd`, saved `\- cd`; one undo back |
| `a \*x\*.b`: Backspace after the `.`, or the `.` selected and Delete or Ctrl+X | `a *x*b`, `x` italic | `a \*x\*b`, text |
| `a \*x b`, `*` pasted after `x` | `a *x* b` | `a \*x\* b` |
| the same with `*` dropped there | `a *x* b` | `a \*x\* b` |
| `\- x`, Backspace over `x`, then Enter | Backspace makes the list item; Enter leaves the list | Backspace leaves text; Enter makes the list item |

The same holds for the other kinds: in Chromium a bullet, italic, inline code, a heading and a link were run, at command level all 14. Nothing else changes: every shortcut typed key by key gives what it gave, in a paragraph, a heading, a list item, a quote and a table cell.[^matrix-a]

---

## Public API

None. `TYPED_TEXT_TAG` and `registerTypedTextMarks` are module-private.

---

## Internal Structure

All code goes in [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts). The snippets are the code the measurements were taken with.

### Imports

Add to the existing `import { … } from "lexical"` list ([MarkdownEditor.ts:19](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L19)), where not there already: `BEFORE_INPUT_COMMAND`, `INPUT_COMMAND`, `COMMAND_PRIORITY_EDITOR`, `COMPOSITION_END_TAG`. `CONTROLLED_TEXT_INSERTION_COMMAND`, `COMMAND_PRIORITY_CRITICAL`, `$addUpdateTag` and `mergeRegister` are imported already.

### The marks

Insert this block right before the JSDoc of `registerMarkdownShortcutsOutsideRawBlocks`, that is right after `$declinesFormat` ([MarkdownEditor.ts:3522](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3522)).

```ts
/**
 * The update tag of an update Lexical makes while it handles input that
 * types text ({@link registerTypedTextMarks}). The Markdown typing shortcuts
 * are applied by typing alone
 * ({@link registerMarkdownShortcutsOutsideRawBlocks}).
 */
const TYPED_TEXT_TAG = "markdown-typed-text";

/**
 * The `inputType`s of the input events that type text: a character from the
 * keyboard, an input method or dictation (`insertText`), text being composed
 * and its commit (`insertCompositionText`, and `insertFromComposition`, which
 * Safari sends), and a replacement the browser makes for what was typed —
 * autocorrect, a text substitution, a picked spelling
 * (`insertReplacementText`). A paste, a drop, a yank and every deletion have
 * other types.
 */
const TYPING_INPUT_TYPES: ReadonlySet<string> = new Set([
    "insertText", "insertCompositionText", "insertFromComposition", "insertReplacementText",
]);

/** What {@link registerTypedTextMarks} returns. */
interface TypedTextMarks {
    /** Removes the listeners. */
    unregister:    () => void;

    /** Whether an update that carries these tags typed text. */
    isTypedUpdate: (tags: ReadonlySet<string>) => boolean;
}

/**
 * Whether what a text-insertion command carries is typed text. Lexical
 * hands a typed character over as a string, and a composition's commit, a
 * text replacement, a drop and a yank as their input event.
 *
 * @param payload - The command's payload.
 * @returns Whether it is typed text.
 */
function isTypedPayload(payload: InputEvent | string): boolean {
    return typeof payload === "string" || TYPING_INPUT_TYPES.has(payload.inputType);
}

/**
 * Marks the updates that type text, for the Markdown typing shortcuts
 * ({@link registerMarkdownShortcutsOutsideRawBlocks}): a shortcut is applied
 * by typing, never by a removal, a paste, a drop, an undo, a command or a
 * change of the text with no input behind it.
 *
 * @remarks
 * Typed text reaches Lexical by three commands, and each tags its update
 * {@link TYPED_TEXT_TAG} when its input types text
 * ({@link TYPING_INPUT_TYPES}): `BEFORE_INPUT_COMMAND` and `INPUT_COMMAND`,
 * which carry the browser's input event, and
 * `CONTROLLED_TEXT_INSERTION_COMMAND`, by which Lexical inserts the text
 * itself. The end of a composition has Lexical's own `COMPOSITION_END_TAG`.
 *
 * A browser may also put a typed character in by itself, and Lexical may
 * read it off the DOM in an update with no command — before the `input`
 * event's command, where another listener runs ahead of Lexical's. So a
 * `beforeinput` of typed text that Lexical left to the browser (it is not
 * prevented) makes every update typed until its `input` event arrives.
 *
 * The first two listeners are at {@link COMMAND_PRIORITY_CRITICAL}, ahead of
 * Lexical's own handlers, which end their commands. The third is at
 * {@link COMMAND_PRIORITY_EDITOR}, the priority of `registerRichText`'s
 * handler that inserts the text: call this before `registerRichText`, so
 * that the tag is set in the update that holds the text. A command
 * dispatched outside an update runs each priority's listeners in an update
 * of their own, and a tag set at a higher priority would be lost with that
 * update when it changes nothing.
 *
 * @param editor - The editor.
 * @returns The unregister function and the test of an update's tags.
 */
function registerTypedTextMarks(editor: LexicalEditor): TypedTextMarks {
    // The `beforeinput` of typed text seen last, until its `input` event arrives.
    let awaited: InputEvent | null = null;

    const tagWhenTyping = (isTyping: boolean): void => {
        if (isTyping) {
            $addUpdateTag(TYPED_TEXT_TAG);
        }
    };

    const unregister = mergeRegister(
        editor.registerCommand(BEFORE_INPUT_COMMAND, (event) => {
            const isTyping = TYPING_INPUT_TYPES.has(event.inputType);

            awaited = isTyping ? event : null;
            tagWhenTyping(isTyping);

            return false;
        }, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(INPUT_COMMAND, (event) => {
            awaited = null;
            tagWhenTyping(TYPING_INPUT_TYPES.has(event.inputType));

            return false;
        }, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(CONTROLLED_TEXT_INSERTION_COMMAND, (payload) => {
            tagWhenTyping(isTypedPayload(payload));

            return false;
        }, COMMAND_PRIORITY_EDITOR),
    );

    const isTypedUpdate = (tags: ReadonlySet<string>): boolean => {
        const isAwaited = awaited !== null && !awaited.defaultPrevented;

        return tags.has(TYPED_TEXT_TAG) || tags.has(COMPOSITION_END_TAG) || isAwaited;
    };

    return { unregister, isTypedUpdate };
}
```

How `isTypedUpdate` decides, by example:

| Update | `TYPED_TEXT_TAG` | `COMPOSITION_END_TAG` | A typed `beforeinput` awaits its `input`, not prevented | Typed |
|---|---|---|---|---|
| Lexical inserts a typed `*` (path 1) | yes | no | no: it was prevented | yes |
| Lexical reads a typed `*` off the DOM in the `input` event's update (path 2) | yes | no | no: the `input` event cleared it | yes |
| Lexical reads a typed `*` off the DOM before the `input` event (path 2, the other order) | no | no | yes | yes |
| a composition ends (paths 3, 4) | no | yes | no | yes |
| Backspace removes a `.` | no | no | no | no |
| a paste inserts `*` | no | no | no | no |
| a typed `beforeinput` was prevented and nothing inserted; then a command removes text | no | no | no: prevented | no |

### The wrapper

In `registerMarkdownShortcutsOutsideRawBlocks` ([MarkdownEditor.ts:3546](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3546)) change the signature and the update listener. The rest of the function stays.

```ts
function registerMarkdownShortcutsOutsideRawBlocks(editor: LexicalEditor, isTypedUpdate: (tags: ReadonlySet<string>) => boolean): () => void {
    const registerUpdateListener = (listener: UpdateListener): (() => void) =>
        editor.registerUpdateListener((payload) => {
            const isTyped = isTypedUpdate(payload.tags);

            if (!isTyped) {
                return;
            }

            const inRawBlock = payload.editorState.read($isSelectionInRawBlock);

            if (!inRawBlock) {
                listener(payload);
            }
        });
```

The typed test comes first because it reads no editor state.

Replace the first paragraph of the function's JSDoc and add a paragraph to its `@remarks`, and add the `@param`:

```ts
/**
 * Registers the Markdown typing shortcuts everywhere except inside a raw
 * Markdown block, whose text is saved as Markdown: a shortcut there would turn
 * typed syntax into formatting the block does not save. A shortcut is
 * applied by typing alone: an update that removes, cuts, pastes or drops
 * completes none, however the text before the caret reads when it ends.
 *
 * @remarks
 * `registerMarkdownShortcuts` takes any update that leaves a collapsed
 * caret in changed text, at most one character further on than it was, for
 * a typed character. A Backspace is such an update, and so is the removal
 * of a range: `a \*x\*.b` with the `.` removed read as a typed `*x*` and
 * went italic, as an update of its own. So its update listener is handed an
 * update only when the update typed text (`isTypedUpdate`). Its Enter
 * listener is left as it is: Enter is a key press.
 *
 * (the existing remarks paragraph, unchanged)
 *
 * @param editor - The editor.
 * @param isTypedUpdate - Whether an update that carries the given tags typed text ({@link registerTypedTextMarks}).
 * @returns The unregister function.
 */
```

### The registration

In `buildEditor` ([MarkdownEditor.ts:7545](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7545)), right before `this._unregister = mergeRegister(` ([:7569](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7569)):

```ts
        // Before `registerRichText`, whose handler of the text-insertion command, at the same priority, inserts the text.
        const typedTextMarks = registerTypedTextMarks(editor);
```

In the list, add `typedTextMarks.unregister,` right after `unregisterWritableStateRules,` and change the shortcut line ([:7575](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7575)) to:

```ts
            registerMarkdownShortcutsOutsideRawBlocks(editor, typedTextMarks.isTypedUpdate),
```

`registerWritableStateRules` is registered ahead of the list the same way ([MarkdownEditor.ts:7547](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7547)).

### Tests that type

Three test helpers "type" by calling `selection.insertText` in an update of their own, with no command. That is path 15 of the table, which is not typing any more. Each is changed to dispatch the command a keystroke dispatches. Their tests then exercise the shortcut path as they were written to.[^helpers]

In `markdown-editor-command-crashes.test.ts`, `typeChar` ([:969](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts#L969)):

```ts
/**
 * Types one character at the selection with the command a keystroke
 * dispatches, in an update of its own, so the typing shortcuts see it.
 *
 * @param editor - The editor.
 * @param char - The character.
 */
async function typeChar(editor: MarkdownEditor, char: string): Promise<void> {
    const lexical = lexicalOf(editor);

    lexical.update(() => {
        lexical.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, char);
    }, { discrete: true });
    await Promise.resolve();
}
```

In `markdown-importer.test.ts`, add `CONTROLLED_TEXT_INSERTION_COMMAND` to the `lexical` import. Delete the helper `type` ([:865–879](../packages/lib/tests/component/markdown-importer.test.ts#L865), its only caller is `typeStar`). Change `typeStar` ([:1022](../packages/lib/tests/component/markdown-importer.test.ts#L1022)) and the loop of `typeChars` ([:2944](../packages/lib/tests/component/markdown-importer.test.ts#L2944)):

```ts
    /** Types `*` at the selection with the command a keystroke dispatches, in its own update. */
    function typeStar(editor: MarkdownEditor): void {
        const lexical = lexicalOf(editor);

        lexical.update(() => {
            lexical.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, '*');
        }, { discrete: true });
    }
```

```ts
        function typeChars(editor: MarkdownEditor, text: string): void {
            const lexical = lexicalOf(editor);

            for (const char of text) {
                edit(editor, () => {
                    lexical.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, char);
                });
            }
        }
```

In `typeChars`'s comment, replace "each in its own update, as the keyboard does" with "with the command a keystroke dispatches, each in its own update".

---

## Ordered Implementation Steps

1. **Find the base.** From `packages/lib`: `grep -c 'registerTypingTags\|caretTextGrew\|UNTYPED_EDIT_TAG' src/typescript/lib/component/editor/MarkdownEditor.ts`. `0` means the first version of the rule is not below: skip step 2.
2. **Only when step 1 printed more than 0: remove the first version.** In `MarkdownEditor.ts` delete `UNTYPED_EDIT_TAG`, `registerTypingTags`, `NO_TEXT_SIZE`, `caretTextGrew`, the three-argument `isTypedUpdate`, the old `TYPED_TEXT_TAG` with its comment, and the line `registerTypingTags(editor),` in `buildEditor`. Leave `cut()`'s `tag: CUT_TAG` and its doc sentence as they are. Remove from the `lexical` imports whatever only those used (`EditorState` as a type, if nothing else uses it). Check: `grep -c 'registerTypingTags\|caretTextGrew\|UNTYPED_EDIT_TAG\|NO_TEXT_SIZE' …/MarkdownEditor.ts` prints 0. The file will not compile until step 6.
3. **Write the test file.** Create `packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts` with the content of *Addendum: The test file*. When the file exists, replace it whole.
4. **Change the three test helpers** of *Tests that type*.
5. **See the tests fail.** From `packages/lib`: `npx vitest run tests/component/markdown-editor-typing-shortcuts.test.ts`. On the tip without the first version, 57 of its 90 tests fail: every TY1, TY4, TY5 and TY6 test, and the bullet row of TY8. TY2, TY3, TY7 and the other TY8 rows pass. On a base that had the first version (step 2 done), skip this run: the file does not compile yet.
6. **Add the imports, the marks, the wrapper change and the registration** of *Internal Structure*, in that order. Check: `grep -n 'isTypedUpdate' …/MarkdownEditor.ts` prints at least six lines, the last of them the `buildEditor` line `registerMarkdownShortcutsOutsideRawBlocks(editor, typedTextMarks.isTypedUpdate),`; `grep -c 'payload.prevEditorState' …/MarkdownEditor.ts` prints 0.
7. **Run the tests again.** `npx vitest run tests/component/markdown-editor-typing-shortcuts.test.ts tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-importer.test.ts`: all pass.
8. **Look for other tests that type without a command.** `grep -n 'insertText(' tests/component/markdown-*.test.ts`. For each hit inside a helper whose comment says it types as a keystroke does, and whose test expects a typing shortcut to apply or to be declined, make the change of step 4. On the tip there are no others.[^helpers]
9. **Run the browser check** of *Browser check* below. It must end with `ALL ROWS PASS`.
10. **Write the docs** of *Documentation Impact*.
11. **Run everything in *Verification*.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Create (replace when the base has it) | `packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Rows in `markdown-editor-typing-shortcuts.test.ts`

Unit-testable, at command level. Each row runs for the 14 kinds of shortcut text (`KINDS` in the file). A kind is Markdown whose escaped text reads as the shortcut's syntax once one character is removed, for example `a \*x\*;b` for italic, where `;` is the character a row removes.

| Row | What is done | Expected |
|---|---|---|
| TY1 | The `;` is removed six ways (Delete, Backspace, a word delete, a line delete, `REMOVE_TEXT_COMMAND`, `cut()`), selected forwards and backwards, the command inside an update and outside | The text stays text (`a \*x\*b`). One undo gives the loaded Markdown. |
| TY2 | The character that completes the kind is typed, by each of eight routes (below) | The shortcut is applied (`a *x*b`). Undo: the typed text, then the text before it. Redo: the typed text, then the shortcut. |
| TY3 | The character is composed: it goes in while a composition runs, then the update that ends the composition | Not applied while composing; applied at the end. |
| TY4 | The character is pasted or dropped five ways (`PASTE_COMMAND`, `paste()`, pasted nodes, an `insertFromDrop` event, an `insertFromYank` event) | The text stays text. |
| TY5 | The `;` is removed with no removal command, four ways (below) | The text stays text. |
| TY6 | The character is put in by an update with no input event behind it | The text stays text. |
| TY7 | With ` zz` selected in `a \*x zz b`, forwards and backwards, `*` is typed | `a *x* b`. Undo: `a \*x\* b`, then the loaded Markdown. |
| TY8 | Enter at the end of a block whose text is ` ``` `, ` ```js `, `- ` or `# ` | The block is converted: a code block, a code block with its language, an empty list item, an empty heading. |

The eight typing routes of TY2 are the table's paths as the harness can produce them:

| Route | Path |
|---|---|
| the text-insertion command with the character, inside an update and outside | 1 |
| a `beforeinput` left to the browser, then the `input` event whose update reads the text | 2 |
| a `beforeinput` left to the browser, the text read in an update with no command, then the `input` event | 2, the other order |
| the text-insertion command with an `insertFromComposition` event, inside an update and outside | 5 |
| the text-insertion command with an `insertReplacementText` event, carrying its text as data and as a data transfer | 7 |

The four removals of TY5:

| Removal | Why it must not complete a shortcut |
|---|---|
| an update with no command and no input event | path 15 |
| a `deleteContentBackward` left to the browser, then the `input` event whose update reads the text | path 12 |
| a typed `beforeinput` that was prevented, then an update with no command | a prevented `beforeinput` awaits nothing |
| a typed `beforeinput` whose `input` event has arrived, then an update with no command | the `input` event ended the wait |

Lexical's own `beforeinput` and `input` handlers read a browser's DOM selection and cannot run in the harness. The file's helper `standInForLexicalInputHandlers` takes the two commands after the editor's listeners and before Lexical's, and does what Lexical's `input` handler does: it writes the text the browser changed into the node.

### Rows that change in existing files

None changes its expectation. `O2` and `O3` of `markdown-editor-command-crashes.test.ts` and six tests of `markdown-importer.test.ts` type through the changed helpers and keep their expectations.[^helpers]

### Browser check

Scripted, as for the unit rows but with real input: real key events, real compositions through the DevTools protocol, and input events built by script where Chromium cannot produce the event itself. The scripts are outside the repo, in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/text-input/browser/` (`$B` below). Never copy them into the repo.

1. Serve the branch's demo: `node $B/serve.mjs <branch worktree>/packages/lib 5451 &`. The worktree needs `node_modules` and `packages/lib/node_modules` symlinked to the main tree's.
2. Start a browser: `chromium-browser --headless=new --remote-debugging-port=9451 --no-first-run --disable-gpu --window-size=1400,900 --incognito about:blank &`.
3. `node $B/check2.mjs 5451`. It prints one `PASS` or `FAIL` line per row and ends with `ALL ROWS PASS` and exit code 0.
4. Stop both processes.

The script runs two matrices and compares each row with a stored expectation.

**Matrix A, 85 rows: every shortcut still applies when typed.** Seventeen shortcut texts (` *x*`, ` **x**`, `` `x` ``, ` ~~x~~`, ` ++x++`, ` [t](u)`, `- `, `* `, `+ `, `1. `, `7. `, `# `, `### `, `###### `, `> `, ` ``` `, ` ```js `) are typed key by key in a paragraph, a heading, a list item, a quote and a table cell, followed by undos. The expectation is what the parent gives: this plan must change no row.[^matrix-a]

**Matrix B, 62 rows: what applies a shortcut and what does not.**

| Rows | Input | Expected |
|---|---|---|
| Backspace, Ctrl+Backspace, a selected `.` then Delete, then Ctrl+X; for a bullet, italic, inline code, a heading and a link | real keys | the text stays text; one undo gives the loaded text |
| Delete with a collapsed caret, same five | real key | the text stays text (as before the change) |
| Ctrl+V of the completing character; for italic, inline code, a bullet and a link | real keys, real clipboard | the text stays text |
| the completing character typed | real key | applied |
| the character committed by a composition, and by a dead-key-style composition (`´` first, then the character) | `Input.imeSetComposition`, `Input.insertText` | applied |
| the character entered with no composition | `Input.insertText` | applied |
| an `insertFromComposition` event carrying the character | a `beforeinput` built by script | applied |
| an `insertReplacementText` event carrying the character | a `beforeinput` built by script | applied |
| an `insertFromDrop` event carrying the character | a `beforeinput` built by script | the text stays text |
| ` *x*` typed, three undos, three redos | real keys | `host *x*`, `host \*x\*`, `host`, …, back to `host *x*` |
| `\- x`: Backspace, then Enter | real keys | text `- ` after Backspace; an empty list item after Enter |
| ` ``` ` then Enter | real key | a code block |
| `*` typed over a selection | real key | applied |

The script-built events stand in for input Chromium does not produce: it never sends `insertFromComposition`, and a drop needs a pointer drag. They exercise Lexical's handling of the event and the editor's rule; they are not a run of WebKit or of a real drag.

On the parent the script fails 27 rows, all in matrix B: the removals, the cuts, the pastes, the drops and the Backspace-then-Enter rows. With the change it passes all 147.[^check-runs]

**The order Firefox may take.** `node $B/p2d.mjs 5451` prints, for four shortcuts typed at the end of a paragraph, the order of Lexical's commands and updates under a simulation: Lexical is kept from seeing the `textInput` event and a window listener runs ahead of its `input` handler. Lexical then reads the typed character off the DOM before the `input` event's command. Expected in the output: each `order:` line shows an `update tags=[]` before `cmd INPUT_COMMAND`, and each shortcut is applied (`host *x*…`). The result also shows the character once more after the formatted text (`host *x*\*`). The parent does the same under this simulation, so this plan neither causes nor cures it; see *Non-Goals*.[^firefox-order]

### Manual checks in browsers not run here

Do these on the branch's demo, **MD Editor** page, and record each result in the Implementation Notes. A check that fails is reported, not worked around.

1. **Safari on macOS, Swedish layout — a dead key completes a shortcut.** Type `a `, then a backtick (Shift+`´`, then Space), `x`, then a backtick again. `x` must become inline code. Then type ` ~~y~~` with the tilde from Option+`¨` followed by Space: `y` must be struck through.
2. **Safari on macOS — a deletion completes none.** Switch to source mode, replace the document with `a \*x\*.b`, switch back, place the caret after the `.` and press Backspace. The text must stay `a *x*b` with the asterisks showing, not italic.
3. **Firefox on Windows, Microsoft Japanese IME — a composition's commit completes a shortcut.** With the IME off type `a *x`. Turn the IME on (Hiragana), type `*` (it shows `＊` underlined), press F10 (it becomes `*`), press Enter. `x` must become italic. Do the same in Chrome or Edge as a control.
4. **Firefox — a typed shortcut, and nothing after it.** Type ` *y*` at the end of a paragraph. `y` must become italic and no `*` may follow it.
5. **Firefox — a deletion completes none.** As check 2.
6. **Chrome on Android, Gboard.** Type `- item` at the start of an empty paragraph: a list item. Type ` **b**`: bold. Then do check 2 with the on-screen Backspace.

---

## Verification

- `npm run typecheck` and `npm -w packages/lib run typecheck:test` (repo root).
- `npm run lint` (repo root): zero errors.
- From `packages/lib`: `npx vitest run tests/component/markdown-editor-typing-shortcuts.test.ts tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-importer.test.ts`: every test passes.
- `npm test` (repo root): the full suite is green.
- `npm run docs:api` (repo root).
- The greps of steps 1, 2 and 6.
- The browser check: `ALL ROWS PASS`.
- **The differential check against the parent.** Two harnesses, both outside the repo, in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/` (`$K` below). They work on private copies of a commit, never in a worktree. Run no other Vitest process meanwhile: this machine allows two at a time.
  1. `$K/plans3/text-input/mkcopy.sh parent <parent commit>` and `$K/plans3/text-input/mkcopy.sh branch <branch tip commit>`.
  2. **Random edits around shortcut text.** For each of the seeds 1, 2 and 3, and for `parent` and `branch`: copy `$K/plans3/text-input/zz-p2-diff.test.ts` into `copies/<name>/packages/lib/tests/component/`, and from that `packages/lib` run `P2D_SEED=<seed> P2D_N=4000 P2D_OUT=$K/plans3/text-input/p2d-<name>-<seed>.json npx vitest run tests/component/zz-p2-diff.test.ts --maxWorkers=1`. Then, in `$K/plans3/text-input/`, `python3 p2diff.py p2d-parent-<seed>.json p2d-branch-<seed>.json`. Each of the three must print `hard check … : 0` and exit 0. The hard check: the first step at which the two saves differ is a step that typed nothing (a cut, a drop, a paste, a removal) at which the parent applied a shortcut and the branch did not.[^differential]
  3. **The seeded fuzz harnesses.** `$K/plans3/text-input/runfuzz2.sh branch $K/plans3/text-input/copies/branch`. It runs for about 40 minutes and writes `fuzz-branch/`, `lif-branch/`, `lifx-branch/` and `r7-branch/` in `$K/plans3/text-input/`. Compare every `*.json` in them with the file of the same name in `$K/impl/raw-block-edge-cases/fuzz-b6/`, `lif-b6/`, `lifx-b6/` and `r7-b6/`. `cmp` must report no difference for any of the 71 files.[^fuzz]

---

## Documentation Impact

No public API changes. Two text edits. When the base has the first version of the rule, both texts exist in that version's wording and are replaced.

**`packages/lib/docs/components/MarkdownEditor.md`**, the first bullet under `## Formatting` (line 105). Replace it with:

> - **Markdown-shortcut typing** — `# ` → heading, `**b**` → bold, `- ` → bullet, `1. ` → numbered, `> ` → quote, ` ``` ` → code block, applied as you type. A shortcut is applied by typing only — a key, text composed with an input method, an autocorrection. Deleting, cutting, pasting or dropping text applies none, whatever the text before the caret then reads as. One undo takes a shortcut back and leaves the characters as typed.

**`packages/lib/docs/reference/changelog/next.md`** → `## Fixed` → `### Components`, appended (or in place of the entry "A Markdown typing shortcut is applied for typed text only." when the base has it):

> - **A Markdown typing shortcut in `MarkdownEditor` is applied by typing
>   only.** Deleting or cutting text applied a shortcut when the text left
>   before the caret read as one: `\- .text` with the `.` removed by
>   Backspace became a list item, and `a \*x\*.b` went italic, each as a
>   second undo step. Pasting or dropping the one character that completes a
>   shortcut applied it too. A shortcut is now applied by a typed key, text
>   composed with an input method and an autocorrection, and by nothing
>   else. Enter after a marker or a code fence opener converts the block as
>   before. No consumer action is needed.

No migration note: no consumer has to act.

---

## Potential Challenges

- **A listener at the wrong priority loses its tag.** The `CONTROLLED_TEXT_INSERTION_COMMAND` listener must be at `COMMAND_PRIORITY_EDITOR` and registered before `registerRichText`. TY2's route "outside any update" fails otherwise.
- **`markdown-editor-typing-at-link-start-swallowed` adds a line at the same place in `buildEditor`.** Either plan can go first; keep both lines.
- **`markdown-editor-readonly-keyboard-selection` is open on top of the same tip.** It registers `beforeinput` and `input` listeners on the editor's surface for a read-only editor. Lexical dispatches no input command in a read-only editor, so the two do not meet. Its listeners are of the kind that can run ahead of Lexical's `input` handler, which is the order the awaited `beforeinput` exists for.
- **A plan that removes text outside a command needs no mark.** `markdown-editor-cross-item-range-removal` and `markdown-editor-raw-block-range-edits` note that a new removal route "would have to tag its update". Under this plan an update with no typing mark completes no shortcut, so they need nothing.
- **The test stand-in hides Lexical's handlers.** `standInForLexicalInputHandlers` must be unregistered at the end of each route, as the file does; a leftover would end the commands for the next route.

---

## Critical Files

- [MarkdownEditor.ts:3525–3592](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3525) — `registerMarkdownShortcutsOutsideRawBlocks`: the wrapper this plan extends, and the precedent for deciding per update what Lexical's listener sees.
- [MarkdownEditor.ts:7545–7591](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7545) — `buildEditor`: the registration order.
- [markdownTransformers.ts](../packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts) — `SHORTCUT_TRANSFORMERS`: the eleven shortcuts.
- `node_modules/@lexical/markdown/src/MarkdownShortcuts.ts:437–670` — `registerMarkdownShortcuts`: the update listener's conditions and the Enter listener.
- `node_modules/lexical/src/LexicalEvents.ts` — `onBeforeInput` (815), `$handleBeforeInput` (849, the `inputType` switch at 1055–1194), `onInput` (1199), `$handleInput` (1227), `$handleCompositionEnd` (1421), `onCompositionEnd` (1541).
- `node_modules/lexical/src/LexicalMutations.ts:143` — `flushMutations`: when Lexical reads typed text off the DOM outside the `input` event.
- `node_modules/lexical/src/LexicalUpdates.ts:878` — `triggerCommandListeners`: one update per priority when a command is dispatched outside an update.
- `node_modules/@lexical/rich-text/src/index.ts:1195` — the handler of `CONTROLLED_TEXT_INSERTION_COMMAND`.

---

## Non-Goals

- **Changing the Enter path.** Sign-off 4.
- **Merging the shortcut's undo step with its character.** Sign-off 5.
- **The character repeated after a shortcut under the simulated Firefox order.** In the simulation Lexical applies the shortcut from the update that read the character off the DOM, and its `input` handler then inserts the character again. The parent does the same. Whether Firefox takes that order at all could not be run here; manual check 4 answers it. If it fails, it is a defect of its own, present before this plan.
- **A block shortcut typed at the start of a table cell.** On the tip, `- `, `# ` or `> ` typed at a cell's start disappears and the cell stays as it was. Matrix A pins what the parent gives, this included. It is a defect of its own.
- **`insertTranspose`.** macOS Ctrl+T reaches Lexical's text-insertion command as a string and so counts as typing. It swaps two characters and is left as Lexical treats it.

---

## Addendum: Measurements

Outputs are in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/text-input/` (`browser/` for the Chromium runs).

**At command level, 14 kinds each** (`p2-offline-tip.json`, `p2-offline-proto.json`):

| Route | Parent | With the change |
|---|---|---|
| eight typing routes; a composition's end | applied, 2 undo steps | the same |
| paste (3 routes), drop, yank, an update with no input | applied | text |
| six removal commands in four variants; four removals with no removal command | applied, 2 undo steps | text, 1 undo step |
| Enter after a fence opener or a marker; a character typed over a selection | converted; applied | the same |

**In Chromium with real keys** (`p2a-tip.json`, `p2a-final.json`, `p2b-tip.json`, `p2b-final.json`): matrix A is identical on parent and prototype, 85 of 85 rows. Matrix B differs in the removal, cut, paste and drop rows and in the Backspace-then-Enter row, as *Results that change* lists, and nowhere else.

**The existing suites** (`run-final.json`): with the three helpers changed, the Markdown suites pass on the prototype: 9,060 tests in 22 files, which are the 8,951 that existed, this plan's 90 and the 19 of `markdown-editor-typing-at-link-start-swallowed`, whose change was in the same copy. The rest of the repository's suite was not run on the prototype. With the helpers unchanged, three tests fail, the three whose typing was an update with no command: `O3`, and the two "control" tests of `markdown-importer.test.ts` that expect a typed shortcut to apply.

**Random edits** (`p2d-*.json`): 12,000 documents of up to 8 random steps each, three seeds. 442 documents differ between parent and prototype. In every one the first difference is a step that typed nothing — 176 removals of a selection, 109 pastes, 104 cuts, 53 drops — at which the parent applied a shortcut and the prototype did not. Typing steps applied 382 shortcuts before any difference, the same on both.

**The seeded fuzz harnesses** (`fuzz-p2/`, `lif-p2/`, `lifx-p2/`, `r7-p2/`): all 71 outputs are byte-identical to the baselines of the parent's source.

---

## Addendum: The test file

`packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts`, whole. A copy that was run is at `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/text-input/markdown-editor-typing-shortcuts.test.ts`; the two must be the same.

````ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor's typing shortcuts are applied by typing alone
// (plans/markdown-editor-typing-shortcuts-only-for-typing.md): a removal, a
// paste, a drop or text that arrives with no input event completes none,
// however the text before the caret reads afterwards; a typed character, the
// end of a composition and a text replacement still do, on every route a
// browser hands them to Lexical by.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createRangeSelection, $createTextNode, $getSelection, $isRangeSelection, $isTextNode, $setCompositionKey, $setSelection,
    BEFORE_INPUT_COMMAND, COMMAND_PRIORITY_HIGH, COMPOSITION_END_TAG, CONTROLLED_TEXT_INSERTION_COMMAND, DELETE_CHARACTER_COMMAND,
    DELETE_LINE_COMMAND, DELETE_WORD_COMMAND, INPUT_COMMAND, KEY_ENTER_COMMAND, PASTE_COMMAND, REDO_COMMAND, REMOVE_TEXT_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { LexicalCommand, LexicalEditor, TextNode } from 'lexical';
import { $insertGeneratedNodes } from '@lexical/clipboard';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => {
    installTestDOM(CONFIG);

    // `registerRichText`'s handlers tell clipboard, drag, input and key events apart by class name.
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
    vi.stubGlobal('DragEvent', class DragEvent {});
    vi.stubGlobal('InputEvent', class InputEvent {});
    vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});
});
afterEach(() => {
    DOM.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** Stands in a row's Markdown for the one character a row removes: it reads as itself and needs no escape. */
const REMOVED = ';';

/**
 * One kind of typing shortcut: a name; Markdown whose escaped text reads as
 * the shortcut's syntax, complete, once the {@link REMOVED} character is
 * gone and the caret stands in its place; the save of that text, still
 * text; and what the shortcut makes of it when its last character is typed.
 */
type Kind = readonly [name: string, source: string, text: string, applied: string];

const KINDS: readonly Kind[] = [
    ['italic', 'a \\*x\\*;b', 'a \\*x\\*b', 'a *x*b'],
    ['bold', 'a \\*\\*x\\*\\*;b', 'a \\*\\*x\\*\\*b', 'a **x**b'],
    ['inline code', 'a \\`x\\`;b', 'a \\`x\\`b', 'a `x`b'],
    ['strikethrough', 'a \\~\\~x\\~\\~;b', 'a \\~\\~x\\~\\~b', 'a ~~x~~b'],
    ['underline', 'a \\+\\+x\\+\\+;b', 'a \\+\\+x\\+\\+b', 'a ++x++b'],
    ['a link', 'a \\[t\\](u);b', 'a \\[t\\]\\(u)b', 'a [t](u)b'],
    ['a bullet', '\\- ;cd', '\\- cd', '- cd'],
    ['a bullet written with a star', '\\* ;cd', '\\* cd', '- cd'],
    ['a bullet written with a plus', '\\+ ;cd', '\\+ cd', '- cd'],
    ['a list number', '1\\. ;cd', '1\\. cd', '1. cd'],
    ['a heading', '\\# ;cd', '\\# cd', '# cd'],
    ['a level 3 heading', '\\### ;cd', '\\### cd', '### cd'],
    ['a quote', '\\> ;cd', '\\> cd', '> cd'],
    ['a code fence', '\\`\\`\\` ;cd', '\\`\\`\\` cd', '```\ncd\n```'],
];

/** One way of removing a selection. */
type Removal = 'Delete' | 'Backspace' | 'word delete' | 'line delete' | 'REMOVE_TEXT_COMMAND' | 'cut()';

const REMOVALS: readonly Removal[] = ['Delete', 'Backspace', 'word delete', 'line delete', 'REMOVE_TEXT_COMMAND', 'cut()'];

/** One way of inserting text that is not typing it. */
type Insertion = 'PASTE_COMMAND' | 'paste()' | 'paste nodes' | 'drop insert' | 'yank insert';

const INSERTIONS: readonly Insertion[] = ['PASTE_COMMAND', 'paste()', 'paste nodes', 'drop insert', 'yank insert'];

/** Whether a range is dragged from its end to its start, and whether a command is dispatched inside one update. */
const VARIANTS: ReadonlyArray<readonly [backward: boolean, inUpdate: boolean]> = [[false, true], [false, false], [true, true], [true, false]];

/**
 * Reaches the private headless Lexical editor.
 *
 * @param editor - The Markdown editor.
 * @returns Its Lexical editor.
 */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/**
 * Loads `source` into a fresh editor.
 *
 * @param source - The Markdown to load.
 * @returns The editor.
 */
function load(source: string): MarkdownEditor {
    const editor = new MarkdownEditor();

    editor.setValue(source);

    return editor;
}

/**
 * Loads a kind's Markdown and selects, in the text node that holds the
 * {@link REMOVED} character, that character with the `before` characters
 * ahead of it.
 *
 * @param source - The Markdown.
 * @param before - How many characters ahead of the removed one the range takes in.
 * @param backward - Whether the range is dragged from its end to its start.
 * @returns The editor.
 */
function select(source: string, before: number, backward: boolean): MarkdownEditor {
    const editor = load(source);

    lexicalOf(editor).update(() => {
        const node = $dfs().map((entry) => entry.node).find((found) => $isTextNode(found) && found.getTextContent().includes(REMOVED)) as TextNode;
        const at = node.getTextContent().indexOf(REMOVED);
        const selection = $createRangeSelection();
        const [anchor, focus] = backward ? [at + 1, at - before] : [at - before, at + 1];

        selection.anchor.set(node.getKey(), anchor, 'text');
        selection.focus.set(node.getKey(), focus, 'text');
        $setSelection(selection);
    }, { discrete: true });

    return editor;
}

/**
 * Dispatches a command, inside one update as a browser's key and input events do, or outside any.
 *
 * @param editor - The editor.
 * @param command - The command.
 * @param payload - Its payload.
 * @param inUpdate - Whether to dispatch inside an update.
 */
function dispatch<P>(editor: MarkdownEditor, command: LexicalCommand<P>, payload: P, inUpdate: boolean): void {
    const lexical = lexicalOf(editor);

    if (inUpdate) {
        lexical.update(() => { lexical.dispatchCommand(command, payload); }, { discrete: true });
    } else {
        lexical.dispatchCommand(command, payload);
    }
}

/**
 * Removes the editor's selection one way.
 *
 * @param editor - The editor.
 * @param removal - The way.
 * @param inUpdate - Whether a command is dispatched inside an update.
 */
function remove(editor: MarkdownEditor, removal: Removal, inUpdate: boolean): void {
    switch (removal) {
        case 'Delete': dispatch(editor, DELETE_CHARACTER_COMMAND, false, inUpdate); break;
        case 'Backspace': dispatch(editor, DELETE_CHARACTER_COMMAND, true, inUpdate); break;
        case 'word delete': dispatch(editor, DELETE_WORD_COMMAND, false, inUpdate); break;
        case 'line delete': dispatch(editor, DELETE_LINE_COMMAND, true, inUpdate); break;
        case 'REMOVE_TEXT_COMMAND': dispatch(editor, REMOVE_TEXT_COMMAND, null, inUpdate); break;
        case 'cut()': editor.cut(); break;
    }
}

/**
 * A data transfer holding `text` as plain text.
 *
 * @param text - The text.
 * @returns The transfer's `types`, `files` and `getData`.
 */
function transferOf(text: string): { types: string[]; files: never[]; getData: (type: string) => string } {
    return { types: ['text/plain'], files: [], getData: (type: string) => (type === 'text/plain' ? text : '') };
}

/**
 * Stands in for a browser's input event. `InputEvent` is stubbed with an empty class here, so its fields are assigned.
 *
 * @param inputType - The event's `inputType`.
 * @param fields - The fields that differ from an event that carries nothing and was not prevented.
 * @returns The event.
 */
function inputEvent(inputType: string, fields: Record<string, unknown> = {}): InputEvent {
    return Object.assign(new InputEvent('beforeinput'), { inputType, data: null, dataTransfer: null, defaultPrevented: false, ...fields }) as InputEvent;
}

/**
 * Takes `BEFORE_INPUT_COMMAND` and `INPUT_COMMAND` ahead of Lexical's own handlers, which read a browser's DOM
 * selection and cannot run here, and behind the editor's listeners, which are the ones under test. `onInput` stands in
 * for what Lexical's `input` handler does: it reads the text the browser changed off the DOM.
 *
 * @param lexical - The Lexical editor.
 * @param onInput - What the `input` handler does to the document.
 * @returns The unregister function.
 */
function standInForLexicalInputHandlers(lexical: LexicalEditor, onInput: () => void = () => {}): () => void {
    const unregisterBeforeInput = lexical.registerCommand(BEFORE_INPUT_COMMAND, () => true, COMMAND_PRIORITY_HIGH);
    const unregisterInput = lexical.registerCommand(INPUT_COMMAND, () => { onInput(); return true; }, COMMAND_PRIORITY_HIGH);

    return () => { unregisterBeforeInput(); unregisterInput(); };
}

/**
 * What Lexical does with a character the browser inserted itself: reads the text node's new text off the DOM and puts
 * the caret after the character.
 *
 * @param typed - The character.
 */
function $syncInsertedCharacter(typed: string): void {
    const selection = $getSelection();

    if ($isRangeSelection(selection)) {
        const node = selection.anchor.getNode() as TextNode;
        const at = selection.anchor.offset;
        const text = node.getTextContent();

        node.setTextContent(text.slice(0, at) + typed + text.slice(at));
        node.select(at + 1, at + 1);
    }
}

/**
 * What Lexical does with a deletion the browser made itself: reads the text node's new text off the DOM and puts the
 * caret where the text went.
 */
function $syncDeletedSelection(): void {
    const selection = $getSelection();

    if ($isRangeSelection(selection)) {
        const node = selection.anchor.getNode() as TextNode;
        const at = Math.min(selection.anchor.offset, selection.focus.offset);
        const shown = node.getTextContent();

        node.setTextContent(shown.slice(0, at) + shown.slice(at + 1));
        node.select(at, at);
    }
}

/**
 * Inserts `text` at the editor's selection one way that is not typing it.
 *
 * @param editor - The editor.
 * @param insertion - The way.
 * @param text - The text.
 * @param inUpdate - Whether a command is dispatched inside an update.
 */
async function insert(editor: MarkdownEditor, insertion: Insertion, text: string, inUpdate: boolean): Promise<void> {
    const lexical = lexicalOf(editor);

    switch (insertion) {
        case 'PASTE_COMMAND':
            dispatch(editor, PASTE_COMMAND, Object.assign(new ClipboardEvent('paste'), { clipboardData: transferOf(text), preventDefault: () => {} }), inUpdate);
            break;
        case 'paste()':
            vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(text);
            await editor.paste();
            break;
        case 'paste nodes':
            lexical.update(() => { $insertGeneratedNodes(lexical, [$createTextNode(text)], $getSelection()!); }, { discrete: true });
            break;
        // What `insertFromDrop` and `insertFromYank` dispatch: the input event, carrying a data transfer.
        case 'drop insert':
            dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent('insertFromDrop', { dataTransfer: transferOf(text) }), inUpdate);
            break;
        case 'yank insert':
            dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent('insertFromYank', { dataTransfer: transferOf(text) }), inUpdate);
            break;
    }
}

/**
 * The editor's Markdown once nothing is pending: a shortcut is applied in an
 * update of its own, which the listener that sees the typed character
 * starts when that character's update is committed, so each read here
 * commits what the one before it started.
 *
 * @param editor - The editor.
 * @returns Its Markdown.
 */
function settledValue(editor: MarkdownEditor): string {
    lexicalOf(editor).read(() => null);
    lexicalOf(editor).read(() => null);

    return editor.getValue();
}

/**
 * The character that completes a kind's syntax, which stands right ahead of the {@link REMOVED} one.
 *
 * @param editor - An editor whose selection {@link select} made with one character ahead.
 * @returns The character.
 */
function completingCharacter(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();
        const text = $isRangeSelection(selection) ? selection.getTextContent() : '';

        return text[0]!;
    });
}

/** One route by which a browser hands a typed character to Lexical. */
type TypingRoute = readonly [name: string, type: (editor: MarkdownEditor, typed: string) => void];

const TYPING_ROUTES: readonly TypingRoute[] = [
    ['the text-insertion command with the character, inside an update', (editor, typed) => dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, typed, true)],
    ['the text-insertion command with the character, outside any update', (editor, typed) => dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, typed, false)],
    ['a beforeinput left to the browser, then the input event that reads the text', (editor, typed) => {
        const lexical = lexicalOf(editor);
        const unregister = standInForLexicalInputHandlers(lexical, () => $syncInsertedCharacter(typed));

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: typed }), true);
        dispatch(editor, INPUT_COMMAND, inputEvent('insertText', { data: typed }), true);
        unregister();
    }],
    ['a beforeinput left to the browser, the text read off the DOM in an update with no command, then the input event', (editor, typed) => {
        const lexical = lexicalOf(editor);
        const unregister = standInForLexicalInputHandlers(lexical);

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: typed }), true);
        lexical.update(() => $syncInsertedCharacter(typed), { discrete: true });
        dispatch(editor, INPUT_COMMAND, inputEvent('insertText', { data: typed }), true);
        unregister();
    }],
    ['a composition commit as Safari hands it over, inside an update', (editor, typed) => dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent('insertFromComposition', { data: typed }), true)],
    ['a composition commit as Safari hands it over, outside any update', (editor, typed) => dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent('insertFromComposition', { data: typed }), false)],
    ['a text replacement carrying its text as data', (editor, typed) => dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent('insertReplacementText', { data: typed }), true)],
    ['a text replacement carrying a data transfer', (editor, typed) => dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent('insertReplacementText', { dataTransfer: transferOf(typed) }), true)],
];

/** One update that removes the selected character with no typing behind it, other than a removal command. */
type QuietRemoval = readonly [name: string, remove: (editor: MarkdownEditor) => void];

const QUIET_REMOVALS: readonly QuietRemoval[] = [
    ['an update with no command and no input event', (editor) => { lexicalOf(editor).update(() => $syncDeletedSelection(), { discrete: true }); }],
    ['a deleteContentBackward left to the browser, then the input event that reads the text', (editor) => {
        const lexical = lexicalOf(editor);
        const unregister = standInForLexicalInputHandlers(lexical, () => $syncDeletedSelection());

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('deleteContentBackward'), true);
        dispatch(editor, INPUT_COMMAND, inputEvent('deleteContentBackward'), true);
        unregister();
    }],
    ['a typing beforeinput that was prevented, then an update with no command', (editor) => {
        const lexical = lexicalOf(editor);
        const unregister = standInForLexicalInputHandlers(lexical);

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: 'q', defaultPrevented: true }), true);
        lexical.update(() => $syncDeletedSelection(), { discrete: true });
        unregister();
    }],
    ['a typing beforeinput whose input event has arrived, then an update with no command', (editor) => {
        const lexical = lexicalOf(editor);
        const unregister = standInForLexicalInputHandlers(lexical);

        dispatch(editor, BEFORE_INPUT_COMMAND, inputEvent('insertText', { data: 'q' }), true);
        dispatch(editor, INPUT_COMMAND, inputEvent('insertText', { data: 'q' }), true);
        lexical.update(() => $syncDeletedSelection(), { discrete: true });
        unregister();
    }],
];

describe('a Markdown typing shortcut is applied by typing alone (TY rows)', () => {
    it.each(KINDS)('TY1: a removal that leaves the caret right behind %s completes no shortcut', (_name, source, text) => {
        for (const removal of REMOVALS) {
            for (const [backward, inUpdate] of VARIANTS) {
                const editor = select(source, 0, backward);
                const context = `${removal}, backward ${backward}, in an update ${inUpdate}`;

                remove(editor, removal, inUpdate);
                expect(settledValue(editor), context).toBe(text);

                // The removal is the one step there is: no shortcut ran as an update of its own after it.
                lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
                expect(settledValue(editor), `${context}, undone`).toBe(source);

                editor.dispose();
            }
        }
    });

    it.each(KINDS)('TY2: typing the character that completes %s applies the shortcut, on every route, as a step of its own', (_name, source, text, applied) => {
        for (const [route, type] of TYPING_ROUTES) {
            const editor = select(source, 1, false);
            const typed = completingCharacter(editor);

            remove(editor, 'Delete', true);

            const base = settledValue(editor);

            type(editor, typed);
            expect(settledValue(editor), route).toBe(applied);

            // One undo takes the shortcut back and leaves the typed character, a second takes the character.
            lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
            expect(settledValue(editor), `${route}, undone once`).toBe(text);
            lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
            expect(settledValue(editor), `${route}, undone twice`).toBe(base);

            // A redo puts the character back and applies nothing; a second puts the shortcut back.
            lexicalOf(editor).dispatchCommand(REDO_COMMAND, undefined);
            expect(settledValue(editor), `${route}, redone once`).toBe(text);
            lexicalOf(editor).dispatchCommand(REDO_COMMAND, undefined);
            expect(settledValue(editor), `${route}, redone twice`).toBe(applied);

            editor.dispose();
        }
    });

    it.each(KINDS)('TY3: the end of a composition, whose text went in while it was composed, completes %s', (_name, source, _text, applied) => {
        const editor = select(source, 1, false);
        const typed = completingCharacter(editor);
        const lexical = lexicalOf(editor);

        remove(editor, 'Delete', true);

        // An input method composes the character: Lexical puts it into the text node while the composition is on, when
        // the shortcuts wait, and the update that ends the composition changes no text.
        lexical.update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                $setCompositionKey(selection.anchor.key);
            }

            $syncInsertedCharacter(typed);
        }, { discrete: true });
        expect(settledValue(editor)).not.toBe(applied);

        lexical.update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                $setCompositionKey(null);
                selection.anchor.getNode().markDirty();
                // The composition moved the caret when it put the character in; its end does not move it again.
                $setSelection(selection.clone());
            }
        }, { discrete: true, tag: COMPOSITION_END_TAG });

        expect(settledValue(editor)).toBe(applied);

        editor.dispose();
    });

    it.each(KINDS)('TY4: pasting or dropping the character that completes %s completes no shortcut', async (_name, source, text) => {
        for (const insertion of INSERTIONS) {
            for (const inUpdate of [true, false]) {
                const editor = select(source, 1, false);
                const pasted = completingCharacter(editor);

                remove(editor, 'Delete', true);
                await insert(editor, insertion, pasted, inUpdate);
                expect(settledValue(editor), `${insertion}, in an update ${inUpdate}`).toBe(text);

                editor.dispose();
            }
        }
    });

    it.each(KINDS)('TY5: a removal with no removal command behind it completes no shortcut behind %s', (_name, source, text) => {
        for (const [name, removeQuietly] of QUIET_REMOVALS) {
            const editor = select(source, 0, false);

            removeQuietly(editor);
            expect(settledValue(editor), name).toBe(text);

            editor.dispose();
        }
    });

    it.each(KINDS)('TY6: the character that completes %s, put in by an update with no input event behind it, completes no shortcut', (_name, source, text) => {
        const editor = select(source, 1, false);
        const typed = completingCharacter(editor);

        remove(editor, 'Delete', true);
        lexicalOf(editor).update(() => $syncInsertedCharacter(typed), { discrete: true });

        expect(settledValue(editor)).toBe(text);

        editor.dispose();
    });

    it.each([false, true])('TY7: a character typed over a selection completes a shortcut (selected backwards: %s)', (backward) => {
        const editor = load('a \\*x zz b');

        lexicalOf(editor).update(() => {
            const node = $dfs().map((entry) => entry.node).find((found) => $isTextNode(found)) as TextNode;
            const at = node.getTextContent().indexOf(' zz');
            const selection = $createRangeSelection();
            const [anchor, focus] = backward ? [at + 3, at] : [at, at + 3];

            selection.anchor.set(node.getKey(), anchor, 'text');
            selection.focus.set(node.getKey(), focus, 'text');
            $setSelection(selection);
        }, { discrete: true });

        dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, '*', true);
        expect(settledValue(editor)).toBe('a *x* b');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        expect(settledValue(editor)).toBe('a \\*x\\* b');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        expect(settledValue(editor)).toBe('a \\*x zz b');

        editor.dispose();
    });

    it.each([
        ['a code fence', '\\`\\`\\`;', '```\n```'],
        ['a code fence with a language', '\\`\\`\\`js;', '```js\n```'],
        ['a bullet marker and its space', 'x\\- ;', '-'],
        ['a heading marker and its space', 'x\\# ;', '#'],
    ])('TY8: Enter at the end of a block whose text is %s still converts the block', (_name, source, converted) => {
        const editor = select(source, 0, false);

        remove(editor, 'Delete', true);

        // The leading `x` keeps the marker's space from being trimmed on load; with it gone the block's text is the marker.
        lexicalOf(editor).update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                const node = selection.anchor.getNode() as TextNode;
                const shown = node.getTextContent();

                node.setTextContent(shown.startsWith('x') ? shown.slice(1) : shown);
                node.selectEnd();
            }
        }, { discrete: true });

        dispatch(editor, KEY_ENTER_COMMAND, null, true);
        expect(settledValue(editor)).toBe(converted);

        editor.dispose();
    });
});
````

---

## Notes

[^lexical-listener]: `registerMarkdownShortcuts`, `MarkdownShortcuts.ts:539–611`. The listener returns early for an update tagged `HISTORIC_TAG` or `COLLABORATION_TAG`, while a composition runs, when the selection is not a collapsed range or equals the previous one, when the caret's text node is not among the changed nodes, and when the caret moved on by more than one character (unless the update ends a composition). Every other update goes on to the transformers.

[^measured-tip]: Command level: `p2-offline-tip.json`. Real keys in Chromium: `browser/p2b-tip.json`. A four-row probe (`browser/bisect2.mjs`: Backspace in `\- .cd` and in `a \*x\*.b`, a pasted `*`, a forward Delete) gave the same output on the tip, on `master`, on `v0.10.0` and on `v0.5.0`, each served from a detached worktree. Older releases were not run; the code that wraps Lexical's listener has never looked at what kind of update it is given.

[^webkit]: Lexical defers the end of a composition where its `IS_SAFARI` or `IS_APPLE_WEBKIT` flag is set and `IS_IOS` is not (`onCompositionEnd`, `LexicalEvents.ts:1541`): desktop Safari and a `WKWebView` on macOS, which is what a Tauri shell uses there. `IS_SAFARI` is a test of the user agent for `Version/… Safari`, which WebKitGTK's default user agent also passes, so a Tauri shell on Linux is expected to take the same path. Whether WebKitGTK sends `insertFromComposition` was not established.

[^replacement]: Sign-off 2. Lexical sends `insertReplacementText` through the same command as a drop, with the event as payload, so the two can only be told apart by the event's type. Safari also sends some replacements as `insertText` with a data transfer and no data (`LexicalEvents.ts:1025`); Lexical inserts that text in the `beforeinput`'s own update, which the `BEFORE_INPUT_COMMAND` listener has tagged.

[^awaited]: The third condition exists for one order of events. A browser inserts most typed characters itself: Lexical leaves the `beforeinput` alone and reads the new text off the DOM. It normally does so in its `input` handler, whose update the `INPUT_COMMAND` listener tags. But Lexical also watches the DOM with a mutation observer, and when another listener runs ahead of its `input` handler the observer's callback runs first and reads the text in an update that has no command at all. In Chromium and WebKit Lexical holds the observer back for 100 ms after a `textInput` event, so this order does not occur. Where that event does not exist it can, and the library's own `Event` module registers window-level capture listeners that run ahead of Lexical's. The `beforeinput` is kept until the next `beforeinput` or `input` command, and counts only while it is not prevented: Lexical prevents the event when it inserts the text itself or drops it.

[^no-negative]: A positive mark needs every path that types to carry one, and the table shows that each has an input event or Lexical's own tag. A negative mark would need every path that does not type to carry one, and an update made by a command, an API call or an extension has nothing to hang it on.

[^first-attempt]: The first version of this rule, on `feature/markdown-editor-raw-block-range-edits`, failed review for four reasons, each of which this design answers. It tagged every text-insertion command whose payload is an event as "not typing"; Lexical also sends a composition's commit that way on desktop Safari (`insertFromComposition`, `LexicalEvents.ts:1069`), where the end of a composition is deferred and never tagged (`:1551`), so a dead-key backtick or tilde would have completed nothing there. Here the event's type decides. It tagged a text replacement the same way; here that is typing, pending sign-off 2. It judged an update with no tag by whether the caret's text node grew, which is wrong in both directions; here an update with no mark is never typing, and the two browser-driven cases that have no tagged command are covered by the `input` event's command and the awaited `beforeinput`. It changed a one-character paste or drop without a decision; here that is sign-off 1.

[^undo-steps]: Lexical's shortcut update is tagged `HISTORY_PUSH_TAG` for this purpose. Row `TU1` of the raw-block branch and row TY2 here pin the two steps.

[^matrix-a]: `browser/p2a-tip.json` against `p2a-final.json`: 85 rows identical. The rows include results that look wrong and are not this plan's: a block shortcut typed in a table cell (see *Non-Goals*) and in a list item, where the editor declines the block and keeps the marker as escaped text.

[^helpers]: Run with the prototype: without the helper change three tests fail (`O3`; "a typing shortcut applies in a paragraph (control for the next case)"; "a bold typing shortcut after a space still applies (control)"), and three pass for the wrong reason, since they expect a shortcut *not* to apply (`O2`; "a typing shortcut does not apply in a raw block…"; "a bold typing shortcut whose content starts with punctuation…"). With the change all six pass and test what they name. The fuzz harnesses and `markdown-edit-fuzz.test.ts` type with the command already.

[^check-runs]: `browser/check2-tip.log` and `browser/check2-final.log`. The prototype is this plan's code in a private copy of the tip, never in a worktree's tracked source.

[^firefox-order]: `browser/p2d-final.log`. Without the awaited `beforeinput` no shortcut is applied under the simulation (measured by switching it off in the prototype), which is what the third condition of `isTypedUpdate` is for. Whether current Firefox dispatches the legacy `textInput` event, and so which order it takes, was not established.

[^differential]: The harness makes documents of one to three blocks that hold escaped, nearly complete shortcut text, places the caret, and runs up to 8 steps drawn from: a typed character by the command, a typed character by the two input commands, Backspace, Delete, a word delete, a selection removed, a cut, a paste of one or two characters, a drop, undo, redo, Enter, a caret move and `toggleBold`. It records the save after every step and whether an update of the step carried `history-push`, which Lexical's shortcut update sets when it applies one.

[^fuzz]: The baselines were made from commit `11782acb`, whose editor source differs from the tip's in comments only. The harnesses record failures of their own checks (a save that does not reload, a surface that differs from the viewer), not every state, so identical files mean that no such check changed its outcome; the random-edit harness of item 2 is the one that compares states.

---

## Implementation Notes

### Sign-off decisions: decided

The repository's owner answered all five on 2026-10-12, as the plan recommends:

1. A paste or drop of the one character that completes a shortcut applies none.
2. A text replacement (autocorrect) counts as typing.
3. Text that changes with no input event completes no shortcut.
4. The Enter path stays for every marker.
5. A completed shortcut stays two undo steps.

### Base

The plan was drafted on `feature/markdown-language-readonly-and-fences`; this branch stands on `feature/nested-scroll-reveal`. Line numbers were off and code was located by symbol. The "without" case held: the base had no `registerTypingTags`, `GUARDED_DELETION_TAG` or `markdown-editor-typing-shortcuts.test.ts`, so step 2 was skipped. The test file was copied from the planner's run copy (identical to the plan's addendum).

### Beside the read-only editor (`markdown-editor-readonly-keyboard-selection`)

The read-only guard (`registerReadOnlyGuard`) is the last registration and sits at `COMMAND_PRIORITY_BEFORE_CRITICAL` for `BEFORE_INPUT_COMMAND`, `INPUT_COMMAND` and `CONTROLLED_TEXT_INSERTION_COMMAND`, so in a read-only editor those commands end before this plan's listeners (CRITICAL, and EDITOR) run: a refused edit is tagged as nothing, and `awaited` is never set by one.

One gap in the plan's design remained: the wait for an `input` event (`awaited`) was cleared only by the next input command. A typed `beforeinput` left to the browser, then read-only switched on, a refused `input` command and read-only lifted, left the wait standing, and every update after it counted as typed (a Backspace or `cut()` then completed a shortcut: 28 of 28 rows in the first review). The same held, with no read-only, for a typed `beforeinput` whose `input` command never arrives.

Deviation from the plan, small: the wait now ends at a definite point, and never outlives the event it is for. It ends at the `input` command or the next `beforeinput` command, at the end of the task in which the `beforeinput` was handled (`DOM.sink.setTimeout` of no delay: a browser fires the `input` event in that task and Lexical's mutation observer reads the text in a microtask of it), and when the editor's editability changes (`registerEditableListener`); disposal ends it too. The first version of this note, and of the code, added an `editor.isEditable()` test to `isTypedUpdate`; it hid the stale wait while read-only and did not clear it. It is removed: with the wait ended at those points, no update the editor really makes needs it (the one update the restore of a refused composition makes, in `finishViewRestore`, runs with the editor editable and changes no text), and no row failed without it once the wait ended at the switch.

### Fix round 1 (first independent review)

- **Blocking 1, the stale wait.** Fixed as above. Rows in `markdown-editor-typing-shortcuts.test.ts`: TY10 (typed `beforeinput`, read-only on, `input` refused, read-only off, then Backspace or `cut()`: text stays text), TY11 (a typed `beforeinput` whose `input` never arrives, a task passes, then a removal: text), TY12 (wait, read-only on, an update that changes the text with no command: text). TY10 fails without the editability listener (14 tests, and 14 more in TY12), TY11 without the timer (14). The old TY10/TY11 pinned updates the editor never makes (a text-changing update with no command, and a `COMPOSITION_END_TAG` update, in a read-only editor) and were replaced. A mounted row, M7 in `markdown-editor-readonly-mounted.test.ts` (a typed `beforeinput` command, read-only on, a real `input` event the guard refuses, read-only off, a range removal: the block stays a paragraph), fails without the editability listener. jsdom's `InputEvent` has no `getTargetRanges`, so Lexical listens for no `beforeinput` there: the `beforeinput` is dispatched as the command, and only the `input` event is a real DOM event. A real `beforeinput` against a read-only surface is covered by that file's R-rows, which this plan did not change.
- **Blocking 2, untested marks.** TY13 (text Lexical inserts in the update of a prevented typing `beforeinput`), TY14 (an `insertCompositionText` `input` event read off the DOM, no composition on) and TY15 (a browser-made deletion read before its `input` event) each fail, 14 tests, when their line goes: the tag in the `BEFORE_INPUT_COMMAND` listener, `"insertCompositionText"` in `TYPING_INPUT_TYPES`, and `awaited` set for every type.
- **Blocking 3, Verification not completed.** Run on the final code, see *Verification run*.
- **Advisories fixed:** TY9 filters the one route that is no command by its index and says what it exercises (the guard's refusal, not this plan's code); the step-8 note below; the header of the test file cites the plan by its slug.
- **Advisories left:** `registerTypedTextMarks` returns `{ unregister, isTypedUpdate }` where every other `register*` returns a function (the plan prescribes it); Lexical's own `beforeinput` and `input` handlers could now be driven by the mounted harness instead of `standInForLexicalInputHandlers` (the plan's premise that they cannot run offline is out of date on this base).

### Fix round 2 (second independent review)

- **Blocking 1, a composition that typed nothing.** Round 2 added a rule for it; round 3 removed the rule again (see *Round 3*). What stands from this round: TY19, the advisory fixes and the other items below.
- **Blocking 2, the code commit's message.** Reworded in the autosquash rebase; it now describes the wait's five ends, the absence of an editability test, and the composition rule.
- **Blocking 3, the end at the next `beforeinput`.** TY19 (a typed `beforeinput`, then a deletion `beforeinput`, then a removal read in an update with no command: text). It fails (14) when the `endWait()` in the `beforeinput` listener is deleted.
- **Advisories fixed:** the JSDoc of `registerTypedTextMarks` is reordered (the wait and its five ends in one paragraph) and no longer says "until its `input` event arrives" alone; TY12's title says what it pins; TY9 picks its excluded route by name (`ROUTE_READING_TEXT_IN_ITS_OWN_UPDATE`), not by index; the loose count above is corrected; the three lines with two statements in the test file are split; M7 moved to the end of its describe.
- **Timer hygiene, unpinned:** removing the `clearTimeout` in `endWait` or the `endWait` at disposal fails no test. Neither changes behaviour a user or a caller can see: a timer that outlives its wait only calls `endWait` once more, in the same or the next task, and one that outlives the editor only clears two variables nobody reads. A row would have to wait on a race between two zero-delay timers, which is not an honest test.
- **Mutations:** 24 mutations of `registerTypedTextMarks` and the wrapper were run against the typing-shortcuts and mounted read-only files. 22 of them failed a test; the two timer-hygiene lines above did not. That was a run of those 24 mutations, not a claim that every line of the function is pinned: the composition logic added in this round, since removed, had branches no row reached.
- **The rest of the fuzz:** the 20-file result below stands for now. The script `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/impl/typing-shortcuts/fuzz-all.sh` runs the plan's 71 files for the branch tip and the parent baseline, one vitest process at a time, and is run by the orchestrator after this round; the closing pass will record its result here.

### Differences from the plan's text

- Step 8 (other tests that type without a command): the first note said none of the `insertText(` callers failed, which cannot catch a test that expects a shortcut to be declined. The first review instrumented six Markdown suites to log untyped edits that look like typing and found no other helper that needs the change; the three helpers of the plan are the only ones changed.
- The suite counts at this base are 19,590 passed in 589 files, 2 todo (the brief expected about 20,00x). The new test file has 232 tests (the plan's 90, plus 142 of TY9 to TY19 and the known-limit and composed-over-selection rows); the mounted file gained M7.

### Verification run

Round 1 verification, kept as history; round 3 reran the checks on the final code, and the fuzz comparison of round 2 is in *Round 3*.

- `npm run typecheck`, `typecheck:test`, full `npm run lint`, `docs:api`, `docs:llms:check`: clean. Full suite with `--maxWorkers=4`: 19,590 passed, 2 todo.
- Browser: `check2.mjs` against this worktree's demo in headless Chromium: `ALL ROWS PASS` (Matrix A 85, Matrix B 62). `p2d.mjs` (the Firefox-order simulation): as the plan expects, `update tags=[]` before `cmd INPUT_COMMAND` on every line, each shortcut applied, the typed character shown once more after the formatted text as for the parent, and Backspace under the simulation leaves `a \*x\*b`. Script-built events stand in for `insertFromComposition`, `insertReplacementText` and `insertFromDrop`.
- Differential check against the parent (`feature/nested-scroll-reveal`, `326dd4717`), seeds 1, 2, 3, `P2D_N=4000`: `hard check ... : 0` on all three, in private copies.
- Seeded fuzz harnesses, parent and branch run one after the other, one vitest process at a time, in private copies, parent baseline taken on `feature/nested-scroll-reveal`. **Cut for time, the same on both sides:** seeds 601, 1709 and 2207 (of 11) for the column-paste, table-edge (both strict modes), list-item and list-item-without-exemption families, and r7 seeds 11 and 23 (of 5): 20 output files per side instead of 71. All 20 are byte-identical between parent and branch (`cmp`). The files record failures of the harnesses' own checks, not every state; the random-edit differential above is the one that compares states.

### Round 3 (third independent review)

- **What review 3 found.** Round 2's composition rule counted a composition's end as typing only if the whole document's text was longer than before the composition began. Lexical's composition start replaces a selection with its first character in that same update, so a composed completing character over a selection (a dead-key or IME `*` over ` zz` in `a \*x zz b`) never counted: it no longer went italic, while a typed key and the parent did. That broke the plan's own rule and TY7's case for compositions, and the rule had branches no row reached (the start of the composition's size, and an `awaitsComposedText` branch Lexical cannot reach, since it returns before dispatching `BEFORE_INPUT_COMMAND` for `insertCompositionText`).
- **The owner's decision (2026-10-14).** Remove round 2's rule and return to the plan's design: the end of a composition counts as typing, as the plan's path rows 3 and 4 say.
- **What was removed.** The size tracking (`sizeBeforeComposition`, `textSizeOf`, every use of `prevEditorState` and `editorState`), `COMPOSED_TEXT_TAG` with its `insertCompositionText` branch, and the `UpdatePayload` type. `isTypedUpdate` takes the tags again and reads no editor state; the plan's step-6 check on `payload.prevEditorState` holds in substance. Nothing kept from rounds 1 and 2 needed the payload. Kept: the wait's five ends, TY10 to TY15, TY19, M7, the advisory fixes of round 2.
- **The known limit.** A composition that is cancelled or emptied right behind shortcut-shaped text, or that ends by removing text, applies the shortcut. It is how every release behaves and how the parent behaves, and it is stated in the JSDoc of `registerTypedTextMarks`, on the component page and in the changelog. Rows TY16 and TY17 pin it for all 14 kinds, titled as a known limit; a change that closes it changes them. The cost of a fix is a rule about what a composition changed, which the review showed to need care (a composition over a selection replaces text in its first update); it was not taken. Manual check 8 (Safari) is added to the list below, not run.
- **Pinned regression.** TY18 (a character composed over a selection, selected forwards and backwards) applies the shortcut, like TY7 for a typed key. It fails on round 2's code.
- **Advisories taken:** the calls in `if` conditions went with the removed code, and `BEFORE_INPUT_COMMAND` is imported among the commands in the mounted test. Not taken: the object returned by `registerTypedTextMarks`; `COMPOSED_TEXT_TAG` and TY14/TY18 of the old numbering pinned a path Chromium does not take (moot, removed).
- **Fuzz.** The full comparison ran on `9f79d7574` (round 2's code): 71 of 71 output files identical between parent and branch (`fuzz-all/RESULT-9f79d7574.txt` in the scratch folder). The final code differs from it in `registerTypedTextMarks` and the tests, so the orchestrator reran the branch side on the final code (tip `ca38b640f`, before this sentence was added) on 2026-10-14: 71 of 71 output files identical to the parent's (`fuzz-all/RESULT.txt`).


### Manual checks not run here (Firefox, Safari/WebKit, Android)

Do these on the demo's **MD Editor** page; a failure is reported, not worked around. Nothing below was run by the implementer.

1. Safari on macOS, Swedish layout: type `a `, a backtick via the dead key, `x`, a backtick again: `x` becomes inline code. Then ` ~~y~~` with the tilde from Option+`¨` then Space: `y` is struck through.
2. Safari on macOS: in source mode set the document to `a \*x\*.b`, switch back, caret after the `.`, Backspace: the text stays `a *x*b` with the asterisks showing.
3. Firefox on Windows, Microsoft Japanese IME: with the IME off type `a *x`; IME on (Hiragana), type `*` (shows `＊`), F10, Enter: `x` becomes italic. Control in Chrome or Edge.
4. Firefox: type ` *y*` at the end of a paragraph: `y` italic and no `*` after it.
5. Firefox: as check 2.
6. Chrome on Android, Gboard: `- item` in an empty paragraph makes a list item; ` **b**` makes bold; then check 2 with the on-screen Backspace.
7. Chrome on Android, Gboard: a composition that ends by removing text. In source mode set the document to `\- x`, switch back, place the caret after the `x` (Gboard composes the word it touches) and press the on-screen Backspace over the `x`, the only composed letter. The text must stay `- ` as text, not a list item. Not run.
8. Safari on macOS, a cancelled composition: with a dead key held (Swedish layout) press the backtick dead key, then Escape or Backspace, right behind `a \`x\`` typed as escaped text (source mode: `a \\`x\\` b`). The known limit says the shortcut may apply; record whether it does. Not run.

### For `markdown-editor-raw-block-range-edits`, when it resumes

That branch is held (owner's decision of 2026-10-13) and sits on top of this one. The list below was written by the orchestrator at closing, from that branch's seventh review (`scratch-keep/impl/raw-block-range-edits/review7/REPORT.md`); it replaces a list written from this plan's text alone, which named the branch's code as it stood before its seventh round. When the branch resumes it must:

- Drop its commit "Complete no typing shortcut after a removal the editor makes itself": this branch holds the general rule. With it go `GUARDED_DELETION_TAG`, `$removeGuardedRangeAsDeletion` and its callers (each goes back to `$removeGuardedRange`), the direct tag on the paragraph command's guarded route, and the `isDeletion` test in the shortcut wrapper. A removal route needs no tag here: an update with no typing mark completes no shortcut.
- Take this branch's `markdown-editor-typing-shortcuts.test.ts` as the file, and move into it only those of its own rows (`TY1`, `TY1b`, `TY1c`, `TY5`, `TK6`, `TK8` and the rest of its shortcut rows) that still say something this branch's rows do not; `TY5` and `TK6` pin behaviour this branch removes and must change to expect text.
- Keep its docs wording in step with this branch's bullet in `MarkdownEditor.md` and changelog entry.
