// The platform-call cost sweep script, offline: its --list and --dry-run modes
// open nothing, and its running mode is exercised against a stub runner, as
// sweep.test.ts does for the W3.0 sweep. Checks the matrix the script encodes
// against the harness it drives — every ablation and panel it names must
// exist, and the census must cover every registered panel exactly once — so a
// typo fails here rather than as a plausible-looking result in the sweep.
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
const SCRIPT = path.resolve(HERE, '../sweeps/plat.sh');

/** Runs the whole sweep, as the plan's matrix totals it: 83 scored runs and one discarded warm-up. */
const TOTAL_RUNS = 84;

/** Runs per batch, in order: *The Matrix* in plans/implemented/platform-call-cost-sweep.md. The warm-up is in the total, not in a batch. */
const BATCH_RUNS: Array<[string, number]> = [['p00', 24], ['p01', 6], ['p02', 18], ['p03', 14], ['p04', 14], ['p05', 7]];

/** The instrument set every run but the overhead witness's unshimmed arm carries. */
const FLAGS = 'work=1&seam=1&geom=1&plat=1';

/** The cell that runs without the platform counters, the sweep's one declared exception. */
const NOPLAT_CELL = 'ohn';

/** The discarded first run of any invocation. */
const WARM_NAME = 'plats1-warm';

/** The runner call the failure case's stub fails on. */
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

    for (const key of ['PLAT_SESSION', 'PLAT_RUNQA', 'QA_MAIN_LIB', 'QA_WT_LIB']) {
        delete base[key];
    }

    const result = spawnSync('bash', [SCRIPT, ...args], { env: { ...base, ...env }, encoding: 'utf8' });

    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Parses a run name `plat<session>-<batch>-<cell>-<arm>-<rep>`; the arm may
 * itself hold hyphens, as `plat.intl-d1` does. The warm-up, which has neither
 * a batch nor a cell, reports both as `''`.
 *
 * @param name - The run name.
 * @returns Its batch, cell and arm.
 */
function parseName(name: string): { batch: string; cell: string; arm: string } {
    const parts = name.split('-');

    if (parts.length < 4) {
        return { batch: '', cell: '', arm: '' };
    }

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
 * Groups runs by cell: the batch and the cell tag.
 *
 * @param runs - The runs, in order.
 * @returns Cell key → its runs, in order.
 */
function byCell(runs: Run[]): Map<string, Run[]> {
    const cells = new Map<string, Run[]>();

    for (const run of runs.filter((r) => r.cell !== '')) {
        const key = `${run.batch}-${run.cell}`;

        cells.set(key, [...(cells.get(key) ?? []), run]);
    }

    return cells;
}

/**
 * A run's parameters without what may differ between a cell's arms: the
 * ablation, and the platform counters the overhead witness drops.
 *
 * @param run - A run.
 * @returns The rest of its parameters, in order.
 */
function withoutArmParams(run: Run): string {
    const params = new URLSearchParams(run.params);

    params.delete('abl');
    params.delete('plat');

    return params.toString();
}

describe('T1 --list', () => {
    it('counts every batch in order, then the total with the warm-up', () => {
        const outcome = sweep(['--list']);
        const expected = [...BATCH_RUNS.map(([batch, runs]) => `${batch} ${runs}`), `total ${TOTAL_RUNS}`];

        expect(outcome.status).toBe(0);
        expect(outcome.stdout.trim().split('\n')).toEqual(expected);
        expect(BATCH_RUNS.reduce((sum, [, runs]) => sum + runs, 0)).toBe(TOTAL_RUNS - 1);
    });
});

describe('T2–T7 --dry-run', () => {
    let runs: Run[] = [];

    beforeAll(() => {
        runs = dryRun();
    });

    it('T2 prints every run once, on the main build, the warm-up first', () => {
        expect(runs).toHaveLength(TOTAL_RUNS);
        expect(new Set(runs.map((run) => run.name)).size).toBe(TOTAL_RUNS);
        expect(runs[0].name).toBe(WARM_NAME);

        for (const run of runs) {
            expect(run.name.startsWith('plats1-'), run.name).toBe(true);
            expect(run.build, run.name).toBe('main');
        }
    });

    it('T3 carries one instrument set, and drops plat=1 for the unshimmed witness alone', () => {
        for (const run of runs) {
            const wanted = run.cell === NOPLAT_CELL ? 'work=1&seam=1&geom=1' : FLAGS;

            expect(run.raw.split(wanted).length - 1, run.name).toBe(1);
            expect(run.params.get('plat'), run.name).toBe(run.cell === NOPLAT_CELL ? null : '1');
            expect(run.params.has('count'), run.name).toBe(false);
        }

        expect(runs.filter((run) => run.cell === NOPLAT_CELL)).toHaveLength(3);
    });

    it('T4 names only registered ablations, each matching its run name\'s arm', () => {
        for (const run of runs.filter((r) => r.params.has('abl'))) {
            expect(Object.keys(ABLATIONS), run.name).toContain(run.params.get('abl'));
            expect(run.arm, run.name).toBe(run.params.get('abl'));
            expect(run.name.endsWith(`-${run.arm}-1`) || run.name.endsWith(`-${run.arm}-2`), run.name).toBe(true);
        }
    });

    it('T5 censuses every registered panel exactly once, and names no other', () => {
        const ids = getPanelIds();
        const census = runs.filter((run) => run.batch === 'p00' && !run.params.has('drive') && !run.params.has('n'));

        expect(census.map((run) => run.params.get('panel')).sort()).toEqual([...ids].sort());

        for (const run of runs) {
            expect(ids, run.name).toContain(run.params.get('panel'));
        }
    });

    it('T6 drives parse wherever one is named', () => {
        for (const run of runs.filter((r) => r.params.has('drive'))) {
            expect(parseDrive(run.params.get('drive'), '', 1).length, run.name).toBeGreaterThan(0);
        }
    });

    it('T7 shapes every cell: one parameter set, a hyphen-free tag, plain arms around named ones', () => {
        for (const [key, cellRuns] of byCell(runs)) {
            const [first] = cellRuns;

            expect(first.cell, key).toMatch(/^[a-z0-9]+$/);
            expect(first.arm, key).toBe('plain');
            expect(cellRuns[cellRuns.length - 1].arm, key).toBe('plain');

            for (const run of cellRuns) {
                expect(withoutArmParams(run), run.name).toBe(withoutArmParams(first));
            }
        }
    });

    it('T8 keeps the warm-up out of reach of every cell prefix', () => {
        for (const [key] of byCell(runs)) {
            expect(WARM_NAME.startsWith(`plats1-${key}-`), key).toBe(false);
        }

        expect(runs.filter((run) => run.name.startsWith(WARM_NAME))).toHaveLength(1);
    });
});

describe('T9–T11 batch selection and session tag', () => {
    it('T9 runs the warm-up and only the named batch, each cell in the ab order', () => {
        const runs = dryRun(['p02']);
        const arms = ['plat.intl-d1', 'plat.intl-d4', 'plat.collate-d1', 'plat.collate-d4'];

        expect(runs).toHaveLength(1 + new Map(BATCH_RUNS).get('p02')!);
        expect(runs[0].name).toBe(WARM_NAME);
        expect(runs.slice(1, 12).map((run) => run.arm)).toEqual([
            'plain', ...arms, 'plain', ...[...arms].reverse(), 'plain',
        ]);
        expect(runs.slice(12).map((run) => run.cell)).toEqual(Array(7).fill('t9u'));
    });

    it('T10 rejects an unknown batch before printing anything', () => {
        const outcome = sweep(['--dry-run', 'nope']);

        expect(outcome.status).toBe(2);
        expect(outcome.stdout).toBe('');
    });

    it('T11 names runs under PLAT_SESSION', () => {
        for (const run of dryRun(['p05'], { PLAT_SESSION: 's2' })) {
            expect(run.name.startsWith('plats2-'), run.name).toBe(true);
        }
    });
});

describe('T12 running mode', () => {
    it('stops at the runner\'s first failure', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-sweep-'));
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

        const outcome = sweep(['p05'], { PLAT_RUNQA: stub, QA_MAIN_LIB: lib });

        expect(outcome.status).toBe(1);
        expect(fs.readFileSync(log, 'utf8').trim().split('\n')).toEqual([
            WARM_NAME,
            'plats1-p05-ttk-plain-a',
            'plats1-p05-ttk-plat.collate-d1-1',
        ]);
    });
});
