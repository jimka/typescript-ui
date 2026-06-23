// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { StatusBar } from '~/component/container/StatusBar';
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

describe('StatusBar message', () => {
    afterEach(() => DOM.reset());

    it('defaults message and defaultMessage to empty strings', () => {
        installTestDOM(CONFIG);

        const bar = new StatusBar();

        expect(bar.getMessage()).toBe('');
        expect(bar.getDefaultMessage()).toBe('');
    });

    it('round-trips setMessage', () => {
        installTestDOM(CONFIG);

        const bar = new StatusBar();

        bar.setMessage('Saved');

        expect(bar.getMessage()).toBe('Saved');
    });

    it('round-trips setDefaultMessage and shows it when no message is in flight', () => {
        installTestDOM(CONFIG);

        const bar = new StatusBar();

        bar.setDefaultMessage('Ready');

        // No transient message pending, so the default surfaces immediately.
        expect(bar.getDefaultMessage()).toBe('Ready');
        expect(bar.getMessage()).toBe('Ready');
    });

    it('shows the configured initial message and seeds from defaultMessage', () => {
        installTestDOM(CONFIG);

        expect(new StatusBar({ message: 'Hi' }).getMessage()).toBe('Hi');
        expect(new StatusBar({ defaultMessage: 'Idle' }).getMessage()).toBe('Idle');
    });

    it('clearMessage reverts to the default message', () => {
        installTestDOM(CONFIG);

        const bar = new StatusBar({ defaultMessage: 'Ready' });

        bar.setMessage('Working');

        expect(bar.getMessage()).toBe('Working');

        bar.clearMessage();

        expect(bar.getMessage()).toBe('Ready');
    });
});

describe('StatusBar timed message revert', () => {
    afterEach(() => {
        vi.useRealTimers();
        DOM.reset();
    });

    it('restores the default message after the timeout via fake timers', () => {
        vi.useFakeTimers();
        installTestDOM(CONFIG);

        const bar = new StatusBar({ defaultMessage: 'Ready' });

        bar.setMessage('Saved', 2000);

        expect(bar.getMessage()).toBe('Saved');

        // Deterministic timer test — advance past the timeout, no real wait.
        vi.advanceTimersByTime(2000);

        expect(bar.getMessage()).toBe('Ready');
    });

    it('a later setMessage cancels the pending revert', () => {
        vi.useFakeTimers();
        installTestDOM(CONFIG);

        const bar = new StatusBar({ defaultMessage: 'Ready' });

        bar.setMessage('First', 2000);
        bar.setMessage('Second'); // persistent — cancels the pending revert

        vi.advanceTimersByTime(5000);

        expect(bar.getMessage()).toBe('Second');
    });
});
