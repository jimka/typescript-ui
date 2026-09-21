// qa-ab.py, the A/B cell analyser, offline over the fixtures in
// fixtures/ab/: seven reports of one cell, three plain arms around two
// ablated ones (see plans/implemented/w3-0-bounding-sweep.md, T2). Runs the
// script as the orchestrator does, with python3, and reads its printed lines.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../bin/qa-ab.py');
const FIXTURES = path.join(HERE, 'fixtures');
const CELL = path.join(FIXTURES, 'ab');

/** Temporary directories a case made, removed after it. */
const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
});

/**
 * Runs qa-ab.py with `args`.
 *
 * @param args - The script's arguments.
 * @returns Its exit status and its printed lines.
 */
function qaAb(args: string[]): { status: number | null; lines: string[] } {
    const result = spawnSync('python3', ['-B', SCRIPT, ...args], { encoding: 'utf8' });

    return { status: result.status, lines: result.stdout.trimEnd().split('\n') };
}

/**
 * The printed line of arm `arm`.
 *
 * @param lines - The script's lines.
 * @param arm - The arm's name.
 * @returns Its line.
 */
function armLine(lines: string[], arm: string): string {
    return lines.find((line) => line.trimStart().startsWith(`${arm} `))!;
}

/** A fixture report, as far as these cases change it. */
interface FixtureReport {
    params: Record<string, string>;
    phases: Array<{ work: Record<string, number>; seam: { source: Record<string, number> }; geometry: Record<string, number[][]>; timing: { avgMs: number } }>;
}

/**
 * Copies the fixture cell into a temporary directory, letting `change` edit
 * each report on the way.
 *
 * @param change - Edits one report, given its file name.
 * @returns The directory.
 */
function cellCopy(change: (report: FixtureReport, file: string) => void): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ab-'));

    tempDirs.push(dir);

    for (const file of fs.readdirSync(CELL)) {
        const report = JSON.parse(fs.readFileSync(path.join(CELL, file), 'utf8')) as FixtureReport;

        change(report, file);
        fs.writeFileSync(path.join(dir, file), JSON.stringify(report));
    }

    return dir;
}

describe('T2–T4 the fixture cell', () => {
    it('T2 scores a win and a geometry void', () => {
        const { status, lines } = qaAb([CELL, 'ab-fix-']);

        expect(status).toBe(0);
        expect(armLine(lines, 'plain')).toMatch(/mean 10\.20 {2}bracket 0\.40 {2}counter 100\.00/);
        expect(armLine(lines, 'x.y')).toMatch(/Δms -0\.60 win .*counter 80\.00 +Δ +-20\.0% win .*geom = +engaged yes +→ win$/);
        expect(armLine(lines, 'x.z')).toMatch(/Δms \+0\.00 flat .*counter 100\.00 +Δ +\+0\.0% flat .*geom DIFF\(chart\) +engaged yes +→ void$/);
    });

    it('T3 lets an allowed label differ', () => {
        const { lines } = qaAb([CELL, 'ab-fix-', '--allow-diff', 'chart']);

        expect(armLine(lines, 'x.z')).toMatch(/geom = +engaged yes +→ flat$/);
    });

    it('T4 fails on an error report', () => {
        const { status, lines } = qaAb([FIXTURES, 'report-error']);

        expect(status).toBe(1);
        expect(lines[0]).toMatch(/^ERROR /);
    });
});

describe('engagement', () => {
    it('reads an arm whose own counters only record misses as unreached', () => {
        const dir = cellCopy((report) => {
            // x.y keeps its drop in `a`, but removed nothing it can show for.
            if (report.params.abl === 'x.y') {
                report.phases[0].work = { a: 80, 'memo.x.y.zMiss': 5 };
            }
        });

        expect(armLine(qaAb([dir, 'ab-fix-']).lines, 'x.y')).toMatch(/engaged no +→ unreached$/);
    });

    it('reads a dose arm as dose, with the dose reading beside it', () => {
        const dir = cellCopy((report) => {
            report.phases[0].seam.source = { getParentElement: 30, getId: 30, measureText: 40 };

            // x.y adds 60 reads per unit and costs 1.5 ms more than the plain arms.
            if (report.params.abl === 'x.y') {
                report.phases[0].work = { a: 100, 'dose.x.y.extraCall': 60 };
                report.phases[0].timing.avgMs += 1.5;
            }
        });

        const { lines } = qaAb([dir, 'ab-fix-', '--counter', 'seam.source.getParentElement + seam.source.getId', '--allow-diff', 'chart']);
        const doseLine = lines[lines.indexOf(armLine(lines, 'x.y')) + 1];

        expect(armLine(lines, 'x.y')).toMatch(/engaged yes +→ dose$/);
        expect(doseLine).toMatch(/dose: counter 60\.0% of seam\.source → work win; Δms \+0\.90 vs bracket 0\.40 → ms win/);
    });
});

describe('gates and failures', () => {
    it('--same voids an arm whose named counter moved', () => {
        const { lines } = qaAb([CELL, 'ab-fix-', '--same', 'work.a', '--allow-diff', 'chart']);

        expect(armLine(lines, 'x.y')).toMatch(/geom DIFF\(same work\.a\) +engaged yes +→ void$/);
        expect(armLine(lines, 'x.z')).toMatch(/geom = /);
    });

    it('--allow-diff LABEL@PHASE allows the label in that phase only', () => {
        expect(armLine(qaAb([CELL, 'ab-fix-', '--allow-diff', 'chart@0']).lines, 'x.z')).toMatch(/geom = /);
        expect(armLine(qaAb([CELL, 'ab-fix-', '--allow-diff', 'chart@1']).lines, 'x.z')).toMatch(/geom DIFF\(chart\)/);
    });

    it('reads every arm as unstable when the plain arms disagree', () => {
        const dir = cellCopy((report, file) => {
            if (file.startsWith('ab-fix-plain-b-')) {
                report.phases[0].geometry.chart = [[0, 0, 100, 52], [0, 0, 100, 52]];
            }
        });

        const { lines } = qaAb([dir, 'ab-fix-']);

        expect(armLine(lines, 'x.y')).toMatch(/geom unstable +engaged yes +→ void$/);
        expect(armLine(lines, 'x.z')).toMatch(/geom unstable +engaged yes +→ void$/);
    });

    it('stops at an arm that is not its report\'s ablation', () => {
        const dir = cellCopy((report, file) => {
            if (file.startsWith('ab-fix-x.y-2-')) {
                report.params.abl = 'other';
            }
        });

        const { status, lines } = qaAb([dir, 'ab-fix-']);

        expect(status).toBe(1);
        expect(lines).toContain('MISMATCH ab-fix-x.y-2');
    });

    it('exits 2 for a malformed counter expression', () => {
        expect(qaAb([CELL, 'ab-fix-', '--counter', 'work +']).status).toBe(2);
    });
});
