// Reader preferences for the API reference viewer, persisted directly to
// `localStorage`. The docs app has no settings/preferences abstraction — a
// component never persists its own state, so `DocsShell` / `DocsContent`
// read and write this module directly, the same convention documented for
// every other framework component (see e.g.
// `packages/lib/docs/layouts/Split.md`).

/** `localStorage` key backing {@link loadShowInheritedMembers}. */
const SHOW_INHERITED_KEY = 'ts-ui-docs-show-inherited-members';

/**
 * Whether the API reference viewer should show inherited members.
 *
 * @returns `true` when the reader last chose to show inherited members;
 *   `false` (the default) when unset or unparseable.
 */
export function loadShowInheritedMembers(): boolean {
    return localStorage.getItem(SHOW_INHERITED_KEY) === 'true';
}

/**
 * Persists whether the API reference viewer should show inherited members.
 *
 * @param value - The new preference.
 */
export function saveShowInheritedMembers(value: boolean): void {
    localStorage.setItem(SHOW_INHERITED_KEY, String(value));
}
