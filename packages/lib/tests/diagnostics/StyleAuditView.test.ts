// @vitest-environment jsdom
//
// Coverage for the embeddable stylesheet-dedup audit view
// (plans/in-progress/diagnostics-overlay-style-audit-window.md, Expected
// Behaviour rows 10-12). Real production DOM (the jsdom pragma keeps
// tests/setup/node-setup.ts from installing the modelled DOM), so a real
// Component tree can be constructed and disposed the same way
// tests/overlay/Notification.styleRuleDisposal.test.ts's rule-leak
// assertion does. `_boundRefresh`/`_summary`/`_store` are reached through a
// private-field cast, the same pattern DiagnosticsOverlay.test.ts's
// `currentInstance()` uses for its private static instance slot.
import { describe, it, expect } from 'vitest';
import { Component } from '~/core/Component';
import { LayerManager } from '~/core/LayerManager';
import { Tooltip } from '~/overlay/Tooltip';
import type { Text } from '~/component/input/Text';
import type { Button } from '~/component/button/Button';
import { StyleRule, _ruleCacheKeys } from '~/core/StyleTarget';
import { _StyleAuditView as StyleAuditView } from '~/diagnostics/StyleAuditView';

/** Whether the module Tooltip registry still holds an attachment for this id — mirrors DiagnosticsOverlay.rowTooltips.test.ts's `hasTooltip`. */
function hasTooltip(id: string): boolean {
    return (Tooltip as unknown as { attachments: Map<string, unknown> }).attachments.has(id);
}

/** Forces the view's full subtree to render and mounts it into the live document, mirroring Notification.show(). */
function mount(view: InstanceType<typeof StyleAuditView>): void {
    LayerManager.mount(view.getElement(true)!);
}

function collectIds(c: Component): string[] {
    const ids = [c.getId()];

    for (const child of c.getComponents()) {
        ids.push(...collectIds(child));
    }

    return ids;
}

function internals(view: InstanceType<typeof StyleAuditView>) {
    return view as unknown as {
        _summary:       Text;
        _refreshButton: Button;
        _store:         { getRecords(): Array<{ get(field: string): unknown }> };
    };
}

/** Whether any row in the store's current snapshot has a `body` containing `needle`. */
function hasRowWithBody(store: { getRecords(): Array<{ get(field: string): unknown }> }, needle: string): boolean {
    return store.getRecords().some((record) => String(record.get('body')).includes(needle));
}

describe('StyleAuditView', () => {
    it('10. runs one audit immediately at construction', () => {
        const view = new StyleAuditView();

        expect(internals(view)._summary.getText()).not.toBe('');

        view.dispose();
    });

    it('11. clicking Refresh re-runs the audit', () => {
        const view  = new StyleAuditView();
        mount(view);
        const store = internals(view)._store;

        // Not present yet — nothing in the tree has this declaration body.
        expect(hasRowWithBody(store, 'chartreuse')).toBe(false);

        const a = new StyleRule({ scope: 'component', name: 'view-refresh-a', styles: { color: 'chartreuse' } });
        const b = new StyleRule({ scope: 'component', name: 'view-refresh-b', styles: { color: 'chartreuse' } });

        internals(view)._refreshButton.click();

        // The new duplicate (two #id rules sharing this body) now appears.
        expect(hasRowWithBody(store, 'chartreuse')).toBe(true);

        a.dispose();
        b.dispose();
        view.dispose();
    });

    it('12. disposing leaves no stylesheet rules from its own Button/Table chrome behind', () => {
        const view = new StyleAuditView();
        mount(view);
        const ids  = collectIds(view);

        expect(_ruleCacheKeys().some((key) => ids.some((id) => key.includes(id)))).toBe(true);

        view.dispose();

        const leaked = _ruleCacheKeys().filter((key) => ids.some((id) => key.includes(id)));

        expect(leaked).toEqual([]);
    });

    it("12b. disposing detaches the Refresh button's own hover tooltip", () => {
        const view          = new StyleAuditView();
        const refreshButton = internals(view)._refreshButton;
        const refreshId     = refreshButton.getId();

        mount(view);

        expect(hasTooltip(refreshId)).toBe(true);

        view.dispose();

        expect(hasTooltip(refreshId)).toBe(false);
    });
});
