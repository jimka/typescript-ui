// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Local type override for the lazily-imported optional peer dependency `elkjs`,
// mapped onto the `elkjs/lib/elk.bundled.js` specifier through `tsconfig.json`
// `paths`. It shadows the package's own shipped types on purpose: `elkjs` is an
// optional peer dep that may be absent at typecheck, and its bundled `.d.ts`
// does not type-check cleanly under this project's strict settings. Keeping the
// declaration here confines all ELK typing to the diagram family; the richer ELK
// graph shapes are modelled in `ElkLayoutEngine.ts`.

/** Constructor arguments for the ELK engine. */
export interface ElkConstructorOptions {
    /** URL of a consumer-hosted `elk-worker.js` for off-thread layout. */
    workerUrl?: string;
    /** Consumer-supplied factory returning a Web Worker for off-thread layout. */
    workerFactory?: (url?: string) => Worker;
}

/** The ELK layout engine — takes a graph JSON, returns it annotated. */
export default class ELK {
    constructor(options?: ElkConstructorOptions);
    layout(graph: unknown): Promise<unknown>;
    /**
     * Terminates the underlying Web Worker. Only safe on an instance built
     * from a `workerFactory`: in every other mode elkjs drives an in-process
     * stand-in worker that has no `terminate`, and this throws a `TypeError`.
     */
    terminateWorker(): void;
}
