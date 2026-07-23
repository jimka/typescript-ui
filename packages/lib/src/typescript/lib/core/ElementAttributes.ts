// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

/**
 * Deferred-write buffer for HTML element attributes. Sibling to
 * {@link InlineStyle}, but retains its full state rather than emptying it at
 * materialisation: {@link ElementAttributes.attach} writes the whole retained
 * set onto the element it binds to, so a component that releases its element
 * and renders a new one gets every attribute back from a single `attach`
 * call, the same rebuild property `InlineStyle` gets from `Component`'s
 * private fields via `applyStyle`.
 *
 * @category Core
 */
class ElementAttributes {
    private _handle:  Handle | null       = null;
    private _state:   Map<string, string> = new Map();
    private _pending: Set<string>         = new Set();

    /**
     * Writes a single attribute. Flushes immediately when the buffer is
     * attached to an element; otherwise queues the entry for the next attach
     * or flush.
     *
     * @param key - The attribute name.
     * @param value - The attribute value.
     */
    set(key: string, value: string): void {
        this._state.set(key, value);

        if (this._handle) {
            DOM.sink.apply(this._handle, { setAttr: { [key]: value } });
        } else {
            this._pending.add(key);
        }
    }

    /**
     * Removes a single attribute. Flushes immediately when the buffer is
     * attached to an element; otherwise queues the removal for the next
     * attach or flush.
     *
     * @param key - The attribute name to remove.
     */
    remove(key: string): void {
        this._state.delete(key);

        if (this._handle) {
            DOM.sink.apply(this._handle, { removeAttr: [key] });
        } else {
            this._pending.add(key);
        }
    }

    /**
     * Writes a single attribute into the retained state and the pending set
     * without flushing, even when the buffer is already attached. Callers
     * that own their own batching gate (e.g. `autoCommitAttributes = false`)
     * use this to accumulate writes that {@link ElementAttributes.flush} will
     * drain later.
     *
     * @param key - The attribute name.
     * @param value - The attribute value.
     */
    queue(key: string, value: string): void {
        this._state.set(key, value);
        this._pending.add(key);
    }

    /**
     * Queues a removal without flushing, even when the buffer is already
     * attached.
     *
     * @param key - The attribute name to remove.
     */
    queueRemove(key: string): void {
        this._state.delete(key);
        this._pending.add(key);
    }

    /**
     * Reads an attribute back from the retained state, not the DOM.
     *
     * @param key - The attribute name.
     *
     * @returns The stored value, or undefined if not set.
     */
    get(key: string): string | undefined {
        return this._state.get(key);
    }

    /**
     * Drains the pending set onto the attached element as one batched patch.
     * No-op when the buffer is not yet attached, or when nothing is pending.
     */
    flush(): void {
        if (!this._handle || this._pending.size === 0) return;

        const setAttr:    Record<string, string> = {};
        const removeAttr: string[]               = [];

        for (const key of this._pending) {
            const value = this._state.get(key);

            if (value === undefined) removeAttr.push(key);
            else                     setAttr[key] = value;
        }

        this._pending.clear();
        DOM.sink.apply(this._handle, { removeAttr, setAttr });
    }

    /**
     * Binds this buffer to a live element handle and writes the whole
     * retained state onto it as one patch, discarding any stale pending
     * entries from a previous attachment.
     *
     * @param handle - The element handle to attach to.
     */
    attach(handle: Handle): void {
        this._handle = handle;
        this._pending.clear();

        if (this._state.size === 0) return;

        const setAttr: Record<string, string> = {};

        for (const [key, value] of this._state) setAttr[key] = value;

        DOM.sink.apply(handle, { setAttr });
    }

    /**
     * Returns whether this buffer is attached to a live element handle.
     */
    isMaterialized(): boolean {
        return this._handle !== null;
    }
}

export { ElementAttributes };
