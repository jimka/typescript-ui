import { describe, it, expect, afterEach } from 'vitest';
import { AccordionIndicator } from '~/component/container/AccordionIndicator';
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

// The module-level DEFAULT_CHEVRON character (AccordionIndicator.ts L33). Not
// exported; mirrored here only to assert the documented default.
const DEFAULT_CHEVRON = '▶'; // ▶

describe('AccordionIndicator expanded state', () => {
    afterEach(() => DOM.reset());

    it('defaults expanded to false', () => {
        installTestDOM(CONFIG);

        expect(new AccordionIndicator().getExpanded()).toBe(false);
    });

    it('round-trips setExpanded and clearExpanded', () => {
        installTestDOM(CONFIG);

        const indicator = new AccordionIndicator();

        indicator.setExpanded(true);

        expect(indicator.getExpanded()).toBe(true);

        indicator.clearExpanded();

        expect(indicator.getExpanded()).toBe(false);
    });

    it('honours the expanded option', () => {
        installTestDOM(CONFIG);

        expect(new AccordionIndicator({ expanded: true }).getExpanded()).toBe(true);
    });
});

describe('AccordionIndicator character', () => {
    afterEach(() => DOM.reset());

    it('defaults the character to DEFAULT_CHEVRON', () => {
        installTestDOM(CONFIG);

        expect(new AccordionIndicator().getCharacter()).toBe(DEFAULT_CHEVRON);
    });

    it('round-trips setCharacter and the character option', () => {
        installTestDOM(CONFIG);

        expect(new AccordionIndicator({ character: '+' }).getCharacter()).toBe('+');

        const indicator = new AccordionIndicator();

        indicator.setCharacter('-');

        expect(indicator.getCharacter()).toBe('-');
    });
});

describe('AccordionIndicator render', () => {
    afterEach(() => DOM.reset());

    it('writes the chevron text and applies .expanded when expanded at first paint', () => {
        installTestDOM(CONFIG);

        const sink = installTestDOM(CONFIG);

        const indicator = new AccordionIndicator({ expanded: true, character: 'X' });

        // Force render via getElement(true).
        indicator.getElement(true);

        // render() writes the character as text and adds the .expanded class for
        // an initially-expanded indicator. Assert both landed on the recording
        // sink as patch writes.
        const texts = sink.writes
            .filter((w) => w.op === 'apply')
            .map((w) => w.args[1] as { text?: string; addClass?: string[] });

        expect(texts.some((p) => p.text === 'X')).toBe(true);
        expect(texts.some((p) => p.addClass?.includes('expanded'))).toBe(true);
    });
});
