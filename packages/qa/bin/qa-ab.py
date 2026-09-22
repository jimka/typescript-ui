#!/usr/bin/env python3
"""
Score one A/B cell: qa-ab.py <results-dir> <cell-prefix> [--counter EXPR] [--allow-diff LABEL[@PHASE],...] [--same PATTERN]...

Reads <results-dir>/<cell-prefix>*.json in write order — by the epoch
suffix of each file name — and prints, per phase and arm: the change in
milliseconds against the plain arms and their spread, the change in one
counter, the geometry gate, engagement, and the cell verdict. The decision
rule is plans/implemented/w3-0-bounding-sweep.md's (*Architecture
Decisions*, *The decision rule*).

A report's arm is its run name with the prefix and the trailing -<rep>
removed: w3s1-b02-sdp-split.noop-drag-2 is arm split.noop-drag of cell
w3s1-b02-sdp-. Exit 0 when every report was read; 1 for an error, unreadable
or old-format report, an arm that is not its report's abl=, fewer than two
plain reports, or reports whose phases differ; 2 for bad arguments.
"""
import argparse
import glob
import json
import os
import sys
from dataclasses import dataclass, field

# The report format this script reads; `QaReport.schema` in the harness.
SCHEMA: int = 1

# The arm name the sweep gives a run with no ablation.
PLAIN: str = 'plain'

# Work counters that are an ablation's own bookkeeping, not work the page did;
# `work` leaves them out, as qa-table.py's work/u does.
BOOKKEEPING_PREFIXES: tuple[str, ...] = ('memo.', 'skipped.', 'stubbed.', 'dose.')

# The prefixes of an arm's own counters, each followed by the arm's name.
OWN_COUNTER_PREFIXES: tuple[str, ...] = ('skipped.', 'memo.', 'dose.')

# An own counter whose name ends in this records work the arm did not remove
# — a memo's miss, a fall back to the original — so it is context, not
# engagement: an arm that only missed removed nothing.
MISS_SUFFIX: str = 'Miss'

# The work bar: a counter must fall by at least a tenth of its plain value
# and by at least one call per unit to count as work removed. Counts are
# deterministic, so any drop is real, but a fix must remove enough to pay for
# its own code: W2.0's smallest change taken seriously was F06.4's -14.8%,
# its drop G10's 0.0%, and a tenth sits between them. The per-unit floor
# keeps a large share of a tiny count from passing.
WORK_WIN_FRACTION: float = 0.10
WORK_WIN_MIN_PER_UNIT: float = 1.0

# A --same counter may differ from the plain value by this share: counts are
# deterministic, so 1% only absorbs the harness's rounding to hundredths.
SAME_TOLERANCE: float = 0.01

# The largest per-unit difference a --same counter whose plain value is 0 may
# show: one rounding step of the harness's hundredths.
SAME_ZERO_TOLERANCE: float = 0.01

# Rectangles are rounded to whole pixels by the harness, so equal means equal.
RECT_TOLERANCE: float = 0

# Exit codes.
EXIT_OK: int = 0
EXIT_BAD_INPUT: int = 1
EXIT_BAD_ARGS: int = 2


@dataclass
class Run:
    """
    One successful report of the cell.
    """

    name: str
    arm: str
    report: dict


@dataclass
class ArmReading:
    """
    One arm's reading in one phase.
    """

    arm: str
    reps: int
    mean: float
    delta_ms: float
    ms: str
    counter: float
    delta_pct: str
    work: str
    geom: str
    engaged: str
    verdict: str
    dose_note: str = ''


@dataclass
class Options:
    """
    The parsed command line.
    """

    results_dir: str
    prefix: str
    counter: str
    allow: dict[str, set[int] | None] = field(default_factory=dict)
    same: list[str] = field(default_factory=list)


def run_name(path: str) -> str:
    """
    The run's name: the file name without its `-<epoch ms>.json` suffix.

    Args:
        path: a result file.

    Returns:
        The run name.
    """
    return os.path.basename(path).rsplit('-', 1)[0]


def write_order(path: str) -> tuple[int, str]:
    """
    Sort key for a result file: its epoch-milliseconds suffix, which is the
    order the runs were written in and survives a checkout, unlike the
    modification time.

    Args:
        path: a result file.

    Returns:
        The epoch, or 0 when the suffix is not a number, then the name.
    """
    suffix = os.path.basename(path).rsplit('-', 1)[-1].removesuffix('.json')

    return (int(suffix) if suffix.isdigit() else 0, os.path.basename(path))


def load(path: str) -> dict | None:
    """
    Read one result file.

    Args:
        path: a result file.

    Returns:
        The report, or None when the file is not a readable JSON object.
    """
    try:
        with open(path, encoding='utf-8') as handle:
            report = json.load(handle)
    except (OSError, ValueError):
        return None

    return report if isinstance(report, dict) else None


def arm_of(name: str, prefix: str) -> str:
    """
    A run's arm: its name without the cell prefix and the trailing `-<rep>`.

    Args:
        name: the run name.
        prefix: the cell prefix.

    Returns:
        The arm name.
    """
    return name.removeprefix(prefix).rsplit('-', 1)[0]


def read_runs(options: Options) -> list[Run] | None:
    """
    Read the cell's reports, printing an ERROR or MISMATCH line for each that
    cannot be scored.

    Args:
        options: the parsed command line.

    Returns:
        The runs in write order, or None when any report could not be scored.
    """
    files = sorted(glob.glob(os.path.join(options.results_dir, options.prefix + '*.json')), key=write_order)
    runs: list[Run] = []
    failed = False

    for path in files:
        name = run_name(path)
        report = load(path)

        if report is None or report.get('schema') != SCHEMA:
            print(f'ERROR {name} {"unreadable" if report is None else "old format"}')
            failed = True
        elif 'error' in report:
            print(f"ERROR {name} {report['error']}")
            failed = True
        else:
            arm = arm_of(name, options.prefix)

            if arm != PLAIN and arm != (report.get('params') or {}).get('abl'):
                print(f'MISMATCH {name}')
                failed = True

            runs.append(Run(name, arm, report))

    return None if failed else runs


def check_shape(runs: list[Run]) -> bool:
    """
    Check that the cell can be scored: at least two plain reports, and every
    report with the same phases, driver by driver.

    Args:
        runs: the cell's runs.

    Returns:
        True when it can; otherwise prints why and returns False.
    """
    if sum(1 for run in runs if run.arm == PLAIN) < 2:
        print(f'ERROR fewer than two {PLAIN} reports')

        return False

    drivers = {tuple(phase.get('driver') for phase in run.report.get('phases') or []) for run in runs}

    if len(drivers) != 1:
        print('ERROR the reports\' phases differ: ' + ' / '.join(','.join(map(str, d)) for d in sorted(drivers, key=str)))

        return False

    return True


def counter_family(phase: dict, family: str) -> dict:
    """
    One counter family of a phase: `work`, or `sink` / `source` of `seam`.

    Args:
        phase: one phase of a report.
        family: `work`, `seam.sink` or `seam.source`.

    Returns:
        Key → value per unit; empty when the phase has none.
    """
    if family == 'work':
        return phase.get('work') or {}

    return (phase.get('seam') or {}).get(family.removeprefix('seam.')) or {}


def split_term(term: str) -> tuple[str, str] | None:
    """
    Split a keyed counter term into its family and key.

    Args:
        term: `work.<key>`, `seam.sink.<key>` or `seam.source.<key>`, each optionally ending in `*`.

    Returns:
        `(family, key)`, or None when the term names no keyed family.
    """
    for family in ('seam.sink', 'seam.source', 'work'):
        if term.startswith(family + '.') and len(term) > len(family) + 1:
            return family, term[len(family) + 1:]

    return None


def matching_counters(phase: dict, term: str) -> dict[str, float]:
    """
    The counters of a phase one term names, by their full name.

    Args:
        phase: one phase of a report.
        term: `work`, `sink`, or a keyed term, optionally ending in `*`.

    Returns:
        Full counter name → value per unit; a keyed term without `*` names its counter even when absent (0).
    """
    if term == 'work':
        return {'work': sum(v for k, v in (phase.get('work') or {}).items() if not k.startswith(BOOKKEEPING_PREFIXES))}

    if term == 'sink':
        return {'sink': sum(counter_family(phase, 'seam.sink').values())}

    keyed = split_term(term)

    if keyed is None:
        return {}

    family, key = keyed
    counters = counter_family(phase, family)

    if key.endswith('*'):
        return {f'{family}.{k}': v for k, v in counters.items() if k.startswith(key[:-1])}

    return {f'{family}.{key}': counters.get(key, 0)}


def valid_term(term: str) -> bool:
    """
    Whether a token is a counter term.

    Args:
        term: a token of a counter expression.

    Returns:
        True for `work`, `sink`, or a keyed term.
    """
    return term in ('work', 'sink') or split_term(term) is not None


def parse_expression(expression: str) -> list[tuple[int, str]] | None:
    """
    Parse a counter expression: terms separated by `+` and `-`, all tokens
    separated by spaces.

    Args:
        expression: the --counter value.

    Returns:
        `(sign, term)` pairs, or None when the expression is malformed.
    """
    tokens = expression.split()

    if len(tokens) % 2 == 0:
        return None

    terms = [(1, tokens[0])]

    for op, term in zip(tokens[1::2], tokens[2::2]):
        if op not in ('+', '-'):
            return None

        terms.append((1 if op == '+' else -1, term))

    return terms if all(valid_term(term) for _, term in terms) else None


def evaluate(terms: list[tuple[int, str]], phase: dict) -> float:
    """
    A counter expression's value in one phase.

    Args:
        terms: the parsed expression.
        phase: one phase of a report.

    Returns:
        The value per unit.
    """
    return sum(sign * sum(matching_counters(phase, term).values()) for sign, term in terms)


def mean(values: list[float]) -> float:
    """
    The arithmetic mean.

    Args:
        values: at least one value.

    Returns:
        Their mean.
    """
    return sum(values) / len(values)


def avg_ms(phase: dict) -> float:
    """
    A phase's average sample.

    Args:
        phase: one phase of a report.

    Returns:
        Its timing's avgMs.
    """
    return float((phase.get('timing') or {}).get('avgMs', 0.0))


def allowed(options: Options, label: str, index: int) -> bool:
    """
    Whether --allow-diff takes `label` out of the comparison in phase `index`.

    Args:
        options: the parsed command line.
        label: a geometry label.
        index: the phase's index.

    Returns:
        True when the label may differ there.
    """
    if label not in options.allow:
        return False

    phases = options.allow[label]

    return phases is None or index in phases


def same_rect(a: list[float] | None, b: list[float] | None) -> bool:
    """
    Whether two sampled rectangles are equal within RECT_TOLERANCE.

    Args:
        a: one sample: `[x, y, width, height]` or None.
        b: the other.

    Returns:
        True when both are None, or equal field by field.
    """
    if a is None or b is None:
        return a is b

    return len(a) == len(b) and all(abs(x - y) <= RECT_TOLERANCE for x, y in zip(a, b))


def differing_labels(phase: dict, reference: dict, index: int, options: Options) -> list[str]:
    """
    The geometry labels of a phase that differ from the reference phase,
    outside the labels --allow-diff takes out.

    Args:
        phase: one phase of a report.
        reference: the same phase of the first plain report.
        index: the phase's index.
        options: the parsed command line.

    Returns:
        The differing labels, sorted.
    """
    mine = phase.get('geometry') or {}
    theirs = reference.get('geometry') or {}
    out = []

    for label in sorted(set(mine) | set(theirs)):
        if allowed(options, label, index):
            continue

        a = mine.get(label)
        b = theirs.get(label)

        if a is None or b is None or len(a) != len(b) or not all(same_rect(x, y) for x, y in zip(a, b)):
            out.append(label)

    return out


def differing_same(phase: dict, reference: dict, options: Options) -> list[str]:
    """
    The --same counters of a phase that differ from the reference phase by
    more than SAME_TOLERANCE of the plain value (SAME_ZERO_TOLERANCE when it is 0).

    Args:
        phase: one phase of an arm's report.
        reference: the same phase of the first plain report.
        options: the parsed command line.

    Returns:
        `same <counter>` for each that differs.
    """
    out = []

    for pattern in options.same:
        mine = matching_counters(phase, pattern)
        theirs = matching_counters(reference, pattern)

        for key in sorted(set(mine) | set(theirs)):
            plain = theirs.get(key, 0)
            limit = abs(plain) * SAME_TOLERANCE if plain != 0 else SAME_ZERO_TOLERANCE

            if abs(mine.get(key, 0) - plain) > limit:
                out.append(f'same {key}')

    return out


def own_counters(phase: dict, arm: str) -> dict[str, float]:
    """
    An arm's own counters in one phase: `skipped.<arm>.`, `memo.<arm>.` and `dose.<arm>.`.

    Args:
        phase: one phase of the arm's report.
        arm: the arm's name.

    Returns:
        Their values per unit, by key.
    """
    heads = tuple(prefix + arm + '.' for prefix in OWN_COUNTER_PREFIXES)

    return {k: v for k, v in (phase.get('work') or {}).items() if k.startswith(heads)}


def engagement(phase: dict, arm: str) -> float:
    """
    How much an arm engaged in one phase: its own counters, less those that
    record a miss.

    Args:
        phase: one phase of the arm's report.
        arm: the arm's name.

    Returns:
        The sum per unit; above 0 when the arm removed or added work.
    """
    return sum(v for k, v in own_counters(phase, arm).items() if not k.endswith(MISS_SUFFIX))


def ms_verdict(delta: float, bracket: float) -> str:
    """
    The milliseconds verdict: outside the plain arms' spread, or not.

    Args:
        delta: the arm's mean minus the plain mean.
        bracket: the plain arms' largest average minus their smallest.

    Returns:
        `win`, `regress` or `flat`.
    """
    if delta < -bracket:
        return 'win'

    if delta > bracket:
        return 'regress'

    return 'flat'


def work_verdict(delta: float, plain: float) -> str:
    """
    The work verdict: a change of at least WORK_WIN_FRACTION of the plain
    value and at least WORK_WIN_MIN_PER_UNIT per unit.

    Args:
        delta: the arm's counter mean minus the plain mean.
        plain: the plain mean.

    Returns:
        `win` for such a fall, `more` for such a rise, `flat` otherwise.
    """
    bar = max(abs(plain) * WORK_WIN_FRACTION, WORK_WIN_MIN_PER_UNIT)

    if delta <= -bar:
        return 'win'

    if delta >= bar:
        return 'more'

    return 'flat'


def cell_verdict(geom: str, engaged: str, dose: bool, ms: str, work: str) -> str:
    """
    The cell verdict: the first row of the decision rule that applies.

    Args:
        geom: `=`, `DIFF(...)` or `unstable`.
        engaged: `yes` or `no`.
        dose: whether the arm is a dose arm.
        ms: the milliseconds verdict.
        work: the work verdict.

    Returns:
        `void`, `unreached`, `dose`, `regress`, `win` or `flat`.
    """
    if geom != '=':
        return 'void'

    if engaged != 'yes':
        return 'unreached'

    if dose:
        return 'dose'

    if ms == 'regress':
        return 'regress'

    if work == 'win' or ms == 'win':
        return 'win'

    return 'flat'


def dose_reading(plain_phases: list[dict], plain_counter: float, delta: float, bracket: float) -> str:
    """
    A dose arm's own reading. The fix removes the work the dose adds, so its
    work is the plain arms' counter as a share of the phase's seam source
    calls, with the work bar; its milliseconds are a win when the dose costs
    more than the plain spread.

    Args:
        plain_phases: this phase of each plain report.
        plain_counter: the counter's plain mean.
        delta: the dose arm's mean minus the plain mean, in ms.
        bracket: the plain arms' spread.

    Returns:
        A note: the share and both verdicts.
    """
    source = mean([sum(counter_family(phase, 'seam.source').values()) for phase in plain_phases])
    share = plain_counter / source if source else 0.0
    work = 'win' if share >= WORK_WIN_FRACTION and plain_counter >= WORK_WIN_MIN_PER_UNIT else 'flat'
    ms = 'win' if delta > bracket else 'flat'

    return f'  dose: counter {share * 100:.1f}% of seam.source → work {work}; Δms {delta:+.2f} vs bracket {bracket:.2f} → ms {ms}'


def read_arm(arm: str, phases: list[dict], plain_phases: list[dict], index: int, terms: list[tuple[int, str]], options: Options, unstable: bool) -> ArmReading:
    """
    Score one arm in one phase.

    Args:
        arm: the arm's name.
        phases: this phase of each of the arm's reports.
        plain_phases: this phase of each plain report, the first being the geometry reference.
        index: the phase's index.
        terms: the parsed counter expression.
        options: the parsed command line.
        unstable: whether the plain arms' geometry disagrees among itself.

    Returns:
        The reading.
    """
    plain_avgs = [avg_ms(phase) for phase in plain_phases]
    bracket = max(plain_avgs) - min(plain_avgs)
    arm_mean = mean([avg_ms(phase) for phase in phases])
    delta_ms = arm_mean - mean(plain_avgs)
    plain_counter = mean([evaluate(terms, phase) for phase in plain_phases])
    counter = mean([evaluate(terms, phase) for phase in phases])
    delta = counter - plain_counter
    delta_pct = f'{delta / plain_counter * 100:+.1f}%' if plain_counter else '-'
    diffs = sorted({d for phase in phases for d in differing_labels(phase, plain_phases[0], index, options) + differing_same(phase, plain_phases[0], options)})
    geom = 'unstable' if unstable else ('=' if not diffs else f'DIFF({",".join(diffs)})')
    engaged = 'yes' if all(engagement(phase, arm) > 0 for phase in phases) else 'no'
    dose = any(key.startswith(f'dose.{arm}.') for phase in phases for key in own_counters(phase, arm))
    ms = ms_verdict(delta_ms, bracket)
    work = work_verdict(delta, plain_counter)
    dose_note = dose_reading(plain_phases, plain_counter, delta_ms, bracket) if dose else ''

    return ArmReading(arm, len(phases), arm_mean, delta_ms, ms, counter, delta_pct, work, geom, engaged, cell_verdict(geom, engaged, dose, ms, work), dose_note)


def print_phase(index: int, runs: list[Run], terms: list[tuple[int, str]], options: Options) -> None:
    """
    Print one phase's block: the header, the plain line and one line per arm,
    in order of first appearance.

    Args:
        index: the phase's index.
        runs: the cell's runs.
        terms: the parsed counter expression.
        options: the parsed command line.
    """
    plain_phases = [run.report['phases'][index] for run in runs if run.arm == PLAIN]
    reference = plain_phases[0]
    plain_avgs = [avg_ms(phase) for phase in plain_phases]
    unstable = any(differing_labels(phase, reference, index, options) for phase in plain_phases[1:])
    plain_counter = mean([evaluate(terms, phase) for phase in plain_phases])
    arms = list(dict.fromkeys(run.arm for run in runs if run.arm != PLAIN))
    width = max([len(PLAIN)] + [len(arm) for arm in arms])

    print(f"phase {index}  {reference.get('driver')} ×{reference.get('units')}  counter {options.counter}")
    print(f"  {PLAIN:{width}}  {len(plain_phases)} reps  avg {' / '.join(f'{a:.2f}' for a in plain_avgs)}  mean {mean(plain_avgs):.2f}"
          f"  bracket {max(plain_avgs) - min(plain_avgs):.2f}  counter {plain_counter:.2f}")

    for arm in arms:
        phases = [run.report['phases'][index] for run in runs if run.arm == arm]
        r = read_arm(arm, phases, plain_phases, index, terms, options, unstable)

        print(f'  {r.arm:{width}}  {r.reps} reps  mean {r.mean:.2f}  Δms {r.delta_ms:+.2f} {r.ms:7}  counter {r.counter:.2f}'
              f'  Δ {r.delta_pct:>7} {r.work:4}  geom {r.geom}  engaged {r.engaged}  → {r.verdict}')

        if r.dose_note:
            print(f'  {"":{width}}{r.dose_note}')


def parse_allow(values: list[str]) -> dict[str, set[int] | None] | None:
    """
    Parse the --allow-diff values: comma-separated labels, each optionally `@<phase>`.

    Args:
        values: every --allow-diff value given.

    Returns:
        Label → the phases it may differ in, None for every phase; or None when a phase is not a number.
    """
    out: dict[str, set[int] | None] = {}

    for item in (part.strip() for value in values for part in value.split(',')):
        if not item:
            continue

        label, _, phase = item.partition('@')

        if phase and not phase.isdigit():
            return None

        phases = out.get(label, set())

        # A label allowed in every phase stays so; otherwise gather its phases.
        out[label] = None if not phase or phases is None else phases | {int(phase)}

    return out


def parse_args() -> Options | None:
    """
    Parse the command line.

    Returns:
        The options, or None when --counter, --allow-diff or --same is malformed.
    """
    parser = argparse.ArgumentParser(description='Score one A/B cell of the W3.0 sweep.')
    parser.add_argument('results_dir', help='the results directory')
    parser.add_argument('prefix', help='the cell prefix, e.g. w3s1-b02-sdp-')
    parser.add_argument('--counter', default='work', help='the counter expression to score work on (default: work)')
    parser.add_argument('--allow-diff', action='append', default=[], help='geometry labels that may differ, each LABEL or LABEL@PHASE, comma-separated')
    parser.add_argument('--same', action='append', default=[], help='a counter pattern that must equal the plain arm\'s (repeatable)')
    args = parser.parse_args()
    allow = parse_allow(args.allow_diff)

    if allow is None or parse_expression(args.counter) is None or not all(valid_term(p) for p in args.same):
        return None

    return Options(args.results_dir, args.prefix, args.counter, allow, args.same)


def main() -> int:
    """
    Score the cell the arguments select.

    Returns:
        The exit code.
    """
    options = parse_args()

    if options is None:
        print('bad --counter, --allow-diff or --same', file=sys.stderr)

        return EXIT_BAD_ARGS

    runs = read_runs(options)

    if runs is None or not check_shape(runs):
        return EXIT_BAD_INPUT

    terms = parse_expression(options.counter) or []

    for index in range(len(runs[0].report.get('phases') or [])):
        print_phase(index, runs, terms, options)

    return EXIT_OK


if __name__ == '__main__':
    sys.exit(main())
