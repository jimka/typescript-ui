import type { DivergenceId } from './divergences';

/** One of the three checks the harness runs on every corpus case. */
export type HarnessCheck = 'parity' | 'idempotence' | 'surface';

/** One corpus document and the checks the current editor is known to fail on it. */
export interface CorpusCase {
    readonly name:   string;                                         // unique test title
    readonly source: string;                                         // the document exactly as authored
    readonly links?: readonly string[];                              // link targets the viewer must read, in order
    readonly known?: Partial<Record<HarnessCheck, DivergenceId>>;    // checks the current editor fails
}
