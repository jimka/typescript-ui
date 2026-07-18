import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProgressSpinner } from '~/component/display/ProgressSpinner';
import { Component } from '~/core/Component';
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

// Smoke-level scope only: ProgressSpinner is a pure animated spinner with no
// value/progress API, so the animation/keyframe and theme-change re-derivation
// paths are out of scope.
beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('ProgressSpinner construction', () => {
    it('sets the preferred size to the explicit diameter', () => {
        const spinner = new ProgressSpinner(24);
        const pref = spinner.getPreferredSize()!;

        expect(pref.width).toBe(24);
        expect(pref.height).toBe(24);
        expect(spinner.getSpinnerSize()).toBe(24);
    });
    it('defaults to the 14px theme fallback when no size is given', () => {
        // With no `--ts-ui-font-size` themeVar configured, the spinner reports
        // the documented 14px fallback before any post-attach theme read.
        const spinner = new ProgressSpinner();

        expect(spinner.getSpinnerSize()).toBe(14);
    });
    it('constructs without throwing', () => {
        expect(() => new ProgressSpinner(20)).not.toThrow();
    });
    it('updates the diameter via setSpinnerSize', () => {
        const spinner = new ProgressSpinner(20);

        spinner.setSpinnerSize(32);

        expect(spinner.getSpinnerSize()).toBe(32);
        expect(spinner.getPreferredSize()!.width).toBe(32);
    });
    it('applies a { spinnerSize } option', () => {
        const spinner = new ProgressSpinner(20, { spinnerSize: 40 });

        expect(spinner.getSpinnerSize()).toBe(40);
    });
});

describe('ProgressSpinner effective-visibility pause (case 2)', () => {
    it('pauses the rotating arc animation when hidden, resumes it when shown', () => {
        const spinner = new ProgressSpinner(20);
        spinner.getElement(true);

        // The arc carries the keyframe animation (see ProgressSpinner's
        // constructor); the effective-visibility walk reaches it as a
        // descendant of the spinner, not the spinner's own root element.
        const arc = (spinner as unknown as { _arc: Component })._arc;

        spinner.setVisible(false);
        Component.flushEffectiveVisibility();

        expect(arc.getAnimationPlayState()).toBe('paused');

        spinner.setVisible(true);
        Component.flushEffectiveVisibility();

        expect(arc.getAnimationPlayState()).toBeNull();
    });
});
