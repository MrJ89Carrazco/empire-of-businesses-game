#!/usr/bin/env python3
"""Fail closed when bridge suites are missing or unittest discovers no tests."""
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
TESTS = ROOT / 'tests'
for name in ('test_bridge.py', 'test_bridge_budget.py'):
    if not (TESTS / name).is_file():
        raise SystemExit('Test guard: missing required suite ' + name)
loader = unittest.TestLoader()
suite = loader.discover(str(TESTS), pattern='test_*.py')
count = suite.countTestCases()
# The restored bridge baseline contains 36 cases.
if loader.errors or count < 36:
    raise SystemExit(f'Test guard: expected at least 36 Python cases; discovered {count}. {loader.errors}')
print(f'Discovered {count} Python tests.', flush=True)
result = unittest.TextTestRunner(verbosity=2).run(suite)
if result.testsRun != count or result.skipped or result.expectedFailures or not result.wasSuccessful():
    raise SystemExit('Test guard: incomplete, skipped, or failing Python test run.')
