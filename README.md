# JTCORES affected cores

This dependency-only action reports the JTCORES cores that may use a set of
changed files. For every core it runs the authoritative command
`jtframe files plain <core>` and compares the resulting list to the pull
request's changed paths. It has no npm dependencies or build step.

The checkout must include recursive submodules, and the runner needs Go 1.23.4
to run JTFRAME. The supplied JTCORES workflow runs on `pull_request_target`,
checks out the trusted base SHA (never fork code), reads the changed paths via
the GitHub pull-request-files API, and then builds JTFRAME once before
analysing the cores.

## Inputs

- `repository-path`: checked-out JTCORES root, default `.`.
- `changed-files`: newline-delimited, repository-relative file paths. This is
  useful for local invocation and is preferred when supplied.
- `base-sha`, `head-sha`: git revisions used to collect changed files when
  `changed-files` is absent.

## Outputs

- `affected-cores`: JSON object: core name to changed build inputs.
- `affected-core-names`: JSON array of core names.
- `unmatched-files`: changed paths with no resolved core dependency.
- `unresolved-cores`: cores JTFRAME could not resolve, including the error.
- `report`: Markdown table used in the GitHub job summary.
- `pull-request-comment`: Markdown body for the workflow's tagged
  pull-request comment.

## Local use

```bash
# Run tests
node --test

# Analyze changed files
node src/cli.mjs --repo /path/to/jtcores --changed-files $'cores/cninja/hdl/jtcninja_decospr.v'
node src/cli.mjs --repo /path/to/jtcores --base <base-sha> --head HEAD
```

JTFRAME is responsible for the YAML, macro, glob, alias, nested-config, and
MMR-generated-source semantics. For cores with `cfg/mmr.yaml`, the action runs
`jtframe mmr <core>` in a temporary overlay before resolving the file list. It
also supplies a temporary MRA-header placeholder when necessary. Generated
`*_mmr.v` and `*_header.v` files are excluded before dependency matching: they
cannot be changed directly by a pull request. The action only performs path
matching and reports the result.

When Git reports a submodule gitlink change, such as `modules/jt900h`, the
action treats all files beneath that submodule as potentially changed.

## Pull-request comment

The calling workflow uses a marker (`<!-- jtcores-affected-cores -->`) to find
and replace an existing comment via the pinned Peter Evans actions
([find-comment](https://github.com/peter-evans/find-comment) and
[create-or-update-comment](https://github.com/peter-evans/create-or-update-comment)).
Each core is bold and its affected inputs are listed by filename only. A comment
is also created or updated when no core matches.

## Fork safety

`pull_request_target` has permission to write the pull-request comment, so the
workflow deliberately runs only trusted code from the base SHA. It does not
check out, build, or execute the pull request's head commit; changed filenames
are data returned by GitHub's API. Keep the job permissions limited to
`contents: read` and `pull-requests: write`, and use a read-only submodule
token if `secrets.PAT` is required for private submodules.
