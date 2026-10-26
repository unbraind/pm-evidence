# Public-data evaluation

Only a disposable copy was changed. No source fleet tracker was written. The public snapshot, counts, UTF-8 byte estimates, logical calls, bounded omissions and ambiguous case are recorded below. Elapsed time is one local run, not a throughput claim. The harness deletes its scratch project in a finally block.

```json
{
  "repository": "unbraind/pm-changelog",
  "head": "600d9ffb564205d37262dd450c8a32b890017912",
  "citations": 20,
  "documents": 10,
  "baseline": {
    "resolved/current": 20
  },
  "statuses": {
    "resolved/current": 15,
    "resolved/changed": 1,
    "ambiguous/unknown": 2,
    "missing/unknown": 2
  },
  "ambiguous": [
    {
      "item": "pmc-review-266",
      "citation": "ev-26f599f9e2a493637ef2a364"
    },
    {
      "item": "pmc-lwfw",
      "citation": "ev-4982f42c132f4e4040682aff"
    }
  ],
  "comparison": {
    "estimator": "ceil(utf8_bytes/4), not a tokenizer",
    "fullCheckTokens": 2619,
    "wholeDocumentsTokens": 17174,
    "wholeDocumentsBytes": 68694,
    "boundedCheckTokens": 720,
    "boundedReturned": 5,
    "boundedOmitted": 15
  },
  "calls": {
    "cite": 20,
    "check": 3,
    "affected": 1,
    "discovery": 1,
    "sourceReads": 100
  },
  "affected": {
    "returned": 5,
    "omitted": 0,
    "complete": false
  },
  "elapsedMs": 12193,
  "noGit": true,
  "scratchRemoved": true
}
```

Reproduce with `node test/real-data.acceptance.ts <public-pm-changelog-checkout>`. The harness uses that checkout's origin/main, archives only the public tracker and README/docs, verifies the scratch project is not a git repository, then removes git from PATH during the evidence journey.

The PR review rerun applies strict passage-context matching. A moved paragraph whose saved surroundings no longer match now requires review as ambiguous, alongside the duplicated quote. Both remain in affected context.

## Coalesced verification, 2026-10-25

`node test/coalesced-real-data.acceptance.ts <public-fleet-checkout>` confirms the source repository is public, archives its committed tracker and README into a disposable non-git directory, and seeds 50 valid citations across five existing native items through the SDK. It then makes the 405 archived files read-only and hashes them before and after verification. Every source and tracker input remains unchanged during the measured read-only SDK and native CLI checks. Git is unavailable on PATH; ancestor discovery is fenced. No original checkout is written.

```json
{
  "repository": "unbraind/pm-changelog",
  "head": "fa8a8a1d0af97797e6a34a78bdd6b9b30242378e",
  "trackerItems": 197,
  "citingItems": 5,
  "citations": 50,
  "documents": 1,
  "sourceBytes": 27794,
  "full": {
    "current": 50,
    "sourceReads": 1,
    "previousPerCitationReads": 50,
    "estimatedTokens": 6573,
    "complete": true
  },
  "bounded": {
    "sourceReads": 1,
    "returned": 5,
    "omitted": 45,
    "estimatedTokens": 751
  },
  "cli": [
    {
      "format": "toon",
      "bytes": 1800,
      "estimatedTokens": 450
    },
    {
      "format": "json",
      "bytes": 3002,
      "estimatedTokens": 751
    }
  ],
  "readonlyFilesUnchanged": 405,
  "noGit": true,
  "gitExecutableUnavailable": true,
  "elapsedMs": 33420
}
```

The stable document needed **one source-read attempt for fifty citations**, compared with fifty per-citation reads before coalescing. Each independent invocation reads afresh. The full result returned all fifty current citations. The 800-token packet returned five and explicitly omitted forty-five; both native renderers stayed within budget. Estimates count UTF-8 bytes with the SDK estimator, not model tokens. Elapsed time includes fixture setup and is not a throughput claim. Synthetic real-source races and cancellation tests separately prove that mutable or canceled reads never yield a mixed-revision success.

`test/coalesced-model.test.ts` uses a seeded exact-byte reference model and SDK readback for 500 four-operation sequences, including old-input replays, JSON whitespace/CRLF and escape variants, retained bytes, repeated reviews, recorded/read-only checks, relationship traversal, and preservation of native fields, links and collections. This package has no import/export/sync entrypoints or journaled plans; it reuses SDK mutations and relationship traversal. Transaction identities include the native target timestamp and evidence envelope. `test/coalesced-races.test.ts` injects real peer transitions at all eight package observation boundaries on non-git trackers. It does not mock the SDK or overwrite foreign evidence.

The model computes SHA-256 independently with Node crypto and compares exact retained input bytes, review fields, provenance, timestamps, native comments and collection counts. A further boundary control refreshes an SDK result view in place while reading a source: recording still compares against the envelope captured before the first source await. `node test/coalesced-revert.acceptance.ts` runs eight behavioral negative controls across seven changed functions; each must produce exactly one isolated regression failure before all source bytes are restored, including reintroducing late envelope capture. The final-head release matrix and reviewer availability are reported on [PR 6](https://github.com/unbraind/pm-evidence/pull/6).

## Producer/validator closure, 2026-10-26

A read-only review found a valid `Policy` citation beneath a tab-containing ancestor being rejected by a separate verifier shape. `src/citation-schema.ts` now defines the sole runtime citation/selector/ancestry contracts and their inferred public TypeScript types. Selection and ancestry production validate through those same definitions. Literal tabs, CRLF-derived fragment text, combining marks, confusables, emphasis/code spelling and source-sized long headings/pointers are preserved, without whitespace or Unicode normalization.

`test/citation-roundtrip.test.ts` uses seed `0x26c17e` across **1,024 documents** (512 Markdown, 512 JSON) and **64 real non-git SDK trackers**. Every document has an accepted citation; the test reads retained bytes and native citation state back through the SDK, independently hashes the exact expected fragment, verifies unchanged `check`/`affected` behavior, then applies a constructed mutation. The measured statuses were **238 changed, 274 ambiguous, 256 missing and 256 current**, with zero foreign items. An additional **73 duplicate-heading selector attempts** were deliberately refused; an unambiguous line fragment in each of those documents still round-tripped. Sources cover tabs, LF/CRLF, Unicode and confusables, literal markup in headings, deep repeated headings, long ancestry/selected headings and JSON pointer keys beyond 4,096 characters.

The exact review case passes. A mixed native envelope containing null, malformed, valid and duplicate entries reports indexed per-citation refusals, resolves the valid sibling, and preserves all existing evidence without recording an invalid complete state. Eight function-only negative controls each produce exactly one failing regression, including restoration of the legacy ancestry restriction and restoration of item-wide validation; all source bytes are restored afterward.
