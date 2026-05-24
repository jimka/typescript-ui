# Binding Load Suppression — Implementation Plan

## Overview

On the BindingPanel demo, switching records causes the status label to read "Status: modified" before the user has touched a field, and the dirty-state veto on the *next* record switch then fails to engage. The label is wrong; the record is fine.

The cause is in [Binding.setRecord()](../src/typescript/lib/core/Binding.ts#L153-L177): the per-field population loop calls `entry.accessors.set(record.get(fieldName))` for every bound component. For Checkbox specifically ([Checkbox.ts:215-234](../src/typescript/lib/component/input/Checkbox.ts#L215-L234)), `setValue` → `setSelected` fires `notifyChange` on a real boolean transition. The listener registered by `bind()` at [Binding.ts:101-114](../src/typescript/lib/core/Binding.ts#L101-L114) then unconditionally writes the value back to the record *and* fans out `_changeListeners`, which is what flips the demo's status label at [BindingPanel.ts:111-113](../src/typescript/BindingPanel.ts#L111-L113).

The "veto bypass" on the *subsequent* switch is the inverse projection of the same issue. [ModelRecord.set](../src/typescript/lib/data/ModelRecord.ts#L63-L73) short-circuits on `isEqual`, so the spurious round-trip never flips `_dirty` — the veto registered at [BindingPanel.ts:203-213](../src/typescript/BindingPanel.ts#L203-L213) correctly stays silent because the record genuinely is clean. The label fires; the record doesn't lie.

Fix: add a private `_loading: boolean` guard to `Binding`. `setRecord` sets it `true` around the population loop; the change-write closure in `bind()` early-returns while it is set. User-driven `notifyChange` calls (real clicks, real keypresses) flow through unchanged because `_loading` is only true during `setRecord`'s programmatic write.

---

## Architecture Decisions

### A class-wide flag, not a per-binding suppression token

A per-entry "suppress next" token (e.g. `entry.suppressNext = true` before `entry.accessors.set(...)`) would also work, but couples the suppression state to each `BoundEntry` and depends on `notifyChange` firing synchronously *within* the `accessors.set` call. The class-wide `_loading` flag is simpler: one field, one `try` / `finally` in `setRecord`, one `if (this._loading) return;` at the top of the closure. It also correctly covers any indirect re-entry from a setter that, for example, schedules a synchronous post-render task — the entire population pass is the suppression window, not one `set` call at a time. The flag is private internal state; no public API change.

---

## Implementation

### New private field

Declared alongside the existing private fields at [Binding.ts:59-66](../src/typescript/lib/core/Binding.ts#L59-L66):

```typescript
private _loading: boolean = false;
```

### Guard the change-write closure

At [Binding.ts:101-114](../src/typescript/lib/core/Binding.ts#L101-L114), prepend the `_loading` check so a programmatic populate is a no-op for both the record write and the fan-out:

```typescript
acc.listen(() => {
    if (this._loading) {
        return;
    }

    if (!entry.active || !this._record) {
        return;
    }

    const value = acc.get();
    this._record.set(fieldName, value);

    for (const fn of this._changeListeners) {
        fn(fieldName, value);
    }

    this._validateFieldIfLive(fieldName);
});
```

### Wrap the population loop

At [Binding.ts:168-170](../src/typescript/lib/core/Binding.ts#L168-L170), set `_loading = true` before the loop and clear it in a `finally` so a throwing accessor cannot leave the binding wedged:

```typescript
this._loading = true;

try {
    for (const [fieldName, entry] of this._entries) {
        entry.accessors.set(record.get(fieldName));
    }
} finally {
    this._loading = false;
}
```

The validation pass at [Binding.ts:172-174](../src/typescript/lib/core/Binding.ts#L172-L174) stays *outside* the guard — it does not call `accessors.set` and its behaviour is unchanged.

---

## Ordered Implementation Steps

### Step 1 — Add the private field

In [Binding.ts](../src/typescript/lib/core/Binding.ts), add `private _loading: boolean = false;` next to the existing private fields at lines 59-66.

### Step 2 — Guard the change-write closure

Add the `if (this._loading) return;` early-return as the first statement inside the `acc.listen(...)` callback at [Binding.ts:101-114](../src/typescript/lib/core/Binding.ts#L101-L114).

### Step 3 — Wrap the population loop

Wrap the `for (const [fieldName, entry] of this._entries)` loop at [Binding.ts:168-170](../src/typescript/lib/core/Binding.ts#L168-L170) with `this._loading = true;` / `try` / `finally { this._loading = false; }`.

### Step 4 — Type-check

`npx tsc --noEmit` — must pass cleanly. The change is one private field, one early-return, and one `try`/`finally`; no signatures move.

### Step 5 — Manual smoke test

See `## Verification` below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Binding.ts` |

No new files. No deletions.

---

## Verification

1. **Type-check**: `npx tsc --noEmit` reports no new errors.
2. **No spurious "modified" on load** (BindingPanel demo):
   - Open BindingPanel. The first record loads via [BindingPanel.ts:194-199](../src/typescript/BindingPanel.ts#L194-L199).
   - Status label must read `Status: clean` immediately, *not* `Status: modified`.
   - Select a different record from the combo. Label must stay `Status: clean`.
3. **Real edits still flip the label**:
   - With a record loaded, toggle the `active` checkbox. Label must change to `Status: modified`.
   - Reject or commit. Label must return to `Status: clean`.
4. **Veto engages on subsequent switches**:
   - Load a record, edit the `Name` field (or toggle `active`) so the record is dirty.
   - Try to select a different record from the combo. The veto registered at [BindingPanel.ts:203-213](../src/typescript/BindingPanel.ts#L203-L213) must fire, the notification must appear, and the binding must stay on the original record.
5. **Validation still runs on load**: the validation pass at [Binding.ts:172-174](../src/typescript/lib/core/Binding.ts#L172-L174) runs after the guarded loop — fields with `setValidateOnChange(true)` and invalid initial values must still show their decorators after a `setRecord`.

---

## Critical Files

- [src/typescript/lib/core/Binding.ts](../src/typescript/lib/core/Binding.ts) — the file being modified; see lines 59-66 (private state), 101-114 (change-write closure), 153-177 (`setRecord`).
- [src/typescript/lib/component/input/Checkbox.ts](../src/typescript/lib/component/input/Checkbox.ts) — lines 215-234, the input that actually fires `notifyChange` on programmatic transitions and exposes the bug.
- [src/typescript/lib/component/input/AbstractInput.ts](../src/typescript/lib/component/input/AbstractInput.ts) — lines 174-182, `notifyChange` — the mechanism the fix suppresses for programmatic writes.
- [src/typescript/lib/data/ModelRecord.ts](../src/typescript/lib/data/ModelRecord.ts) — lines 63-73, `set` — the `isEqual` short-circuit that keeps the dirty flag honest even when the listener fan-out is not.
- [src/typescript/BindingPanel.ts](../src/typescript/BindingPanel.ts) — lines 111-113 (status label listener), 203-213 (veto wiring). Demo screen for the smoke test.
- [plans/implemented/binding-record-veto.md](implemented/binding-record-veto.md) — earlier plan that wired the veto path this fix preserves.

---

## Non-Goals

- **No public API change.** `_loading` is private internal state; no new exported types, methods, or listener channels.
- **No change to `ModelRecord.set` or `notifyChange` semantics.** The bug is in `Binding`'s fan-out, not in the input layer or the record layer; both behave correctly today.
- **No docs update.** Consumer-visible behaviour is now what the existing docs already claim (loading a record does not mark it dirty); nothing to amend.
