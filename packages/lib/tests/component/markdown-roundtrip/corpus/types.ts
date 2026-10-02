import type { DivergenceId } from './divergences';

/**
 * One of the checks the harness runs on every corpus case. `parity`, `idempotence` and `verbatim` read the editor's
 * save, which writes an unedited document as loaded; `canonical` and `canonicalIdempotence` read its standard-form
 * save, which ignores the source map, so they are the ones that test the serializer. `edits` is the edit fuzz's
 * (`markdown-edit-fuzz.test.ts`) check that a save after random edits re-lexes to what the editor showed; a random
 * edit may or may not reach a listed divergence, so the fuzz skips that check for a listed case rather than
 * asserting it fails.
 */
export type HarnessCheck = 'parity' | 'idempotence' | 'surface' | 'verbatim' | 'canonical' | 'canonicalIdempotence' | 'edits';

/** One corpus document and the checks the current editor is known to fail on it. */
export interface CorpusCase {
    readonly name:   string;                                         // unique test title
    readonly source: string;                                         // the document exactly as authored
    readonly links?: readonly string[];                              // link targets the viewer must read, in order
    readonly known?: Partial<Record<HarnessCheck, DivergenceId>>;    // checks the current editor fails
}
