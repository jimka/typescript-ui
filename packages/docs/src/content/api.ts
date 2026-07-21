import { apiFiles, apiNav } from 'virtual:typedoc-api';
import type { ApiNavNode } from 'virtual:typedoc-api';
import { normalizeApiMarkdown } from './apiMarkdown.js';

/** Route path prefix every API page lives under. */
export const API_PREFIX = '/api';

const FILES = new Set(apiFiles);

/**
 * True when `path` is inside the API reference — `/api` itself or any path
 * nested under it.
 *
 * @param path - The route path to test.
 */
export function isApiPath(path: string): boolean {
    return path === API_PREFIX || path.startsWith(API_PREFIX + '/');
}

/**
 * Maps an API route to its generated file, trying `<rest>.md` first and
 * `<rest>/index.md` second — the same rule TypeDoc's own output follows for a
 * module/namespace index versus a leaf symbol page.
 *
 * @param path - The route path, e.g. `/api/core/classes/Component`.
 * @returns The file path relative to `packages/lib/docs/api`, or `null` when
 *   no generated file matches.
 */
export function apiFileFor(path: string): string | null {
    if (!isApiPath(path)) return null;

    const rest = path.slice(API_PREFIX.length).replace(/^\//, '');
    const direct = rest === '' ? 'index.md' : rest + '.md';

    if (FILES.has(direct)) return direct;

    const index = rest === '' ? null : rest + '/index.md';

    return index !== null && FILES.has(index) ? index : null;
}

/**
 * Maps a generated file back to its API route — the inverse of
 * {@link apiFileFor}.
 *
 * @param file - The file path relative to `packages/lib/docs/api`.
 * @returns The route path, e.g. `/api/core/classes/Component`.
 */
export function apiRouteFor(file: string): string {
    const withoutExt   = file.replace(/\.md$/, '');
    const withoutIndex = withoutExt === 'index' ? '' : withoutExt.replace(/\/index$/, '');

    return withoutIndex === '' ? API_PREFIX : `${API_PREFIX}/${withoutIndex}`;
}

/**
 * The directory part of a file path.
 *
 * @param file - The file path relative to `packages/lib/docs/api`.
 * @returns The directory, or `''` for a file at the tree root.
 */
export function apiDirOf(file: string): string {
    const slash = file.lastIndexOf('/');

    return slash === -1 ? '' : file.slice(0, slash);
}

/**
 * Fetches an API page's Markdown, normalized for the library viewer. Rejects
 * on a non-OK response.
 *
 * @param file - The file path relative to `packages/lib/docs/api`.
 * @returns The page's Markdown source, ready for `Markdown.setMarkdown`.
 */
export async function fetchApiPage(file: string): Promise<string> {
    const response = await fetch(`${import.meta.env.BASE_URL}api/${file}`);

    if (!response.ok) {
        throw new Error(`Failed to fetch API page ${file}: ${response.status}`);
    }

    return normalizeApiMarkdown(await response.text());
}

/**
 * The API Reference sidebar root, ready for `Tree.setNodes`.
 *
 * @returns TypeDoc's own navigation tree, normalized to app routes.
 */
export function getApiNav(): ApiNavNode[] {
    return apiNav;
}
