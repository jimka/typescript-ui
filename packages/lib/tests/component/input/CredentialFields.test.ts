// UsernameField / PasswordField seed browser-credential-manager wiring
// (autocomplete + name) at construction time via gated setter calls in the
// constructor body — not the `_defaultXFieldOptions` bag, since neither
// getAutoComplete() nor getName() folds that bag (see the plan's Architecture
// Decisions). Each case mounts exactly one field per `it()` so `lastSetAttr`
// (which scans every recorded write, not just one handle) never sees a
// second field's writes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UsernameField } from '~/component/input/UsernameField';
import { PasswordField } from '~/component/input/PasswordField';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
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
afterEach(() => DOM.reset());

/** Latest recorded `setAttr` value for `attr` on any handle, or undefined. */
function lastSetAttr(attr: string): unknown {
    let value: unknown;

    for (const w of sink.writes) {
        if (w.op !== 'apply') {
            continue;
        }

        const patch = w.args[1] as { setAttr?: Record<string, unknown> };

        if (patch?.setAttr && attr in patch.setAttr) {
            value = patch.setAttr[attr];
        }
    }

    return value;
}

/**
 * The class-hierarchy-cascade prefix of the `addClass` array from the first
 * `apply` write that adds the framework's base `ts-ui-component` token
 * (mirrors `ClassHierarchyCascade.test.ts`'s "case 2") — everything up to
 * and including the leaf class name. A style trait's own class token and the
 * height value-class token (`h<h>px`) are appended after the leaf name in
 * the same write; both are covered by their own dedicated test files, so
 * this helper trims them rather than pinning their incidental values here.
 */
function baseClassChainPrefix(writes: RecordingDOMSink['writes'], leafClassName: string): string[] | undefined {
    for (const w of writes) {
        if (w.op !== 'apply') {
            continue;
        }

        const patch = w.args[1] as { addClass?: string[] };

        if (Array.isArray(patch.addClass) && patch.addClass.includes('ts-ui-component')) {
            const leafIndex = patch.addClass.indexOf(leafClassName);

            return leafIndex === -1 ? patch.addClass : patch.addClass.slice(0, leafIndex + 1);
        }
    }

    return undefined;
}

describe('UsernameField credential defaults', () => {
    it('carries TextField in its class chain, between TextInput and UsernameField', () => {
        const field = new UsernameField();

        field.getElement(true);

        expect(baseClassChainPrefix(sink.writes, 'UsernameField')).toEqual([
            'ts-ui-component', 'AbstractInput', 'TextInput', 'TextField', 'UsernameField',
        ]);
    });

    it('defaults autocomplete to "username"', () => {
        const field = new UsernameField();

        field.getElement(true);

        expect(field.getAutoComplete()).toBe('username');
        expect(lastSetAttr('autocomplete')).toBe('username');
    });

    it('defaults name to "username"', () => {
        const field = new UsernameField();

        field.getElement(true);

        expect(field.getName()).toBe('username');
        expect(lastSetAttr('name')).toBe('username');
    });

    it('renders type="text"', () => {
        const field = new UsernameField();

        field.getElement(true);

        expect(lastSetAttr('type')).toBe('text');
    });

    it('email: true switches autocomplete to "email"', () => {
        const field = new UsernameField({ email: true });

        field.getElement(true);

        expect(field.getAutoComplete()).toBe('email');
        expect(lastSetAttr('autocomplete')).toBe('email');
    });

    it('a caller-supplied autoComplete overrides the default', () => {
        const field = new UsernameField({ autoComplete: 'off' });

        field.getElement(true);

        expect(field.getAutoComplete()).toBe('off');
    });

    it('a caller-supplied name overrides the default', () => {
        const field = new UsernameField({ name: 'user' });

        field.getElement(true);

        expect(field.getName()).toBe('user');
    });
});

describe('PasswordField credential defaults', () => {
    it('carries TextField in its class chain, between TextInput and PasswordField', () => {
        const field = new PasswordField();

        field.getElement(true);

        expect(baseClassChainPrefix(sink.writes, 'PasswordField')).toEqual([
            'ts-ui-component', 'AbstractInput', 'TextInput', 'TextField', 'PasswordField',
        ]);
    });

    it('defaults autocomplete to "current-password"', () => {
        const field = new PasswordField();

        field.getElement(true);

        expect(field.getAutoComplete()).toBe('current-password');
        expect(lastSetAttr('autocomplete')).toBe('current-password');
    });

    it('defaults name to "password"', () => {
        const field = new PasswordField();

        field.getElement(true);

        expect(field.getName()).toBe('password');
        expect(lastSetAttr('name')).toBe('password');
    });

    it('renders type="password"', () => {
        const field = new PasswordField();

        field.getElement(true);

        expect(lastSetAttr('type')).toBe('password');
    });

    it('newPassword: true switches autocomplete to "new-password"', () => {
        const field = new PasswordField({ newPassword: true });

        field.getElement(true);

        expect(field.getAutoComplete()).toBe('new-password');
    });

    it('a caller-supplied autoComplete overrides the default', () => {
        const field = new PasswordField({ autoComplete: 'off' });

        field.getElement(true);

        expect(field.getAutoComplete()).toBe('off');
    });

    it('an explicit autoComplete wins over newPassword', () => {
        const field = new PasswordField({ newPassword: true, autoComplete: 'off' });

        field.getElement(true);

        expect(field.getAutoComplete()).toBe('off');
    });
});
