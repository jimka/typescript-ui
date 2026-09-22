// The W3.0 sweep script, offline: its --list and --dry-run modes open
// nothing, and its running mode is exercised against a stub runner. Checks
// the matrix the script encodes against the harness it drives — every
// ablation, panel and drive it names must exist — so a typo fails here
// rather than as a plausible-looking result in the sweep.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ABLATIONS } from '../src/harness/ablations.js';
import { parseDrive } from '../src/harness/run.js';
import { getPanelIds } from '../src/panels.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../sweeps/w3-0.sh');

/** Runs the whole sweep, as the plan's matrix totals it. */
const TOTAL_RUNS = 394;

/** Runs per batch, in order: *The Matrix* in plans/implemented/w3-0-bounding-sweep.md. */
const BATCH_RUNS: Array<[string, number]> = [
    ['b00', 28], ['b01', 9], ['b02', 12], ['b03', 10], ['b04', 22], ['b05', 14], ['b06', 10], ['b07', 10], ['b08', 15], ['b09', 33],
    ['b10', 14], ['b11', 25], ['b12', 30], ['b13', 29], ['b14', 32], ['b15', 27], ['b16', 20], ['b17', 25], ['b18', 20], ['b19', 9],
];

/** Drivers that change the page for every later phase, so they may only run last (README, *Measurement rules*). */
const LAST_ONLY_DRIVERS = ['toggle', 'theme', 'type'];

/** The runner call W11's stub fails on. */
const STUB_FAILS_ON_CALL = 3;

/** One `--dry-run` line: the runner call the sweep would make. */
interface Run {
    name: string;
    build: string;
    params: URLSearchParams;
    raw: string;
    batch: string;
    cell: string;
    arm: string;
}

/** What one invocation of the script did. */
interface Outcome {
    status: number | null;
    stdout: string;
    stderr: string;
}

/** Temporary directories a case made, removed after it. */
const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
});

/**
 * Runs the sweep script with `args`, with none of its environment variables
 * set except those in `env`.
 *
 * @param args - The script's arguments.
 * @param env - Environment variables to set.
 * @returns Its exit status and output.
 */
function sweep(args: string[], env: Record<string, string> = {}): Outcome {
    const base: NodeJS.ProcessEnv = { ...process.env };

    for (const key of ['W3_SESSION', 'W3_RUNQA', 'W3_C40_BEFORE_LIB', 'QA_MAIN_LIB', 'QA_WT_LIB']) {
        delete base[key];
    }

    const result = spawnSync('bash', [SCRIPT, ...args], { env: { ...base, ...env }, encoding: 'utf8' });

    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Parses a run name `w3<session>-<batch>-<cell>-<arm>-<rep>`; the arm may
 * itself hold hyphens, as `split.noop-drag` does.
 *
 * @param name - The run name.
 * @returns Its batch, cell and arm.
 */
function parseName(name: string): { batch: string; cell: string; arm: string } {
    const parts = name.split('-');

    return { batch: parts[1], cell: parts[2], arm: parts.slice(3, -1).join('-') };
}

/**
 * The runner calls a `--dry-run` would make.
 *
 * @param args - Further arguments: batches, say.
 * @param env - Environment variables to set.
 * @returns One run per printed line.
 */
function dryRun(args: string[] = [], env: Record<string, string> = {}): Run[] {
    const outcome = sweep(['--dry-run', ...args], env);

    expect(outcome.status, outcome.stderr).toBe(0);

    return outcome.stdout.trim().split('\n').map((line) => {
        const [runqa, name, build, raw, ...rest] = line.split(' ');

        expect(runqa).toBe('runqa');
        expect(rest).toEqual([]);

        return { name, build, params: new URLSearchParams(raw), raw, ...parseName(name) };
    });
}

/**
 * Groups runs by cell: the run name up to the arm.
 *
 * @param runs - The runs, in order.
 * @returns Cell key → its runs, in order.
 */
function byCell(runs: Run[]): Map<string, Run[]> {
    const cells = new Map<string, Run[]>();

    for (const run of runs) {
        const key = `${run.batch}-${run.cell}`;

        cells.set(key, [...(cells.get(key) ?? []), run]);
    }

    return cells;
}

/**
 * A run's parameters without `abl=`, which is what may differ between a cell's arms.
 *
 * @param run - A run.
 * @returns The rest of its parameters, in order.
 */
function withoutAblation(run: Run): string {
    const params = new URLSearchParams(run.params);

    params.delete('abl');

    return params.toString();
}

describe('W1 --list', () => {
    it('counts every batch in order, then the total', () => {
        const outcome = sweep(['--list']);
        const expected = [...BATCH_RUNS.map(([batch, runs]) => `${batch} ${runs}`), `total ${TOTAL_RUNS}`];

        expect(outcome.status).toBe(0);
        expect(outcome.stdout.trim().split('\n')).toEqual(expected);
        expect(BATCH_RUNS.reduce((sum, [, runs]) => sum + runs, 0)).toBe(TOTAL_RUNS);
    });
});

describe('W2–W7 --dry-run', () => {
    let runs: Run[] = [];

    beforeAll(() => {
        runs = dryRun();
    });

    it('W2 prints every run once, on the main build or the before arm', () => {
        expect(runs).toHaveLength(TOTAL_RUNS);
        expect(new Set(runs.map((run) => run.name)).size).toBe(TOTAL_RUNS);

        for (const run of runs) {
            expect(run.name.startsWith('w3s1-'), run.name).toBe(true);
            expect(['main', 'wt']).toContain(run.build);
        }

        const baseline = runs.filter((run) => run.batch === 'b00');

        expect(baseline.some((run) => run.params.get('panel') === 'shell-deep' && run.params.get('drive') === 'drag,wheel:120' && !run.params.has('grip'))).toBe(true);
        expect(runs.filter((run) => run.batch === 'b19' && run.build === 'wt')).toHaveLength(4);
    });

    it('W3 carries exactly one instrument set, and no write counters', () => {
        for (const run of runs) {
            expect(run.raw.split('work=1&seam=1&geom=1').length - 1, run.name).toBe(1);
            expect(run.params.has('count'), run.name).toBe(false);
            expect(run.params.has('deepwrites'), run.name).toBe(false);
        }
    });

    it('W4 names only registered ablations', () => {
        for (const run of runs.filter((r) => r.params.has('abl'))) {
            expect(Object.keys(ABLATIONS), run.name).toContain(run.params.get('abl'));
        }
    });

    it('W5 names only registered panels', () => {
        const ids = getPanelIds();

        for (const run of runs) {
            expect(ids, run.name).toContain(run.params.get('panel'));
        }
    });

    it('W6 drives parse, page-changing phases come last, and no tab is dragged', () => {
        for (const run of runs) {
            const phases = parseDrive(run.params.get('drive'), '', 1);

            expect(phases.length, run.name).toBeGreaterThan(0);

            phases.slice(0, -1).forEach(({ driver }) => expect(LAST_ONLY_DRIVERS, run.name).not.toContain(driver));
            expect(run.params.get('grip'), run.name).not.toBe('tab');
        }
    });

    it('W7 shapes every cell: one parameter set, a known tag, plain arms around named ones', () => {
        for (const [key, cellRuns] of byCell(runs)) {
            const [first] = cellRuns;

            expect(first.cell, key).toMatch(/^[a-z0-9]+$/);

            for (const run of cellRuns) {
                expect(withoutAblation(run), run.name).toBe(withoutAblation(first));
            }

            if (first.batch === 'b19') {
                continue;
            }

            expect(first.arm, key).toBe('plain');
            expect(cellRuns[cellRuns.length - 1].arm, key).toBe('plain');

            for (const run of cellRuns) {
                expect(run.arm === 'plain' ? null : run.arm, run.name).toBe(run.params.get('abl'));
            }
        }
    });
});

describe('W8–W10 batch selection and session tag', () => {
    it('W8 runs only the named batch', () => {
        const runs = dryRun(['b02']);

        expect(runs).toHaveLength(new Map(BATCH_RUNS).get('b02')!);

        for (const run of runs) {
            expect(run.name.startsWith('w3s1-b02-'), run.name).toBe(true);
        }
    });

    it('W9 rejects an unknown batch before printing anything', () => {
        const outcome = sweep(['--dry-run', 'nope']);

        expect(outcome.status).toBe(2);
        expect(outcome.stdout).toBe('');
    });

    it('W10 names runs under W3_SESSION', () => {
        for (const run of dryRun(['b01'], { W3_SESSION: 's2' })) {
            expect(run.name.startsWith('w3s2-b01-'), run.name).toBe(true);
        }
    });
});

describe('W11 running mode', () => {
    it('stops at the runner\'s first failure', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w3-sweep-'));
        const log = path.join(dir, 'calls.log');
        const stub = path.join(dir, 'runqa-stub.sh');
        const lib = path.join(dir, 'lib');

        tempDirs.push(dir);
        fs.mkdirSync(path.join(lib, 'dist/lib'), { recursive: true });
        fs.writeFileSync(path.join(lib, 'dist/lib/core.es.js'), '');
        fs.writeFileSync(stub, [
            '#!/bin/bash',
            `echo "$1" >> '${log}'`,
            `[ "$(wc -l < '${log}')" -ge ${STUB_FAILS_ON_CALL} ] && exit 1`,
            'exit 0',
            '',
        ].join('\n'), { mode: 0o755 });

        const outcome = sweep(['b02'], { W3_RUNQA: stub, QA_MAIN_LIB: lib });

        expect(outcome.status).toBe(1);
        expect(fs.readFileSync(log, 'utf8').trim().split('\n')).toEqual([
            'w3s1-b02-sdp-plain-a',
            'w3s1-b02-sdp-split.noop-drag-1',
            'w3s1-b02-sdp-split.recalc-gate-1',
        ]);
    });
});
