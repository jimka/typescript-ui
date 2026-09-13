// Kept in its own file rather than folded into ComboBox.test.ts: every
// ComboBox wires a DOM-routed "change" listener on its dropdown's inner list
// at construction (`ComboBoxDropdown`'s `_list.on("action", ...)`), and none
// of ComboBox.test.ts's many undisposed `combo`s ever release it. `Event`'s
// `installedListenerTypes` bookkeeping (see Event.ts) outlives `DOM.reset()`,
// so once that file's first ComboBox registers the type, every later test in
// that same file silently loses real "change" dispatch — see the identical,
// already-documented gotcha in Link.test.ts's file header. A fresh file gets
// its own module registry, so this test's dispatch isn't at the mercy of
// that file's undisposed instances.
import { describe, it, expect, afterEach } from 'vitest';
import { ComboBox } from '~/component/input/ComboBox';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

function key(name: string): KeyboardEvent {
    return { key: name, preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent;
}

afterEach(() => DOM.reset());

// Bug: the dropdown's inner list defaults to `_selectFollowsFocus`, which
// commits (and fires `action`) on every arrow keypress, not only on
// Enter/Space/click, so the collapsed control's label live-updates as the
// user browses. The dropdown's `action` handler used to close the panel
// unconditionally on any commit, so each arrow press that opened the
// dropdown immediately closed it again, and the next press re-opened it — a
// visible open/close flicker on every keystroke instead of the panel staying
// open while the user browses with the arrow keys.
describe('ComboBox dropdown — close vs. keep-open on commit', () => {
    it('keeps the dropdown open across an arrow-key commit, closing only on Enter/Space or a row click', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combo.setItems(['a', 'b', 'c']);

        const dropdown = (combo as unknown as { _dropdown: { isOpen(): boolean; handleKey(e: KeyboardEvent): boolean } })
            ._dropdown;

        combo.openDropdown();
        expect(dropdown.isOpen()).toBe(true);

        dropdown.handleKey(key('ArrowDown'));

        expect(combo.getSelectedIndex()).toBe(1);      // value still commits live
        expect(dropdown.isOpen()).toBe(true);          // but the panel stays open

        dropdown.handleKey(key('Enter'));

        expect(dropdown.isOpen()).toBe(false);         // an explicit commit does close it
    });
});
