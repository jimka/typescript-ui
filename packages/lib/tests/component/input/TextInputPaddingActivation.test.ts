// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for TextField/TextArea/PasswordField/UsernameField/
// AbstractPickerField's `padding` — registered in `ownClassStyleDefaults`
// since each class shipped, but never painted as real CSS until this
// plan's `resolveDeclarations` fix (selectablelistrow-padding-resolvedeclarations-dedup.md).
// A fresh, separate file (not an addition to TextInputClassTier.test.ts)
// so each class's `.ClassName` rule is captured on its first-ever
// construction, without disturbing that file's own construction-order
// requirements (see its own file banner comment).
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { TextField } from '~/component/input/TextField';
import { TextArea } from '~/component/input/TextArea';
import { PasswordField } from '~/component/input/PasswordField';
import { UsernameField } from '~/component/input/UsernameField';
import { DateField } from '~/component/input/DateField';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

function declarationsDuring(
    sink: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = sink.writes.length;
    fn();

    const out: Record<string, string | null> = {};
    for (const w of sink.writes.slice(start)) {
        if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
            continue;
        }
        const styles = w.args[1] as Record<string, string | null>;
        for (const key of Object.keys(styles)) {
            out[key] = styles[key];
        }
    }
    return out;
}

describe('TextInput-family padding activation', () => {
    afterEach(() => DOM.reset());

    it('a rendered TextField carries no real padding on its own #id rule, and .TextField carries it', () => {
        const sink = installTestDOM(CONFIG);

        const start = sink.writes.length;
        const field = new TextField();
        const declarations = declarationsDuring(sink, idSelector(field), () => field.getElement(true));

        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.TextField') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.padding).toBe('3px 3px 3px 3px');
        expect(declarations.padding).toBeUndefined(); // TextField never calls setPadding itself
        expect(_ruleCacheHas('.TextField')).toBe(true);
        expect(field.getPadding()?.getTop()).toBe(3);
    });

    it('a rendered TextArea carries no real padding on its own #id rule, and .TextArea carries it', () => {
        const sink = installTestDOM(CONFIG);

        const start = sink.writes.length;
        const field = new TextArea();
        const declarations = declarationsDuring(sink, idSelector(field), () => field.getElement(true));

        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.TextArea') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.padding).toBe('3px 3px 3px 3px');
        expect(declarations.padding).toBeUndefined();
        expect(_ruleCacheHas('.TextArea')).toBe(true);
        expect(field.getPadding()?.getTop()).toBe(3);
    });

    it('a rendered PasswordField carries no real padding on its own #id rule, and .PasswordField carries it', () => {
        const sink = installTestDOM(CONFIG);

        const start = sink.writes.length;
        const field = new PasswordField();
        const declarations = declarationsDuring(sink, idSelector(field), () => field.getElement(true));

        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.PasswordField') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.padding).toBe('3px 3px 3px 3px');
        expect(declarations.padding).toBeUndefined();
        expect(_ruleCacheHas('.PasswordField')).toBe(true);
        expect(field.getPadding()?.getTop()).toBe(3);
    });

    it('a rendered UsernameField carries no real padding on its own #id rule, and .UsernameField carries it', () => {
        const sink = installTestDOM(CONFIG);

        const start = sink.writes.length;
        const field = new UsernameField();
        const declarations = declarationsDuring(sink, idSelector(field), () => field.getElement(true));

        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.UsernameField') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.padding).toBe('3px 3px 3px 3px');
        expect(declarations.padding).toBeUndefined();
        expect(_ruleCacheHas('.UsernameField')).toBe(true);
        expect(field.getPadding()?.getTop()).toBe(3);
    });

    it('a rendered DateField carries no real padding on its own #id rule, and .AbstractPickerField carries it', () => {
        const sink = installTestDOM(CONFIG);

        const start = sink.writes.length;
        const field = new DateField();
        const declarations = declarationsDuring(sink, idSelector(field), () => field.getElement(true));

        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.AbstractPickerField') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.padding).toBe('3px 3px 3px 3px');
        // The field's own #id rule, not (field as any)._input's — the inner
        // PickerInput has its own, separate, already-real `0px 3px 0px 3px`
        // padding (AbstractPickerField.ts:106), untouched by this plan.
        expect(declarations.padding).toBeUndefined();
        expect(_ruleCacheHas('.AbstractPickerField')).toBe(true);
        expect(field.getPadding()?.getLeft()).toBe(3);
    });
});
