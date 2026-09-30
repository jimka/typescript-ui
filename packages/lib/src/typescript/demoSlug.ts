// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Slugifies a section label into a stable URL segment: lower-cased, every run
 * of non-alphanumeric characters collapsed to one `-`, and a leading or
 * trailing `-` stripped.
 *
 * @param label - The section's displayed label, punctuation and spaces
 *   included ("Misc.", "Layout I/O").
 * @returns The label's URL segment ("misc", "layout-i-o").
 *
 * @remarks Its own module, importing nothing, so the transform deciding all 32
 * of the app's routes can be unit-tested without loading the 32 panel modules
 * `demoSections.ts` holds. Routing every section through this helper — rather
 * than through a separately written slug list — is what keeps a label and its
 * URL from drifting.
 */
export function slugify(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
