// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Type declarations for the plain-JS manifest generator, so tests importing its pure
// helpers stay strongly typed. TypeDoc reflection nodes are untyped JSON, hence `any`.

/** A curated seam entry (subset used by the resolvers). */
export interface ManifestEntry {
    symbol: string;
    subpath?: string;
    doc?: string;
    task?: string;
}

/** Index every exported class/interface by owning module (= import subpath). */
export function buildSymbolIndex(model: any): Map<string, Map<string, any>>;

/** Resolve an entry to exactly one `(subpath, node)` match, or throw. */
export function resolveSymbol(entry: ManifestEntry, index: Map<string, Map<string, any>>): { subpath: string; node: any };

/** Extract a one-line, link-stripped summary from a symbol's JSDoc. */
export function summarize(node: any): string;

/** Resolve a row's canonical repo-relative doc target, or null (pushing a warning). */
export function resolveDoc(entry: ManifestEntry, warnings: string[]): string | null;

/** Render a canonical target as a link in `"fs"` or `"site"` mode. */
export function linkFor(target: string, mode: "fs" | "site"): string;

/** Replace `{{key}}` placeholders in a prose block with mode-resolved links. */
export function interpolateProse(text: string, mode: "fs" | "site"): string;

/** Estimate token cost as `ceil(chars / 4)`. */
export function estimateTokens(text: string): number;
