import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CodeEditorSearchPanel } from '~/component/editor/CodeEditorSearchPanel';
import type { CodeEditorSearchFields, CodeEditorSearchCommand } from '~/component/editor/CodeEditorSearchPanel';
import { Component } from '~/core/Component';
import { Anchor } from '~/layout/Anchor';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

// MUST be the first describe block in this file, and its one test the only
// place a real dispatched DOM event (`.click()`) is used. `Event`'s
// window-level base listener is installed once per event type for the
// lifetime of this module and never re-armed on the fresh `DOM.sink` a later
// `installTestDOM()` call swaps in (see tests/component/MenuButton.test.ts's
// file-level comment, and tests/component/diagram/DiagramView.test.ts's
// identical constraint). Every other test in this file drives the panel's
// own registered handler fields directly instead.
describe('CodeEditorSearchPanel — real DOM-dispatched button wiring', () => {
    it('each action button emits the matching "command", and each toggle emits "querychange" with its new flag', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();
        panel.getElement(true);

        const commands: CodeEditorSearchCommand[] = [];
        const queries: CodeEditorSearchFields[] = [];
        panel.on('command', (command) => commands.push(command));
        panel.on('querychange', (fields) => queries.push(fields));

        (panel as any)._previousButton.click();
        (panel as any)._nextButton.click();
        (panel as any)._selectAllButton.click();
        (panel as any)._replaceButton.click();
        (panel as any)._replaceAllButton.click();
        (panel as any)._closeButton.click();

        expect(commands).toEqual(['findprevious', 'findnext', 'selectall', 'replacenext', 'replaceall', 'close']);

        (panel as any)._caseButton.click();
        (panel as any)._wordButton.click();
        (panel as any)._regexpButton.click();

        expect(queries.length).toBe(3);
        expect(queries[0].caseSensitive).toBe(true);
        expect(queries[1].wholeWord).toBe(true);
        expect(queries[2].regexp).toBe(true);
    });
});

describe('CodeEditorSearchPanel construction / buildControls', () => {
    it('has no children until buildControls(), then exactly the two rows', () => {
        const panel = new CodeEditorSearchPanel();

        expect(panel.getComponents().length).toBe(0);
        expect(panel.isBuilt()).toBe(false);

        panel.buildControls();

        expect(panel.isBuilt()).toBe(true);
        expect(panel.getComponents().length).toBe(2);
    });

    it('is idempotent: a second buildControls() call leaves the child count at 2', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();
        panel.buildControls();

        expect(panel.getComponents().length).toBe(2);
    });
});

describe('CodeEditorSearchPanel getFields / setFields', () => {
    it('reports all-empty strings and all-false flags on a freshly built panel', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();

        expect(panel.getFields()).toEqual({
            search: '', replace: '', caseSensitive: false, wholeWord: false, regexp: false,
        });
    });

    it('round-trips every field through setFields()', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();

        const fields: CodeEditorSearchFields = {
            search: 'ab', replace: 'cd', caseSensitive: true, wholeWord: true, regexp: true,
        };

        panel.setFields(fields);

        expect(panel.getFields()).toEqual(fields);
    });

    it('setFields() emits no "querychange"', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();

        const spy = vi.fn();
        panel.on('querychange', spy);

        panel.setFields({ search: 'x', replace: '', caseSensitive: false, wholeWord: false, regexp: false });

        expect(spy).not.toHaveBeenCalled();
    });

    // Regression: `_findField`/`_replaceField` are real `TextField`
    // (AbstractInput) children, whose own uncommitted-edit tracking folds up
    // through every ancestor's isDirty() with no opt-out (Component.wireChild).
    // A real keystroke's native "input" dispatch runs TextInput's own
    // onInput()/notifyChange() (which sets the field dirty) before this
    // panel's own "action" listener — simulated here as the same two calls,
    // in that order — so the panel (and, through it, CodeEditor) must not
    // observe a lingering dirty flag once its own handler has run.
    it('typing into the find field does not leave it (or this panel) marked dirty', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();

        (panel as any)._findField.setText('needle');
        (panel as any)._findField.notifyChange('needle');
        expect((panel as any)._findField.isDirty()).toBe(true);

        (panel as any).handleFindFieldChange();

        expect((panel as any)._findField.isDirty()).toBe(false);
        expect(panel.isDirty()).toBe(false);
    });

    it('typing into the replace field does not leave it (or this panel) marked dirty', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();

        (panel as any)._replaceField.setText('needle');
        (panel as any)._replaceField.notifyChange('needle');
        expect((panel as any)._replaceField.isDirty()).toBe(true);

        (panel as any).handleReplaceFieldChange();

        expect((panel as any)._replaceField.isDirty()).toBe(false);
        expect(panel.isDirty()).toBe(false);
    });
});

describe('CodeEditorSearchPanel find/replace field keydown routing', () => {
    it('Enter on the find field emits "findnext" and returns a stop+prevent disposition', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();

        const commands: CodeEditorSearchCommand[] = [];
        panel.on('command', (command) => commands.push(command));

        const findFieldHandle = (panel as any)._findField.getElement(true);
        const result = (panel as any).handleFindFieldKeyDown(makeEvent(findFieldHandle, 'keydown', { key: 'Enter' }));

        expect(commands).toEqual(['findnext']);
        expect(result).toEqual({ stop: true, prevent: true });
    });

    it('Shift+Enter on the find field emits "findprevious"', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();

        const commands: CodeEditorSearchCommand[] = [];
        panel.on('command', (command) => commands.push(command));

        const findFieldHandle = (panel as any)._findField.getElement(true);
        (panel as any).handleFindFieldKeyDown(makeEvent(findFieldHandle, 'keydown', { key: 'Enter', shiftKey: true }));

        expect(commands).toEqual(['findprevious']);
    });

    it('Escape on the find field emits "close"', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();

        const commands: CodeEditorSearchCommand[] = [];
        panel.on('command', (command) => commands.push(command));

        const findFieldHandle = (panel as any)._findField.getElement(true);
        (panel as any).handleFindFieldKeyDown(makeEvent(findFieldHandle, 'keydown', { key: 'Escape' }));

        expect(commands).toEqual(['close']);
    });

    it('an unrelated key on the find field emits nothing and returns false', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();

        const commands: CodeEditorSearchCommand[] = [];
        panel.on('command', (command) => commands.push(command));

        const findFieldHandle = (panel as any)._findField.getElement(true);
        const result = (panel as any).handleFindFieldKeyDown(makeEvent(findFieldHandle, 'keydown', { key: 'a' }));

        expect(commands).toEqual([]);
        expect(result).toBe(false);
    });

    it('Enter on the replace field emits "replacenext"', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();

        const commands: CodeEditorSearchCommand[] = [];
        panel.on('command', (command) => commands.push(command));

        const replaceFieldHandle = (panel as any)._replaceField.getElement(true);
        (panel as any).handleReplaceFieldKeyDown(makeEvent(replaceFieldHandle, 'keydown', { key: 'Enter' }));

        expect(commands).toEqual(['replacenext']);
    });

    it('Escape on the replace field emits "close"', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();

        const commands: CodeEditorSearchCommand[] = [];
        panel.on('command', (command) => commands.push(command));

        const replaceFieldHandle = (panel as any)._replaceField.getElement(true);
        (panel as any).handleReplaceFieldKeyDown(makeEvent(replaceFieldHandle, 'keydown', { key: 'Escape' }));

        expect(commands).toEqual(['close']);
    });
});

describe('CodeEditorSearchPanel button chrome', () => {
    it('every button reports its title in aria-label and renders no visible text', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();

        const buttons = [
            '_caseButton', '_wordButton', '_regexpButton', '_previousButton', '_nextButton',
            '_selectAllButton', '_closeButton', '_replaceButton', '_replaceAllButton',
        ];

        for (const name of buttons) {
            const button = (panel as any)[name];

            expect(button.isShowText()).toBe(false);
            expect(typeof button.getAria().getLabel()).toBe('string');
            expect(button.getAria().getLabel()!.length).toBeGreaterThan(0);
        }
    });
});

describe('CodeEditorSearchPanel.fitWithin', () => {
    it('changes nothing on an undisplayed panel', () => {
        const panel = new CodeEditorSearchPanel();

        panel.buildControls();
        panel.setWidth(300);
        panel.setX(50);
        panel.setDisplayed(false);

        panel.fitWithin(200);

        expect(panel.getWidth()).toBe(300);
        expect(panel.getX()).toBe(50);
    });

    it('never leaves the panel wider than availableWidth - margin * 2, once displayed with a host', () => {
        const host = new Component({ layoutManager: new Anchor() });
        host.getElement(true);
        host.setSize({ width: 400, height: 300 });
        host.clearInsets();

        const panel = new CodeEditorSearchPanel();

        panel.buildControls();
        host.addComponent(panel, panel.getAnchorConstraints());
        host.doLayout();

        panel.setWidth(500);

        panel.fitWithin(200);

        expect(panel.getWidth()).toBeLessThanOrEqual(200 - panel.getMargin() * 2);
    });
});
