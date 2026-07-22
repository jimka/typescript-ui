// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Fit } from "~/layout/Fit.js";
import { FillType } from "~/layout/FillType.js";
import { ProgressSpinner } from "~/component/display/ProgressSpinner.js";

/**
 * Shared visual recipe for the placeholder [`Animation.materialize`](/api/core/namespaces/Animation/functions/materialize)
 * mounts while it waits on a deferred build: {@link Tab}'s lazy-tab
 * activation and {@link AbstractWindow}'s `setContentFactory` both need the
 * same centred spinner, so the construction lives here as the single source
 * of truth rather than duplicated at each call site.
 *
 * @category Core
 */

/**
 * Builds the spinner placeholder `Animation.materialize` mounts into its host:
 * a fixed-size `ProgressSpinner` wrapped in a [`Fit`](/api/layout/classes/Fit)
 * layout configured with `FillType.NONE` so the spinner sits at its preferred
 * size in the geometric centre of the host's content area. The diameter
 * (24 px) matches `TablePanel`'s store-loading spinner so a slow deferred
 * build and a slow data load look identical to the user.
 *
 * @returns A Component owning a single `ProgressSpinner` child.
 */
export function createSpinnerWrap(): Component {
    const wrap = new Component();
    wrap.setLayoutManager(new Fit({ fill: FillType.NONE }));
    wrap.addComponent(new ProgressSpinner(24));

    return wrap;
}
