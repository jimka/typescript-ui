#!/usr/bin/env python3
"""
Tabulate QA results: qa-table.py <results-dir> <name-prefix> [--writes] [--seam] [--before <path>[,<path>...]].

Reads <results-dir>/<name-prefix>*.json, oldest first, and prints one row per
phase of each report. The geom column compares each phase's geometry with the
same phase of the reference: the first successful report listed.
"""
import argparse
import glob
import json
import os
import sys

# The report format this script reads; `QaReport.schema` in the harness.
SCHEMA: int = 1

# Loom's floor for --writes: a write that happens less than once in twenty
# units is noise in a per-unit listing.
WRITES_FLOOR: float = 0.05

# Work counters that are an ablation's own bookkeeping, not work the page did;
# work/u leaves them out, as wave 2's scoring did.
BOOKKEEPING_PREFIXES: tuple[str, ...] = ('memo.', 'skipped.', 'stubbed.')

# Column name → width. Wide enough for the campaign's run names and a
# full-screen element count; the notes column is last and unbounded.
COLUMNS: list[tuple[str, int]] = [
    ('run', 26), ('panel', 12), ('host', 11), ('phase', 7), ('units', 5), ('elems', 6), ('idle', 5),
    ('avg', 7), ('p90', 6), ('work/u', 7), ('sink/u', 7), ('geom', 4),
]

# The width of a --before column that is narrower than its header.
BEFORE_MIN_WIDTH: int = 6


def run_name(path: str) -> str:
    """
    The run's name: the file name without its `-<epoch ms>.json` suffix.

    Args:
        path: a result file.

    Returns:
        The run name.
    """
    return os.path.basename(path).rsplit('-', 1)[0]


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


def is_success(report: dict | None) -> bool:
    """
    Whether a report is in this format and carries no error.

    Args:
        report: a loaded report, or None.

    Returns:
        True for a successful report.
    """
    return report is not None and report.get('schema') == SCHEMA and 'error' not in report


def fmt_number(value: object, precision: int = 1) -> str:
    """
    Format a number for a table cell.

    Args:
        value: the value, or None.
        precision: decimal places.

    Returns:
        The formatted number, or '-' for anything that is not a number.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return '-'

    return f'{value:.{precision}f}'


def work_per_unit(phase: dict) -> str:
    """
    Sum a phase's per-unit work counters, leaving out ablation bookkeeping.

    Args:
        phase: one phase of a report.

    Returns:
        The sum, or '-' when the phase has no work counters.
    """
    work = phase.get('work')

    if work is None:
        return '-'

    return fmt_number(sum(v for k, v in work.items() if not k.startswith(BOOKKEEPING_PREFIXES)))


def sink_per_unit(phase: dict) -> str:
    """
    Sum a phase's per-unit DOM sink calls.

    Args:
        phase: one phase of a report.

    Returns:
        The sum, or '-' when the phase has no seam counters.
    """
    seam = phase.get('seam')

    if seam is None:
        return '-'

    return fmt_number(sum(seam.get('sink', {}).values()))


def geom_cell(phase: dict, index: int, reference: dict | None, is_reference: bool) -> str:
    """
    Compare a phase's geometry with the same phase of the reference report.

    Args:
        phase: one phase of a report.
        index: the phase's index in its report.
        reference: the reference report, or None when there is none.
        is_reference: whether this phase belongs to the reference report.

    Returns:
        'base' for the reference's own geometry, '=' or 'DIFF' against it,
        '?' when the reference phase has none, '-' when this phase has none.
    """
    geometry = phase.get('geometry')

    if geometry is None:
        return '-'

    if is_reference:
        return 'base'

    ref_phases = (reference or {}).get('phases') or []
    ref_geometry = ref_phases[index].get('geometry') if index < len(ref_phases) else None

    if ref_geometry is None:
        return '?'

    return '=' if geometry == ref_geometry else 'DIFF'


def before_value(before: dict, dotted: str) -> str:
    """
    Read a dotted path into a report's `before` object.

    Args:
        before: the report's `before` object.
        dotted: a path such as `host.treeRowsTotal`.

    Returns:
        The value as printed, or '-' for a missing path or a non-scalar value.
    """
    value: object = before

    for key in dotted.split('.'):
        if not isinstance(value, dict) or key not in value:
            return '-'

        value = value[key]

    return str(value) if isinstance(value, (str, int, float)) else '-'


def render(cells: list[str], widths: list[int], notes: str) -> str:
    """
    Lay one row out in fixed-width columns, the first left-aligned and the rest right-aligned.

    Args:
        cells: the cells, one per column.
        widths: the column widths.
        notes: the trailing notes cell.

    Returns:
        The row.
    """
    parts = [f'{cells[0]:{widths[0]}}'] + [f'{cell:>{width}}' for cell, width in zip(cells[1:], widths[1:])]

    return ' '.join(parts) + '  ' + notes


def phase_cells(report: dict, phase: dict | None, index: int, reference: dict | None, is_reference: bool) -> list[str]:
    """
    The fixed cells of one row: the report's columns, then the phase's.

    Args:
        report: the report.
        phase: one of its phases, or None for a report without phases.
        index: the phase's index.
        reference: the reference report.
        is_reference: whether `report` is the reference.

    Returns:
        One cell per fixed column after `run`.
    """
    before = report.get('before') or {}
    head = [str(report.get('panel') or '-'), str(report.get('host') or '-')]
    elems = str(before.get('elements', '-'))
    idle = fmt_number((report.get('idle') or {}).get('avgMs'))

    if phase is None:
        return head + ['-', '-', elems, idle, '-', '-', '-', '-', '-']

    timing = phase.get('timing') or {}

    return head + [
        str(phase.get('driver', '-')), str(phase.get('units', '-')), elems, idle,
        fmt_number(timing.get('avgMs')), fmt_number(timing.get('p90Ms'), 0),
        work_per_unit(phase), sink_per_unit(phase), geom_cell(phase, index, reference, is_reference),
    ]


def print_details(phase: dict, args: argparse.Namespace, indent: int) -> None:
    """
    Print the --writes and --seam detail lines under a phase's row.

    Args:
        phase: one phase of a report.
        args: the parsed arguments.
        indent: the width of the run column, to indent under.
    """
    if args.writes and phase.get('writes'):
        items = [f'{k}={v}' for k, v in phase['writes'].items() if v >= WRITES_FLOOR]
        print(f"{'':{indent}} writes/unit: " + ', '.join(items))

    if args.seam and phase.get('seam'):
        for family in ('sink', 'source'):
            items = [f'{k}={v}' for k, v in phase['seam'].get(family, {}).items()]
            print(f"{'':{indent}} seam.{family}/unit: " + ', '.join(items))


def print_report(path: str, report: dict | None, reference: dict | None, args: argparse.Namespace, widths: list[int]) -> None:
    """
    Print one result file's rows: an old-format or error line, or one row per phase.

    Args:
        path: the result file.
        report: its loaded report, or None when unreadable.
        reference: the reference report.
        args: the parsed arguments.
        widths: the column widths.
    """
    name = run_name(path)

    if report is None or report.get('schema') != SCHEMA:
        print(f'{name:{widths[0]}} old format, skipped')

        return

    notes = '; '.join(report.get('notes') or [])

    if 'error' in report:
        print(f"{name:{widths[0]}} ERROR {report['error']}  {notes}")

        return

    before = report.get('before') or {}
    extra = [before_value(before, dotted) for dotted in args.before]
    phases = report.get('phases') or [None]

    for index, phase in enumerate(phases):
        cells = [name] + phase_cells(report, phase, index, reference, report is reference) + extra
        print(render(cells, widths, notes))

        if phase is not None:
            print_details(phase, args, widths[0])


def parse_args() -> argparse.Namespace:
    """
    Parse the command line.

    Returns:
        The arguments; `before` is a list of dotted paths.
    """
    parser = argparse.ArgumentParser(description='Tabulate QA results by name prefix.')
    parser.add_argument('results_dir', help='the results directory')
    parser.add_argument('prefix', help='the run-name prefix to select')
    parser.add_argument('--writes', action='store_true', help='list each phase\'s write counters under its row')
    parser.add_argument('--seam', action='store_true', help='list each phase\'s seam counters under its row')
    parser.add_argument('--before', default='', help='comma-separated dotted paths into `before`, one column each')
    args = parser.parse_args()
    args.before = [p for p in args.before.split(',') if p]

    return args


def main() -> int:
    """
    Print the table for the files the arguments select.

    Returns:
        The exit code.
    """
    args = parse_args()
    files = sorted(glob.glob(os.path.join(args.results_dir, args.prefix + '*.json')), key=os.path.getmtime)
    reports = [load(f) for f in files]
    reference = next((r for r in reports if is_success(r)), None)
    widths = [w for _, w in COLUMNS] + [max(len(p), BEFORE_MIN_WIDTH) for p in args.before]
    header = render([name for name, _ in COLUMNS] + args.before, widths, 'notes')

    print(header)
    print('-' * len(header))

    for path, report in zip(files, reports):
        print_report(path, report, reference, args, widths)

    return 0


if __name__ == '__main__':
    sys.exit(main())
