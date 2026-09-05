// Pure unit tests for the shared clipboard-menu-row builder. No DOM: the
// function is dependency-free, deciding row presence and enablement purely
// from the config it is given.
import { describe, it, expect, vi } from 'vitest';
import { buildClipboardMenuItems } from '~/component/shared/buildClipboardMenuItems';

describe('buildClipboardMenuItems', () => {
    it('returns Cut, Copy, Paste in that order when all three handlers are given', () => {
        const items = buildClipboardMenuItems({
            hasSelectedText: true,
            cut:   vi.fn(),
            copy:  vi.fn(),
            paste: vi.fn(),
        });

        expect(items.map(i => i.text)).toEqual(['Cut', 'Copy', 'Paste']);
    });

    it('enables Cut and Copy when hasSelectedText is true', () => {
        const items = buildClipboardMenuItems({
            hasSelectedText: true,
            cut:   vi.fn(),
            copy:  vi.fn(),
            paste: vi.fn(),
        });

        expect(items.find(i => i.text === 'Cut')?.enabled).toBe(true);
        expect(items.find(i => i.text === 'Copy')?.enabled).toBe(true);
    });

    it('disables Cut and Copy when hasSelectedText is false', () => {
        const items = buildClipboardMenuItems({
            hasSelectedText: false,
            cut:   vi.fn(),
            copy:  vi.fn(),
            paste: vi.fn(),
        });

        expect(items.find(i => i.text === 'Cut')?.enabled).toBe(false);
        expect(items.find(i => i.text === 'Copy')?.enabled).toBe(false);
    });

    it('never sets enabled on Paste, for either value of hasSelectedText', () => {
        const withSelection = buildClipboardMenuItems({
            hasSelectedText: true,
            cut:   vi.fn(),
            copy:  vi.fn(),
            paste: vi.fn(),
        });
        const withoutSelection = buildClipboardMenuItems({
            hasSelectedText: false,
            cut:   vi.fn(),
            copy:  vi.fn(),
            paste: vi.fn(),
        });

        expect(withSelection.find(i => i.text === 'Paste')?.enabled).toBeUndefined();
        expect(withoutSelection.find(i => i.text === 'Paste')?.enabled).toBeUndefined();
    });

    it('omits Cut and Paste rows entirely when only copy is given', () => {
        const enabled = buildClipboardMenuItems({ hasSelectedText: true, copy: vi.fn() });
        const disabled = buildClipboardMenuItems({ hasSelectedText: false, copy: vi.fn() });

        expect(enabled).toHaveLength(1);
        expect(enabled[0]).toMatchObject({ text: 'Copy', enabled: true });
        expect(disabled).toHaveLength(1);
        expect(disabled[0]).toMatchObject({ text: 'Copy', enabled: false });
    });

    it('returns an empty array when no handler is given', () => {
        expect(buildClipboardMenuItems({ hasSelectedText: false })).toEqual([]);
    });

    it('invokes each row\'s own handler exactly once, and no other handler', () => {
        const cut   = vi.fn();
        const copy  = vi.fn();
        const paste = vi.fn();

        const items = buildClipboardMenuItems({ hasSelectedText: true, cut, copy, paste });

        items.find(i => i.text === 'Cut')?.action?.();
        expect(cut).toHaveBeenCalledTimes(1);
        expect(copy).not.toHaveBeenCalled();
        expect(paste).not.toHaveBeenCalled();

        items.find(i => i.text === 'Copy')?.action?.();
        expect(copy).toHaveBeenCalledTimes(1);
        expect(cut).toHaveBeenCalledTimes(1);
        expect(paste).not.toHaveBeenCalled();

        items.find(i => i.text === 'Paste')?.action?.();
        expect(paste).toHaveBeenCalledTimes(1);
        expect(cut).toHaveBeenCalledTimes(1);
        expect(copy).toHaveBeenCalledTimes(1);
    });
});
