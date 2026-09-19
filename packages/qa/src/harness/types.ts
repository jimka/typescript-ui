// The harness's own types. Nothing here names a library type: the harness is
// library-free, and the page hands it the two library objects it needs.

/** A loosely typed object, for reaching into library instances by name. */
export type AnyObj = Record<string, unknown>;

/** The two library objects the page passes in, from its own import of the library's `core` entry point. */
export interface HarnessLibrary {
    /** The page's `Body` singleton class; the root of every component-tree walk. */
    Body: { getInstance(): object };
    /** The library's DOM seam swap point; the seam counter wraps its sink and source. */
    DOM: { sink: object; source: object; install(impls: { sink?: object; source?: object }): void };
}

/** What a mounted panel gives the harness. */
export interface Subject {
    /** The `drive=` value used when the URL has none. */
    defaultDrive: string;
    /** Driver name → the thing that driver acts on. */
    targets: Record<string, unknown>;
    /** Label → geometry probe target, sampled under `geom=1`. */
    geometry?: Record<string, GeometryTarget>;
    /** Host fields, stored under `before.host`. */
    describe?(): AnyObj;
    /** Extra work counters, installed under `work=1` after the harness's own; returns notes. */
    installWork?(tools: HarnessTools): string[];
}

/** What `PanelHost.setup` receives. */
export interface SetupContext {
    /** The page's URL parameters. */
    params: URLSearchParams;
    /** The run's notes; setup may append to them. */
    notes: string[];
    /** The harness tools. */
    tools: HarnessTools;
}

/** How `runQa` finds and mounts panels; `src/mount.ts` provides the real one. */
export interface PanelHost {
    /** Every registered panel id. */
    ids(): string[];
    /** Mounts panel `id` and resolves to what the harness measures. */
    setup(id: string, ctx: SetupContext): Promise<Subject>;
}

/** What the page hands `runQa`. */
export interface RunOptions {
    /** The library objects the harness needs. */
    lib: HarnessLibrary;
    /** Names the library build under test in the report (the page passes `__QA_LIB__`). */
    build: string | null;
    /** The panel registry and mounter. */
    panels: PanelHost;
}

/** A CSS selector, or a component (resolved through its id). */
export type GeometryTarget = string | { getId(): string };

/** Drives `ctx.units` units and returns one timing sample (ms) per measured unit. */
export type Driver = (ctx: DriveContext) => Promise<number[]>;

/** What a driver receives for one phase. */
export interface DriveContext {
    /** The panel's target for this driver. */
    target: unknown;
    /** How many units (frames or passes) to drive. */
    units: number;
    /** Pixels per unit, for drivers that move something. */
    stepPx: number;
    /** The page's URL parameters. */
    params: URLSearchParams;
    /** The run's notes; a driver may append to them. */
    notes: string[];
    /** The harness tools. */
    tools: HarnessTools;
}

/** Patches the page at runtime and returns a one-line note saying what it did. */
export type Ablation = (tools: HarnessTools) => string;

/** The helpers the harness shares with drivers, ablations and panels. */
export interface HarnessTools {
    /** Resolves after `ms` milliseconds. */
    sleep(ms: number): Promise<void>;
    /** Polls `probe` until it returns a truthy value, or rejects with `timeout waiting for <label>`. */
    waitFor<T>(probe: () => T | null | undefined | false, timeoutMs: number, label: string): Promise<T>;
    /** Dispatches a bubbling, cancelable `MouseEvent` with `button: 0`; `init.buttons` defaults to `type === 'mouseup' ? 0 : 1`, `init.relatedTarget` to `null`. */
    fireMouse(type: string, target: EventTarget, x: number, y: number, init?: { buttons?: number; relatedTarget?: EventTarget | null }): void;
    /** Whether `el` has a non-empty box inside the viewport and no hidden or undisplayed ancestor. */
    isPainted(el: Element): boolean;
    /** How many elements matching `selector` are painted. */
    countPainted(selector: string): number;
    /** The first button whose text or `aria-label` contains `text`; throws when there is none. */
    findButtonByText(text: string): HTMLElement;
    /** `document.getElementById(component.getId())` — a component's element id is its component id. */
    elementOf(component: { getId(): string }): HTMLElement | null;
    /** Every live component, depth first from `Body`. */
    walkComponents(): AnyObj[];
    /** The constructor name of `obj`. */
    className(obj: object): string;
    /** Whether a class named `name` is in `obj`'s prototype chain. */
    isA(obj: object, name: string): boolean;
    /** The first live component whose prototype chain includes `name`. */
    findComponent(name: string): AnyObj | null;
    /** The first live layout manager whose prototype chain includes `name`. */
    findLayoutManager(name: string): AnyObj | null;
    /** The nearest prototype in `obj`'s chain that owns `method`. */
    ownerProto(obj: object, method: string): AnyObj | null;
    /** The furthest prototype in `obj`'s chain that owns `method` — the base declaration. */
    rootOwnerProto(obj: object, method: string): AnyObj | null;
    /** Replaces `method` on its owning prototype with a no-op; returns a note. */
    noopOnOwningProto(obj: object, method: string): string;
    /** Tallies every call of `method` as `<label>@<receiver class>` under the work counters; returns a note. */
    countMethod(obj: object, method: string, label?: string, root?: boolean): string;
    /** Adds one to work counter `kind` while counting. */
    bumpWork(kind: string): void;
    /** Adds one to write counter `kind` while counting. */
    bumpWrite(kind: string): void;
    /** Increments once per driven unit; per-pass memo ablations key on it. */
    currentFrame(): number;
    /** rAF loop: per frame, records the gap, advances the frame counter, runs `step`, samples geometry; rejects if that work throws. */
    runFrames(units: number, step: (index: number) => void): Promise<number[]>;
    /** Synchronous loop with the same bookkeeping; each sample is `step`'s own duration. */
    runPasses(units: number, step: (index: number) => void): Promise<number[]>;
}

/** A timing summary over a list of samples, in milliseconds. */
export interface FrameSummary {
    /** How many samples. */
    n: number;
    /** Mean sample. */
    avgMs: number;
    /** Median sample. */
    p50Ms: number;
    /** 90th-percentile sample. */
    p90Ms: number;
    /** Largest sample. */
    maxMs: number;
    /** How many samples exceed one 60 Hz frame. */
    over16: number;
}

/** One driven phase of a run. */
export interface PhaseReport {
    /** The driver's name. */
    driver: string;
    /** How many units it drove. */
    units: number;
    /** The phase's timing samples, summarised. */
    timing: FrameSummary;
    /** `count=1`: native write/mutation/forced-read counters, per unit. */
    writes?: Record<string, number>;
    /** `count=1`: first distinct stacks per forced-read API. */
    forcedStacks?: Record<string, string[]>;
    /** `work=1`: per-class method-call counters, per unit. */
    work?: Record<string, number>;
    /** `seam=1`: DOM seam calls by method name, per unit. */
    seam?: { sink: Record<string, number>; source: Record<string, number> };
    /** `geom=1`: one `[x, y, width, height]` (rounded) per unit and label; `null` when the target has no element. */
    geometry?: Record<string, Array<[number, number, number, number] | null>>;
}

/** The JSON body one run POSTs to `/__qa/report`. */
export interface QaReport {
    /** The report format's version; always `1`. */
    schema: 1;
    /** The `qa=` name the run reports under. */
    name: string;
    /** The measured panel's id; `''` when the run failed before one was named. */
    panel: string;
    /** The `host=` URL value, or `null`. */
    host: string | null;
    /** The library build under test. */
    build: string | null;
    /** Every URL parameter of the run. */
    params: Record<string, string>;
    /** The host engine's user-agent string. */
    ua: string;
    /** What the run did along the way, in order. */
    notes: string[];
    /** The page before any phase ran. */
    before?: AnyObj;
    /** Idle frames before the phases. */
    idle?: FrameSummary;
    /** The driven phases, in order. */
    phases?: PhaseReport[];
    /** Idle frames after the phases. */
    idleAfter?: FrameSummary;
    /** Why the run failed; absent on success. */
    error?: string;
    /** The failure's stack, when it had one. */
    stack?: string;
}
