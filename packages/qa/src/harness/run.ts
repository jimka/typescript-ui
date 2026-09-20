// One measurement run: mount the panel, instrument the page, snapshot it,
// drive the phases and POST one report. Generalises Loom's `run()`: the
// panel, its targets and its default phases come from the panel host instead
// of from Loom's shell. Nothing here runs at import time.

import { ABLATIONS } from './ablations.js';
import {
    bumpWork,
    bumpWrite,
    countMethod,
    installDeepStyleCounters,
    installSeamCounters,
    installWorkCounters,
    installWriteCounters,
    startCounting,
    stopCounting,
} from './counters.js';
import { countPainted, elementOf, findButtonByText, fireMouse, isPainted, sleep, waitFor } from './dom.js';
import { DRIVERS } from './drivers.js';
import { currentFrame, measureIdle, runFrames, runPasses, summarize } from './frames.js';
import { setGeometryTargets, snapshotBefore, takeGeometry } from './probes.js';
import { className, findComponent, findLayoutManager, isA, noopOnOwningProto, ownerProto, rootOwnerProto, walkComponents } from './tree.js';
import type { AnyObj, GeometryTarget, HarnessLibrary, HarnessTools, PanelHost, PhaseReport, QaReport, RunOptions, Subject } from './types.js';

/** Units for a phase given without `:<units>`, when the URL has no `frames=`. Loom's default, so the app's phases match the campaign's. */
const DEFAULT_UNITS = 150;

/** Pixels per unit for `drag` and `resize`, when the URL has no `step=`. Loom's default, for the same reason. */
const DEFAULT_STEP_PX = 3;

/** Idle frames measured before the phases; Loom's count. */
const IDLE_BEFORE_FRAMES = 60;

/** Idle frames measured after the phases; Loom's count. */
const IDLE_AFTER_FRAMES = 30;

/** Loom's wait after injecting a stylesheet or applying ablations: long enough for a restyle and one layout flush. */
const SETTLE_MS = 800;

/** A `:<units>` count: a positive integer written in digits. */
const UNIT_COUNT = /^[1-9]\d*$/;

/** One phase to drive: a driver and its unit count. */
interface Phase {
    driver: string;
    units: number;
}

/** What every step of a run shares. */
interface RunContext {
    params: URLSearchParams;
    notes: string[];
    tools: HarnessTools;
    lib: HarnessLibrary;
}

/** The measured part of a successful report. */
type Measurements = Required<Pick<QaReport, 'before' | 'idle' | 'phases' | 'idleAfter'>>;

/**
 * Runs one measurement when the page URL carries `qa=<name>`, and POSTs one
 * report under that name. A failure anywhere after the name is read posts an
 * error report instead, so a run always ends with a result.
 *
 * @param options - The library objects, the build under test and the panel host.
 * @returns A promise that resolves once the report is posted, or at once without `qa=`.
 */
export async function runQa(options: RunOptions): Promise<void> {
    const params = new URLSearchParams(location.search);
    const name = params.get('qa');

    if (!name) {
        return;
    }

    const run: RunContext = { params, notes: [], tools: createTools(options.lib), lib: options.lib };

    const report: QaReport = {
        schema: 1,
        name,
        panel: params.get('panel') ?? '',
        host: params.get('host'),
        build: options.build,
        params: Object.fromEntries(params),
        ua: navigator.userAgent,
        notes: run.notes,
    };

    try {
        report.panel = resolvePanelId(params, options.panels);
        Object.assign(report, await measurePanel(report.panel, options.panels, run));
    } catch (error) {
        // The message alone, without `String(error)`'s `Error: ` prefix, so the
        // report and the runner's verdict print what was thrown.
        report.error = error instanceof Error ? error.message : String(error);
        report.stack = error instanceof Error ? error.stack : undefined;
    }

    await postReport(name, report);
}

/**
 * The panel to measure: `panel=`, or the only registered panel.
 *
 * @param params - The page's URL parameters.
 * @param panels - The panel host.
 * @returns The panel id.
 * @throws Error - When `panel=` names no registered panel, or it is absent and zero or several are registered.
 */
function resolvePanelId(params: URLSearchParams, panels: PanelHost): string {
    const ids = panels.ids();
    const requested = params.get('panel');

    if (requested !== null) {
        if (!ids.includes(requested)) {
            throw new Error(`unknown panel "${requested}" (registered: ${ids.join(', ')})`);
        }

        return requested;
    }

    if (ids.length > 1) {
        throw new Error(`several panels registered (${ids.join(', ')}); name one with panel=`);
    }

    if (ids.length === 0) {
        throw new Error('no panel registered');
    }

    return ids[0];
}

/**
 * Mounts panel `id` and measures it: plans and checks the phases, installs the
 * requested instruments, snapshots the page, measures idle frames, drives each
 * phase and measures idle again.
 *
 * @param id - The panel id.
 * @param panels - The panel host.
 * @param run - The run's shared context.
 * @returns The report's measured fields.
 */
async function measurePanel(id: string, panels: PanelHost, run: RunContext): Promise<Measurements> {
    const subject = await panels.setup(id, { params: run.params, notes: run.notes, tools: run.tools });
    const phases = planPhases(id, subject, run.params);

    await instrument(subject, run);

    const before = snapshotBefore(run.tools, subject.describe?.() ?? {});
    const idle = summarize(await measureIdle(IDLE_BEFORE_FRAMES));
    const phaseReports = await drivePhases(phases, subject, run);
    const idleAfter = summarize(await measureIdle(IDLE_AFTER_FRAMES));

    return { before, idle, phases: phaseReports, idleAfter };
}

/**
 * Parses the phases and checks each before anything is instrumented, so a typo
 * fails in a second rather than after a minute.
 *
 * @param id - The panel id, for the error.
 * @param subject - The mounted panel.
 * @param params - The page's URL parameters.
 * @returns The phases, in order; empty when the panel's default drive is `''`.
 * @throws Error - For a bad `drive=` value, an unknown driver, or a driver the panel gives no target for.
 */
function planPhases(id: string, subject: Subject, params: URLSearchParams): Phase[] {
    const frames = parseInt(params.get('frames') ?? String(DEFAULT_UNITS), 10);
    const phases = parseDrive(params.get('drive'), subject.defaultDrive, frames);

    for (const { driver } of phases) {
        if (!Object.hasOwn(DRIVERS, driver)) {
            throw new Error(`unknown driver "${driver}"`);
        }

        if (subject.targets[driver] === undefined) {
            throw new Error(`panel "${id}" gives no target for driver "${driver}"`);
        }
    }

    return phases;
}

/**
 * Parses a `drive=` value: comma-separated `<driver>[:<units>]` entries,
 * trimmed. When `value` is absent or blank, `fallback` (the panel's default
 * drive) is parsed instead with the same grammar.
 *
 * @param value - The URL's `drive=` value, or `null`.
 * @param fallback - The panel's default drive.
 * @param defaultUnits - Units for an entry without `:<units>`.
 * @returns The phases, in order; empty for an empty default.
 * @throws Error - `drive: bad unit count in "<entry>"` for a count that is not a positive integer in digits.
 */
export function parseDrive(value: string | null, fallback: string, defaultUnits: number): Phase[] {
    const source = value !== null && value.trim() !== '' ? value : fallback;

    if (source.trim() === '') {
        return [];
    }

    return source.split(',').map((entry) => parseDriveEntry(entry.trim(), defaultUnits));
}

/**
 * Parses one `<driver>[:<units>]` entry.
 *
 * @param entry - The trimmed entry.
 * @param defaultUnits - Units when the entry has no count.
 * @returns The phase.
 * @throws Error - When the count is not a positive integer in digits.
 */
function parseDriveEntry(entry: string, defaultUnits: number): Phase {
    const colon = entry.indexOf(':');

    if (colon < 0) {
        return { driver: entry, units: defaultUnits };
    }

    const count = entry.slice(colon + 1);

    if (!UNIT_COUNT.test(count)) {
        throw new Error(`drive: bad unit count in "${entry}"`);
    }

    return { driver: entry.slice(0, colon), units: Number(count) };
}

/**
 * Installs what the URL asks for, in Loom's order: write counters, then the
 * stylesheet, then ablations, then work counters, then the seam counter.
 * Write counters come before ablations so an ablation that replaces a method
 * the counters wrap still has its DOM writes counted; work and seam counters
 * come after them so a count taken under an ablation reflects the ablated code.
 *
 * @param subject - The mounted panel.
 * @param run - The run's shared context.
 */
async function instrument(subject: Subject, run: RunContext): Promise<void> {
    const { params, notes, tools } = run;

    if (params.get('count') === '1') {
        installWriteCounters();
        notes.push('write counters installed');

        if (params.get('deepwrites') === '1') {
            notes.push(installDeepStyleCounters());
        }
    }

    await injectStylesheet(params.get('css'));

    const ablations = applyAblations(params.get('abl'), tools, notes);

    if (params.get('work') === '1') {
        for (const note of [...installWorkCounters(tools), ...(subject.installWork?.(tools) ?? [])]) {
            notes.push(`work: ${note}`);
        }
    }

    if (params.get('seam') === '1') {
        notes.push(installSeamCounters(run.lib.DOM));
    }

    if (ablations > 0) {
        await sleep(SETTLE_MS);
    }
}

/**
 * Appends `css` to the page as a `<style>` element and waits for it to apply.
 *
 * @param css - The `css=` value, or `null` for none.
 */
async function injectStylesheet(css: string | null): Promise<void> {
    if (!css) {
        return;
    }

    const style = document.createElement('style');

    style.textContent = css;
    document.head.appendChild(style);
    await sleep(SETTLE_MS);
}

/**
 * Runs each named ablation and notes what it did; an unknown name is noted,
 * not an error.
 *
 * @param abl - The `abl=` value, or `null`.
 * @param tools - The harness tools.
 * @param notes - The run's notes.
 * @returns How many names were given.
 */
function applyAblations(abl: string | null, tools: HarnessTools, notes: string[]): number {
    const names = (abl ?? '').split(',').map((s) => s.trim()).filter(Boolean);

    for (const name of names) {
        const ablation = Object.hasOwn(ABLATIONS, name) ? ABLATIONS[name] : undefined;

        notes.push(ablation ? `${name}: ${ablation(tools)}` : `${name}: unknown ablation`);
    }

    return names.length;
}

/**
 * Drives every phase in order.
 *
 * @param phases - The planned phases.
 * @param subject - The mounted panel.
 * @param run - The run's shared context.
 * @returns One report per phase.
 */
async function drivePhases(phases: Phase[], subject: Subject, run: RunContext): Promise<PhaseReport[]> {
    const geom = run.params.get('geom') === '1';
    const geometry = geom ? subject.geometry ?? null : null;
    const stepPx = parseInt(run.params.get('step') ?? String(DEFAULT_STEP_PX), 10);
    const reports: PhaseReport[] = [];

    if (geom && !subject.geometry) {
        run.notes.push('geom=1: panel declares no geometry targets');
    }

    for (const [k, phase] of phases.entries()) {
        reports.push(await drivePhase(k, phase, subject, geometry, stepPx, run));
    }

    return reports;
}

/**
 * Drives one phase with the counters reset for it and the geometry probe on
 * when requested.
 *
 * @param k - The phase's index, for the failure note.
 * @param phase - The phase.
 * @param subject - The mounted panel.
 * @param geometry - The geometry targets to sample, or `null`.
 * @param stepPx - Pixels per unit.
 * @param run - The run's shared context.
 * @returns The phase's report.
 */
async function drivePhase(k: number, phase: Phase, subject: Subject, geometry: Record<string, GeometryTarget> | null, stepPx: number, run: RunContext): Promise<PhaseReport> {
    const { driver, units } = phase;
    let samples: number[];

    setGeometryTargets(geometry);
    startCounting();

    try {
        samples = await DRIVERS[driver]({ target: subject.targets[driver], units, stepPx, params: run.params, notes: run.notes, tools: run.tools });
    } catch (error) {
        run.notes.push(`phase ${k} (${driver}) failed`);

        throw error;
    }

    const counts = stopCounting(units);

    return { driver, units, timing: summarize(samples), ...counts, geometry: takeGeometry() ?? undefined };
}

/**
 * POSTs a report to the dev server's `/__qa/report` endpoint.
 *
 * @param name - The name the report is filed under.
 * @param report - The report.
 */
async function postReport(name: string, report: QaReport): Promise<void> {
    await fetch(`/__qa/report?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
    });
}

/**
 * The harness tools, with `lib.Body` bound into the component-tree helpers.
 *
 * @param lib - The library objects the page passed in.
 * @returns The tools.
 */
export function createTools(lib: HarnessLibrary): HarnessTools {
    return {
        sleep,
        waitFor,
        fireMouse,
        isPainted,
        countPainted,
        findButtonByText,
        elementOf,
        walkComponents: (): AnyObj[] => walkComponents(lib.Body),
        className,
        isA,
        findComponent: (name: string): AnyObj | null => findComponent(lib.Body, name),
        findLayoutManager: (name: string): AnyObj | null => findLayoutManager(lib.Body, name),
        ownerProto,
        rootOwnerProto,
        noopOnOwningProto,
        countMethod,
        bumpWork,
        bumpWrite,
        currentFrame,
        runFrames,
        runPasses,
    };
}
