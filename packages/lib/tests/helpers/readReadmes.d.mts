// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Type declarations for the plain-ESM README reader, so the test importing it stays
// strongly typed without `@types/node` entering the test program.

/** The two README files as UTF-8 text: `packages/lib/README.md` and the repo root's. */
export function readReadmes(): { package: string; root: string };
