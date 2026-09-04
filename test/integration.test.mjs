#!/usr/bin/env node
/**
 * Integration tests that run against a real JTCORES checkout.
 * Skipped when JTCORES_ROOT is not set (unit-test runs).
 * CI sets JTCORES_ROOT to the shallow-cloned repo.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRepository, normalizeChangedFiles, splitList } from '../src/analyzer.mjs';

const JTCORES_ROOT = process.env.JTCORES_ROOT;
const skipSubmodules = splitList(process.env.JTCHECK_SKIP_SUBMODULES ?? '');

/**
 * Each entry maps a changed file to the core names it must affect.
 * Add rows as real-world regressions are found.
 */
const CASES = [
  {
    file: 'cores/rastan/hdl/jtrastan_obj.v',
    expected: ['rastan', 'vlfied'],
  },
  {
    file: 'modules/jtframe/hdl/jtframe_ff.v',
    mustInclude: ['outrun'],  // affects many cores; just check a known one is present
  },
];

for (const { file, expected, mustInclude } of CASES) {
  test(`${file} affects ${expected ? expected.join(', ') : 'expected cores'}`, { skip: !JTCORES_ROOT && 'JTCORES_ROOT not set' }, () => {
    const result = analyzeRepository({
      repositoryPath: JTCORES_ROOT,
      changedFiles: normalizeChangedFiles(file),
      skipSubmodules,
    });
    if (expected) {
      const actual = result.affectedCoreNames.filter((c) => expected.includes(c)).sort();
      assert.deepEqual(actual, [...expected].sort(),
        `Expected ${file} to affect [${expected}], got [${result.affectedCoreNames}]`);
    }
    if (mustInclude) {
      for (const core of mustInclude) {
        assert.ok(result.affectedCoreNames.includes(core),
          `Expected ${file} to affect ${core}, got [${result.affectedCoreNames}]`);
      }
    }
  });
}
