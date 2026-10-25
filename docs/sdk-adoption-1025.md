# SDK adoption audit, 2026-10-25

The pinned SDK remains 2026.10.23. The registry CLI was 2026.10.25 when checked.

| Audit finding (baseline location) | Implementation | Evidence |
| --- | --- | --- |
| `src/core.ts:21`: duplicated token arithmetic | `estimatePmOutputTokens` receives the larger JSON/TOON byte count, including each final newline | Unicode/escaping/newline tests; compiled baseline differential; function-only structural revert |
| `src/core.ts:25-33`: local omission envelope and prefix budgeting | `createOutputOmissionReceipt` supplies row-omission materiality, translated to the existing package receipt | Complete, omitted, source-incomplete and exact-budget tests; compiled baseline differential; function-only structural revert |
| Same finding: `applyReadOutputDimensions` | Cannot replace the exact prefix-budget policy with the pinned API | Without active host registration, direct evidence API calls return input unchanged; registered host projection still lacks the required final-envelope estimator |

Missing SDK capability: a caller-supplied final-envelope estimator with lossless ordered-prefix-only selection. The SDK supports host extension registration through `read_output`; this is not a missing API. However, projection measures one encoding and can compact strings, whereas evidence must preserve complete rows and bound both rendered forms including the final newline and self-accounting receipt. Host registration alone cannot preserve that contract, and `check` also records observations by default rather than being a read-only handler. Calling the helper as a built-in `list` would change command identity, envelope, budget boundaries and string semantics. The package retains its existing prefix loop pending the estimator/selection capability. No backend transaction replacement is claimed.

## Compiled differential

Run `npm run build`, then `node test/sdk-differential.acceptance.ts <public-evidence-checkout> <public-changelog-checkout>`. The harness builds the package's `origin/main`, archives each public tracker's `origin/main`, executes both compiled implementations with no git executable and fenced ancestor discovery, and compares exact results and refusals. Every copied tracked file is hashed before and after. Only disposable copies can acquire derived runtime indexes; no tracker items, history or source files change. Original checkouts are read-only inputs.

| Public corpus | Source head | Items | Comparisons | Unchanged source files |
| --- | --- | ---: | ---: | ---: |
| `unbraind/pm-evidence` | `603e57d04e88ec4931ab5242d13c0dc3f6211514` | 10 | 165 | 26 |
| `unbraind/pm-changelog` | `fa8a8a1d0af97797e6a34a78bdd6b9b30242378e` | 197 | 189 | 404 |

Package baseline: `603e57d04e88ec4931ab5242d13c0dc3f6211514`. All 354 comparisons were identical, with no intentional output differences. Coverage includes whole-corpus token measurement, read-only `check`/`affected`, and packet construction from real item metadata at each prefix boundary and adjacent budgets, with both source-completeness states. These public trackers have no stored evidence citations; populated packet budgeting is tested directly, while synthetic real SDK trackers cover citation journeys.

## Integrity and revert controls

The new regression primes `listMutationEvents`, corrupts an authoritative history record hash, and attempts a review using the already-used client. The pinned transaction accepted that corruption before the added SDK `readHistoryEntries`/`verifyHistoryEntries` preflight. Now it refuses without changing the item or history. This is the sole intentional behavior change. The preflight verifies history independently of the cache; it does not claim an atomic fence against concurrent out-of-band history corruption between verification and commit. A verified-history precondition inside `commitItemMutations` would require upstream SDK support.

`node test/sdk-revert.acceptance.ts` restores each replaced function from `origin/main` separately and runs the SDK delegation assertion: each yields exactly one failure. These are explicitly **structural** controls. An exactly equivalent pure refactor cannot fail a behavioral parity test when reverted; behavioral revert proof for those two replacements is unavailable without changing the behavior being preserved. The separate history-verification removal yields exactly one **behavioral** corruption-test failure. Every control restores the source bytes in `finally`; tests import source directly and require no stale build workaround.

The full release gates retain their existing coverage and duplication thresholds. The tracker records commands, counts and CI receipts for this change.
