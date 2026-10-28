# Portable retained artifact validation

The public measurement uses committed `unbraind/pm-evidence` main at `2224762cd3aa85e9fafd4a550e22852e3cff91ab`. The harness checks that the repository is public, archives its tracker and README into a non-git directory, makes all 37 copied source files read-only, certifies the 15-item corpus through the SDK, and independently compares every source file digest afterward. Git discovery is fenced and the Git executable is unavailable during feature execution.

Six real public item title fragments are retained on a separate scratch sender item. The explicit export includes five; the sixth source is excluded. The source tracker is never changed. A separate non-git recipient imports the artifacts and reads them back through the SDK; exact replay uses the bundle bytes alone. These are transport measurements, with no claim about the truth of the cited titles.

| Measurement | Result |
| --- | ---: |
| Certified public tracker items | 15 |
| Read-only source files verified unchanged | 37 |
| Cited / exported / excluded artifacts | 6 / 5 / 1 |
| Compact bundle bytes | 3,964 |
| Retained fragment bytes | 360 |
| Successful exact source-free replays | 5 |
| First import additions / retry additions | 5 / 0 |
| Tampered bundle refusals / revoked export refusals | 1 / 1 |
| Inspection returned / omitted rows | 5 / 0 |
| Inspection estimated tokens at budget 800 | 502 |

Reproduce with `node test/bundle-real-data.acceptance.ts <public-fleet-checkout>`. The source checkout is read-only input to the harness. All measurement artifacts stay disposable and untracked.

The focused tests cover complete validation before durable writes, selection exclusion, separate retention and sharing permission, legacy citations without sharing grants, typed foreign-target skips, conflicting origin/retained fields, no-op retries, native edit/restore generations, same-plan preview/apply equality and multi-hop original identity. CLI tests run with no Git executable and compare native TOON/JSON output against declared budgets. Extreme inputs include sparse and huge arrays, non-finite and fractional coordinates, invalid UTF-8, noncanonical base64, oversized envelopes and seeded retained-byte mutations.

`test/fixtures/retained-citation-v2026.10.28.json` is the exact native evidence state emitted by the released `v2026.10.28` producer in a disposable non-git tracker using a synthetic CRLF source. The must-allow corpus reads and replays it unchanged, then exports after an explicit sharing grant. The trailing CR byte remains literal. CLI file reads additionally require the complete declared file size and unchanged descriptor identity/metadata; real descriptor interpositions exercise short reads and same-size concurrent edits before any import write.

Export and validation share a bounded serializer. It counts aggregate UTF-8 string data before JSON allocation and then checks the exact escaped transport size, so individually valid records cannot build an unbounded aggregate or bypass the cap with escaped control text. Both refusal paths have focused regression coverage.

The seeded transfer model runs 500 sequences (2,000 operations) on 25 real non-git trackers. It schedules native edits, custom active/blocked status registries, ambient focus changes, sharing grants/revocations, exports, previews/imports, onward transfers, native reviews and older-bundle replays. It compares state read back through the SDK after every operation against a separate artifact/consent/review model; native normalization is observed through the SDK, never duplicated. Exact CRLF, whitespace, large JSON-number lexemes, parent/dependency relationships and unrelated native fields are retained. There is no sync API or tracker creation path in the product.

Concurrency tests cover eight import and eight sharing/consent boundaries, injecting native edits before and after each preflight/apply exchange and schema registration/attribution boundary on one tracker. They check peer success from fresh state and show a competing native writer cannot enter a held SDK lease. Authorization is revalidated under the apply lease, so failed attempts cannot replay saved plans blindly. New imports start with sharing revoked and carry the original source citation identity across hops.
