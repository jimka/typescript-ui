#!/usr/bin/env python3
"""
Judge one QA result file: qa-verdict.py <result.json>.

Prints the path and exits 0 for a successful report. Exits 1, saying why, for
an error report, a report in an older format, or a file that is not a
readable report. runqa.sh hands every run's result to it, so a failing run
fails the runner at once instead of looking like a success.
"""
import argparse
import json
import sys

# The report format this script reads; `QaReport.schema` in the harness.
SCHEMA: int = 1


def verdict(path: str) -> tuple[list[str], int]:
    """
    Judge the result file at `path`.

    Args:
        path: the result file.

    Returns:
        The lines to print, and the exit code: 0 for a successful report, 1 otherwise.
    """
    try:
        with open(path, encoding='utf-8') as handle:
            report = json.load(handle)
    except (OSError, ValueError) as error:
        return [f'UNREADABLE {path}: {error}'], 1

    if not isinstance(report, dict) or report.get('schema') != SCHEMA:
        return [f'OLD FORMAT {path}'], 1

    if 'error' in report:
        return [f"ERROR {report['error']}", '; '.join(report.get('notes') or [])], 1

    return [path], 0


def main() -> int:
    """
    Print the verdict on the file named on the command line.

    Returns:
        The exit code.
    """
    parser = argparse.ArgumentParser(description='Judge one QA result file.')
    parser.add_argument('result', help='the result JSON file')
    args = parser.parse_args()
    lines, code = verdict(args.result)

    for line in lines:
        print(line)

    return code


if __name__ == '__main__':
    sys.exit(main())
