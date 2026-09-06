import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  affectFromFileLists,
  actionInput,
  analyzeRepository,
  filesForCore,
  markdownReport,
  normalizeChangedFiles,
  pullRequestComment,
  splitList,
  PULL_REQUEST_COMMENT_MARKER,
} from '../src/analyzer.mjs';

test('runs jtframe mmr for all cores and modules, keeps header placeholder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtframe-files-'));
  try {
    const command = path.join(root, 'modules/jtframe/bin/jtframe');
    fs.mkdirSync(path.dirname(command), { recursive: true });
    fs.mkdirSync(path.join(root, 'cores/demo/cfg'), { recursive: true });
    fs.mkdirSync(path.join(root, 'cores/demo/hdl'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cores/demo/cfg/files.yaml'), 'demo:\n');
    fs.writeFileSync(path.join(root, 'cores/demo/cfg/macros.def'), 'CORENAME=demo\n');
    fs.writeFileSync(path.join(root, 'cores/demo/cfg/mmr.yaml'), '- name: demo\n');
    fs.writeFileSync(path.join(root, 'cores/demo/hdl/demo.v'), 'module demo; endmodule\n');
    fs.writeFileSync(path.join(root, 'cores/demo/hdl/demo_mmr.v'), 'source file\n');
    fs.writeFileSync(command, `#!/usr/bin/env bash
set -euo pipefail
test "$JTROOT" = "${root}"
test "$MODULES" = "$JTROOT/modules"
test -d "$JTBIN"
test "$CORES" != "$JTROOT/cores"
if [ "$1" = mmr ]; then
  # Generation pass runs mmr for every core/module with mmr.yaml
  if [ "\${2:-}" = demo ]; then
    printf 'generated file\\n' > "$CORES/demo/hdl/demo_mmr.v"
  fi
  exit 0
fi
test "$1" = files
test "$2" = plain
test "$3" = demo
test -f "$CORES/demo/hdl/demo_mmr.v"
test -f "$CORES/demo/hdl/jtdemo_header.v"
printf '%s\\n' "$CORES/demo/hdl/demo.v" "$CORES/demo/hdl/demo_mmr.v" "$CORES/demo/hdl/jtdemo_header.v" > files
`);
    fs.chmodSync(command, 0o755);

    assert.deepEqual(filesForCore(root, 'demo'), ['cores/demo/hdl/demo.v']);
    assert.equal(fs.readFileSync(path.join(root, 'cores/demo/hdl/demo_mmr.v'), 'utf8'), 'source file\n');
    assert.equal(fs.existsSync(path.join(root, 'cores/demo/hdl/jtdemo_header.v')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('creates the temporary header directory for config-only cores', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtframe-config-only-'));
  try {
    const command = path.join(root, 'modules/jtframe/bin/jtframe');
    fs.mkdirSync(path.dirname(command), { recursive: true });
    fs.mkdirSync(path.join(root, 'cores/bare/cfg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cores/bare/cfg/files.yaml'), 'bare:\n');
    fs.writeFileSync(path.join(root, 'cores/bare/cfg/macros.def'), 'CORENAME=bare\n');
    fs.writeFileSync(command, `#!/usr/bin/env bash
set -euo pipefail
test "$1" = files
test "$2" = plain
test "$3" = bare
test -f "$CORES/bare/hdl/jtbare_header.v"
printf '%s\\n' "$JTROOT/modules/jtframe/hdl/jtframe_ff.v" > files
`);
    fs.chmodSync(command, 0o755);

    assert.deepEqual(filesForCore(root, 'bare'), ['modules/jtframe/hdl/jtframe_ff.v']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('maps each exact JTFRAME file-list entry to every consuming core', () => {
  const result = affectFromFileLists({
    changedFiles: [
      'cores/alpha/hdl/alpha.v',
      'modules/jtframe/hdl/jtframe_ff.v',
      'README.md',
    ],
    fileLists: {
      alpha: ['cores/alpha/hdl/alpha.v', 'modules/jtframe/hdl/jtframe_ff.v'],
      beta: ['cores/alpha/hdl/alpha.v'],
      gamma: ['modules/jtframe/hdl/jtframe_ff.v'],
    },
  });

  assert.deepEqual(result.affected, {
    alpha: ['cores/alpha/hdl/alpha.v', 'modules/jtframe/hdl/jtframe_ff.v'],
    beta: ['cores/alpha/hdl/alpha.v'],
    gamma: ['modules/jtframe/hdl/jtframe_ff.v'],
  });
  assert.deepEqual(result.unmatchedFiles, ['README.md']);
});

test('keeps reporting when JTFRAME cannot resolve one core', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtframe-cores-'));
  try {
    for (const core of ['good', 'broken']) {
      const config = path.join(root, `cores/${core}/cfg`);
      fs.mkdirSync(config, { recursive: true });
      fs.writeFileSync(path.join(config, 'files.yaml'), `${core}:\n`);
      fs.writeFileSync(path.join(config, 'macros.def'), `CORENAME=${core}\n`);
    }
    const result = analyzeRepository({
      repositoryPath: root,
      changedFiles: ['cores/good/hdl/good.v'],
      listFiles: (_root, core) => {
        if (core === 'broken') throw new Error('missing generated source');
        return ['cores/good/hdl/good.v'];
      },
    });

    assert.deepEqual(result.affected, { good: ['cores/good/hdl/good.v'] });
    assert.deepEqual(result.unresolvedCores, [{ core: 'broken', error: 'missing generated source' }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a submodule gitlink change affects every core using a file below it', () => {
  const result = affectFromFileLists({
    changedFiles: ['modules/jt900h'],
    fileLists: {
      ngp: ['modules/jt900h/hdl/jt900h.v'],
      ngpc: ['modules/jt900h/hdl/jt95c061.v'],
      other: ['modules/jtframe/hdl/jtframe_ff.v'],
    },
    submodules: ['modules/jt900h'],
  });

  assert.deepEqual(result.affected, {
    ngp: ['modules/jt900h'],
    ngpc: ['modules/jt900h'],
  });
});

test('changed-file input accepts either newline text or a JSON array', () => {
  assert.deepEqual(normalizeChangedFiles('b.v\na.v\nb.v\n'), ['a.v', 'b.v']);
  assert.deepEqual(normalizeChangedFiles('["b.v", "a.v"]'), ['a.v', 'b.v']);
});

test('reads hyphenated GitHub Action inputs from their standard environment key', () => {
  const env = {
    'INPUT_BASE-SHA': 'base',
    'INPUT_CHANGED-FILES': 'first.v\nsecond.v',
  };

  assert.equal(actionInput('base-sha', env), 'base');
  assert.equal(actionInput('changed-files', env), 'first.v\nsecond.v');
  assert.equal(actionInput('head-sha', env, 'HEAD'), 'HEAD');
});

test('reports unresolved cores even when no changed input matched', () => {
  const report = markdownReport({
    affectedCoreNames: [],
    unresolvedCores: [{ core: 'demo', error: 'missing input' }],
  });

  assert.match(report, /No cores are affected/);
  assert.match(report, /JTFRAME could not resolve `demo`/);
});

test('formats the pull-request comment with bold core names and basename-only inputs', () => {
  const comment = pullRequestComment({
    affectedCoreNames: ['rastan', 'vlfied'],
    affected: {
      rastan: ['cores/rastan/hdl/jtrastan_obj.v'],
      vlfied: ['cores/rastan/hdl/jtrastan_obj.v'],
    },
    unresolvedCores: [],
  });

  assert.ok(comment.startsWith(PULL_REQUEST_COMMENT_MARKER));
  assert.match(comment, /- \*\*rastan\*\*\n  - `jtrastan_obj\.v`/);
  assert.match(comment, /- \*\*vlfied\*\*\n  - `jtrastan_obj\.v`/);
  assert.doesNotMatch(comment, /cores\/rastan\/hdl/);
});

test('formats an identifiable pull-request comment when no core matches', () => {
  const comment = pullRequestComment({
    affectedCoreNames: [],
    affected: {},
    unresolvedCores: [],
  });

  assert.ok(comment.startsWith(PULL_REQUEST_COMMENT_MARKER));
  assert.match(comment, /No cores are affected by the changed files\./);
});

test('does not allow a changed filename to escape its Markdown code span', () => {
  const comment = pullRequestComment({
    affectedCoreNames: ['demo'],
    affected: { demo: ['cores/demo/hdl/a`\n@maintainers.v'] },
    unresolvedCores: [],
  });

  assert.match(comment, /`a\\`@maintainers\.v`/);
  assert.doesNotMatch(comment, /\n@maintainers/);
});

test('splitList handles commas, spaces, and empty input', () => {
  assert.deepEqual(splitList('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(splitList('a , b , c'), ['a', 'b', 'c']);
  assert.deepEqual(splitList(' modules/jt900h , modules/pocket '), ['modules/jt900h', 'modules/pocket']);
  assert.deepEqual(splitList('single'), ['single']);
  assert.deepEqual(splitList(''), []);
  assert.deepEqual(splitList(null), []);
  assert.deepEqual(splitList(undefined), []);
  assert.deepEqual(splitList('a,,b,'), ['a', 'b']);
});

test('skipSubmodules silently drops cores that fail on a skipped submodule', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtframe-skip-'));
  try {
    for (const core of ['good', 'needs900h', 'needspocket']) {
      const config = path.join(root, `cores/${core}/cfg`);
      fs.mkdirSync(config, { recursive: true });
      fs.writeFileSync(path.join(config, 'files.yaml'), `${core}:\n`);
      fs.writeFileSync(path.join(config, 'macros.def'), `CORENAME=${core}\n`);
    }
    const result = analyzeRepository({
      repositoryPath: root,
      changedFiles: ['cores/good/hdl/good.v'],
      listFiles: (_root, core) => {
        if (core === 'needs900h') throw new Error('modules/jt900h/hdl/jt900h.v did not match');
        if (core === 'needspocket') throw new Error('modules/jtframe/target/pocket/missing.v not found');
        return ['cores/good/hdl/good.v'];
      },
      skipSubmodules: ['modules/jt900h', 'modules/jtframe/target/pocket'],
    });

    assert.deepEqual(result.affected, { good: ['cores/good/hdl/good.v'] });
    assert.deepEqual(result.unresolvedCores, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skipSubmodules still reports errors unrelated to skipped paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtframe-skip-other-'));
  try {
    for (const core of ['good', 'broken']) {
      const config = path.join(root, `cores/${core}/cfg`);
      fs.mkdirSync(config, { recursive: true });
      fs.writeFileSync(path.join(config, 'files.yaml'), `${core}:\n`);
      fs.writeFileSync(path.join(config, 'macros.def'), `CORENAME=${core}\n`);
    }
    const result = analyzeRepository({
      repositoryPath: root,
      changedFiles: ['cores/good/hdl/good.v'],
      listFiles: (_root, core) => {
        if (core === 'broken') throw new Error('some completely different error');
        return ['cores/good/hdl/good.v'];
      },
      skipSubmodules: ['modules/jt900h'],
    });

    assert.deepEqual(result.unresolvedCores, [{ core: 'broken', error: 'some completely different error' }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generates mmr for modules with multiple entries and cleans up', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtframe-modmmr-'));
  try {
    const command = path.join(root, 'modules/jtframe/bin/jtframe');
    fs.mkdirSync(path.dirname(command), { recursive: true });
    // Module with TWO mmr entries (the bug: old code only handled the first)
    fs.mkdirSync(path.join(root, 'modules/jt05415x/cfg'), { recursive: true });
    fs.mkdirSync(path.join(root, 'modules/jt05415x/hdl'), { recursive: true });
    fs.writeFileSync(path.join(root, 'modules/jt05415x/cfg/mmr.yaml'),
      '- name: "054156"\n  no_core_name: true\n- name: "054157"\n  no_core_name: true\n');
    fs.writeFileSync(path.join(root, 'modules/jt05415x/hdl/jt05415x.v'), 'module jt05415x; endmodule\n');
    // Core that references the module
    fs.mkdirSync(path.join(root, 'cores/moo/cfg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cores/moo/cfg/files.yaml'), 'moo:\n');
    fs.writeFileSync(path.join(root, 'cores/moo/cfg/macros.def'), 'CORENAME=moo\n');
    fs.writeFileSync(command, `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = mmr ]; then
  if [ "\${2:-}" = "-m" ]; then
    # Module mmr generation: create both output files
    mod="$3"
    touch "$MODULES/$mod/hdl/jt054156_mmr.v"
    touch "$MODULES/$mod/hdl/jt054157_mmr.v"
  fi
  exit 0
fi
test "$1" = files
test "$2" = plain
test "$3" = moo
# Both module mmr files must exist
test -f "$JTROOT/modules/jt05415x/hdl/jt054156_mmr.v"
test -f "$JTROOT/modules/jt05415x/hdl/jt054157_mmr.v"
printf '%s\\n' "$JTROOT/modules/jt05415x/hdl/jt05415x.v" > files
`);
    fs.chmodSync(command, 0o755);

    assert.deepEqual(filesForCore(root, 'moo'), ['modules/jt05415x/hdl/jt05415x.v']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
