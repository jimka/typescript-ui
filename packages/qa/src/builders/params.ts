// URL parameters a panel reads to choose among its targets. A parameter only
// picks which element or which mutation a driver gets; it never changes the
// component tree, which the panel id alone fixes.

/**
 * Reads a panel parameter that takes one of a fixed list of values.
 *
 * @param params - The page's URL parameters.
 * @param name - The parameter, e.g. `grip`.
 * @param allowed - The values it takes; the first is the default.
 * @param panel - The panel's id, for the error.
 * @returns The parameter's value, or `allowed[0]` when it is absent or empty.
 * @throws Error - `<panel>: unknown <name> "<value>" (expected <allowed>)` for any other value.
 */
export function choice<T extends string>(params: URLSearchParams, name: string, allowed: readonly T[], panel: string): T {
    const raw = params.get(name);

    if (raw === null || raw === '') {
        return allowed[0];
    }

    if (!(allowed as readonly string[]).includes(raw)) {
        throw new Error(`${panel}: unknown ${name} "${raw}" (expected ${allowed.join(', ')})`);
    }

    return raw as T;
}
