// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Type declarations for the plain-ESM garbage-collection trigger, so the test
// importing it stays strongly typed without `@types/node` entering the test program.

/** Runs one full, synchronous garbage collection. */
export function forceGc(): void;
