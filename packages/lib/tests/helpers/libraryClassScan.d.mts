// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Type declarations for the plain-ESM library source scanner, so the tests
// importing it stay strongly typed without `@types/node` entering the test
// program. See the module for why.

/** Class names declaring `protected destructor(` — the teardown registry's source of truth. */
export function classesDeclaringDestructor(): string[];

/** Class names calling `Event.addListener(this, ...)` / `addSubtreeListener` / `addViewportListener` — the listener registry's source of truth. */
export function classesRegisteringEventListeners(): string[];
