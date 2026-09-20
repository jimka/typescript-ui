// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Regression coverage for `codeEditorTheme`'s module-level memo. The function
// used to build a fresh `EditorView.theme` and a fresh `HighlightStyle` on
// every call — once per editor, and once more per theme change — and both of
// those compile down to a `style-mod` `StyleModule`. A `StyleSet` keeps its
// module list in append order and offers no unmount, so every call added 51
// more CSS rules to the root it mounted into and nothing ever took them away.
//
// A fresh, dedicated test file (rather than adding to code-editor.test.ts) is
// deliberate, for the same reason editorTheme.multicolumn.test.ts exists: the
// memo is module state, vitest isolates module state per test file by default,
// and the spies below must be installed before the first `codeEditorTheme`
// call of the process — so this file's calls are guaranteed to be the ones
// that actually record a build.
//
// The rule count itself is not assertable offline: `DOM.sink.mountView`
// returns `null` under the recording sink, so `CodeEditor._view` never leaves
// `null` in a test and no `EditorView` ever mounts a module. Object identity
// is the proof instead — the function reads nothing but its `dark` argument
// (every colour is a module constant or a CSS variable the browser resolves at
// paint time) and has no side effect but the two builds, so one object per
// flag means one `StyleModule` per flag, and a fixed number of modules is a
// fixed number of rules on every root they reach.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { codeEditorTheme } from '~/component/editor/theme';

// Calls per flag. Any number above one demonstrates the memo; five keeps the
// unmemoised count (ten builds) clearly distinct from the memoised one (two).
const CALLS_PER_FLAG = 5;

describe('codeEditorTheme', () => {
    let themeBuilds:     ReturnType<typeof vi.spyOn>;
    let highlightBuilds: ReturnType<typeof vi.spyOn>;

    // Installed once for the whole file, and never cleared between cases: the
    // counts below are the process's total, which is exactly what "built once,
    // ever" means. Spying keeps the real implementation.
    beforeAll(() => {
        themeBuilds     = vi.spyOn(EditorView, 'theme');
        highlightBuilds = vi.spyOn(HighlightStyle, 'define');
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    it('builds one theme per dark flag however often it is called', () => {
        for (let call = 0; call < CALLS_PER_FLAG; call++) {
            codeEditorTheme(false);
        }

        for (let call = 0; call < CALLS_PER_FLAG; call++) {
            codeEditorTheme(true);
        }

        expect(themeBuilds).toHaveBeenCalledTimes(2);
        expect(highlightBuilds).toHaveBeenCalledTimes(2);
    });

    it('returns the same extension object for the same flag', () => {
        expect(codeEditorTheme(false)).toBe(codeEditorTheme(false));
        expect(codeEditorTheme(true)).toBe(codeEditorTheme(true));
    });

    it('keeps the two flags distinct', () => {
        expect(codeEditorTheme(false)).not.toBe(codeEditorTheme(true));
    });
});
