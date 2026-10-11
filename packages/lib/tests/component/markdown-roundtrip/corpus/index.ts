import { COMMONMARK_CASES } from './commonmark';
import { DIALECT_CASES } from './dialect';
import { ENTER_INSIDE_HTML_CASES } from './enterInsideHtml';
import { REFERENCE_LINK_CASES } from './referenceLinks';
import type { CorpusCase } from './types';

/** Every corpus case the round-trip harness runs, in source order. */
export const CORPUS: readonly CorpusCase[] = [...COMMONMARK_CASES, ...DIALECT_CASES, ...REFERENCE_LINK_CASES, ...ENTER_INSIDE_HTML_CASES];
