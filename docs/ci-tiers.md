# Fleet CI v2

Required checks remain `test (22)`, `test (26)` and `codeql`. CodeQL is required
and deliberately has no path exclusions. Hosted Ubuntu quick jobs run on PRs
and dispatch, with 30-minute limits and superseded PR cancellation. Action
revisions and checkout credential settings retain the existing immutable pins.

| Check | Code PR 22 | Code PR 26 | Docs/tracker PR, both | Deep 22/26 × npm/Bun |
| --- | --- | --- | --- | --- |
| npm ci / merge-driver prepare / strict health | yes | yes | yes | yes |
| Identity and private-path policy | yes | yes | yes | yes |
| Build + tests | quick | quick coverage | release-caller docs contract | full npm + Bun |
| Committed distribution graph | — | yes | — | full npm + Bun |
| Typecheck, lint, duplication, docstrings | — | yes | — | full npm + Bun |
| Coverage, unchanged 100% statements/branches/functions/lines | — | quick | — | full npm + Bun |
| Production audit | — | yes | — | full npm + Bun |
| Publish attestation verifier (all tracked shebangs) | — | yes | yes | full npm + Bun |
| Package dry-run, shipped README/docs and changelog | — | yes | yes | full npm + Bun |
| Packed and Git npm/npx and Bun/bunx consumer acceptance | — | yes | — | full npm + Bun |
| Bun package-graph install smoke | — | yes | — | yes |
| CodeQL, separate required workflow | yes | yes | yes | main pushes + Monday 01:47 UTC |

The docs path runs identity auditing on all post-baseline commits and additions,
strict tracker health, publish attestation, changelog, package contents (including README, LICENSE,
ARCHITECTURE and listed docs), and the tooling test that resolves the documented
release tracking link. No separate secret/privacy command exists. Executable
tracker files select the code path. No original gate is removed; the full npm
release gate includes distribution, installation and every script gate.

`test:install` already proves tarball and Git npm/npx and Bun/bunx journeys,
including installed SDK and real extension operations. The extra quick Bun step
therefore only installs the package graph. The Node floor uses build/tests
without separate coverage, changelog or pack commands.

Deep runs main pushes, manual dispatch and nightly 02:47 UTC, separate from
release 03:23 and hourly reconciliation :41. Distinct `deep` names prevent
matching PR requirements. The Node × package-manager matrix runs one full gate per job,
with 120-minute limits, per-ref queuing without cancelling active runs, full depth and time scale 3.
Persistent local runners are selected unless `PM_LOCAL_DEEP=off`; npm cache
restoration and Bun setup run only on hosted hardware. Local Bun is logged.

Unset depth remains full. Quick keeps deterministic seed prefixes: 50/500,
103/1024 document cases, 26/256 retained-byte fuzz cases, and at least 25 sampled
schema boundaries. Batched models preserve their original batch widths and
allow a partial final batch; record mutation models keep 25 cases per seed.
Generated counts drive aggregate assertions and diagnostic receipts. Product
array/byte/review bounds and all per-case assertions remain intact.

Only acceptance/worker watchdogs use `PM_TEST_TIME_SCALE`; finite, positive,
in-range factors are validated before spawning and rounded up to integer
milliseconds. Source lookup deadlines (`timeoutMs`), verification budgets,
record limits and product deadline assertions stay unscaled.

Baseline successful main run 43653414648: Node 26 executes in 45m54s and Node 22
in 28m26s; creation-to-completion 114m25s and 154m31s. Schema-boundary law takes
693.43s, transfer model 160.63s, binding model 134.50s and mutation model 94.72s.
Quick timings are measured separately; no full local run is needed for this
rollout. Full-depth certification is deferred to CI Deep after merge.

Local quick selected tests passed 19/19 in 242.02s, with schema boundaries
99.40s, transfer model 95.16s, binding model 28.98s and mutation law 32.38s.
These local measurements cover a selected suite on different hardware, not the
complete PR gate, and do not establish a direct speedup against hosted full CI.

Publish-attestation discovery reads the first line of every tracked file for
shell shebangs, including docs and tracker files, so it runs in the cheap path.

The local quick coverage gate passed 212/212 tests and all 24 configured source
files at unchanged 100/100/100/100 thresholds on Node 24.19.0. Its test phase
took 905.12s (15m05s). Exact Node 22/26 CI and installation acceptance remain
separate pending evidence.

Template follow-up: executable tracker files (`mjs`, `cjs`, `js`, `jsx`, `ts`,
`tsx`, `mts`, `cts`, `sh`), tracker extensions and executable files under `docs/`
select the code tier, including nested paths. CodeQL is a required check
(`codeql`), so its paths remain unfiltered. Existing hosted-only npm cache restoration and Bun setup, with
`bun --version` on local runners, are retained. No quick-depth reduction or
sharding was needed from the latest successful PR execution measurements.

Follow-up baseline: [successful PR run 43735328882](https://github.com/unbraind/pm-evidence/actions/runs/43735328882).
Node 22/26 execution: 2m28s / 5m56s; created-to-completed including queue:
45m57s / 31m27s. Both executions fit the approximately 15-minute target.
