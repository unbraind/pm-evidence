# Durable record validation

`validateRecord` is the exported full-state validator in `src/citation-schema.ts`. Its state and citation types derive from the same runtime schema. `show` reads it through `Store.get`/`state`; `check` and `affected` call it separately for each citation through `parseCitation`, so a malformed entry cannot hide valid siblings.

The only evidence writer is `Store.commit`, which validates and copies the **complete resulting state**, then serializes that validated copy for the conditional SDK transaction. The SDK compares the exact previously read field (or the native creation revision). Validation therefore cannot authorize a different target revision. Retry reads the target again and rebuilds the result. `mutateValue` also validates the complete proposal before schema registration; registration is followed by a fresh SDK read and reconstruction, including cancellation and expected-revision checks.

Write-path audit:

| Entry point | Changes | Commit route |
| --- | --- | --- |
| `cite` | New citation, idempotent duplicate, retained-byte upgrade | `mutate` → `mutateValue` → `commit` |
| `review` | Appended observation; re-anchor may add a replacement citation | `mutate` → `mutateValue` → `commit` |
| `check` | Compact snapshot observation, including coalesced checks | `observe` → `mutateValue` → `commit` |
| Native-record replay used by acceptance tests | Complete older input, fenced to the current target | `commit` |

There is no package import/export/sync/retract writer. `affected`, `show`, `replay` and source readers do not write evidence. All future writers must use the same commit boundary.

`RecordValidationError` is an `EvidenceError` with `code: schema`, `field`, `limit`, `observed` and a remedy. Observed strings and arrays become lengths; source contents never enter diagnostics. Check recording refusals appear in `receipt.verification.refusal`, leave `recordedItems` unchanged and make the receipt incomplete. If existing citations are malformed, valid siblings still resolve, but the invalid complete state is never persisted again. Restore the malformed entries before recording observations.

The boundary suite derives its cases from the runtime schema's JSON Schema representation. It covers minimum/maximum minus one, exact bound and plus one; empty collections/text; huge operands; literal Unicode lengths; non-finite/fractional coordinates; all enums; invalid literals, digests, IDs and timestamps. Oversized and sparse bounded arrays refuse before element parsing or allocation, including length 4,294,967,295. Explicit refinement cases add selector ordering, RFC 6901 escapes, source containment, sparse citations, duplicate identities and unknown fields. String limits count UTF-16 code units; source readers separately cap UTF-8 bytes. The schema limits are:

- Up to 10,000 citations, 10,000 reviews per citation, six active ATX ancestry entries.
- Literal source text up to 16,777,216 code units, pointers up to 33,554,944 and retained text up to 22,369,624. Required literal text has minimum length one; review reasons allow 1–1,000 code units.
- Revision 0–`Number.MAX_SAFE_INTEGER`; structural positions 1–`Number.MAX_SAFE_INTEGER`, integral and finite.
- Exact version, selector kinds, JSON encoding, review dispositions, resolution/freshness values, refusal codes and diff type.
- SHA-256 lowercase hex digests, deterministic citation ID format, ISO timestamps, root-relative source identities and valid pointer escapes.
- Strict object fields, dense citation entries, unique citation identities, matching citation ownership and ordered line ranges.

Real SDK tests compare complete accepted records read back from the tracker against the constructed operands, then call `show` and `check`. Refusals compare every authoritative tracker file byte for byte (items, histories, schema, settings and transaction journals) after SDK operations release their transient locks. Large accepted records use disposable non-git trackers to bound history and disk use. The fixed regression seeds 10,000 valid reviews and refuses the 10,001st without changing any file.

The mutation scheduler uses seeds `0x26a044` and `0xc0a1e5ce` for 500 sequences / 2,000 operations: citation replays and retain upgrades, ordinary reviews and re-anchors, compact checks, complete-record boundary attempts, revision edges and older-input replay. Boundary ordering uses seed `0x5c4e6a`. Every success is read through the SDK, `show` and `check`; every refusal preserves the authoritative tracker image. SDK reads independently update the pinned SDK’s `runtime/` usage receipts and metadata caches; those ancillary read effects are excluded, and are never restored or suppressed by this package. No handwritten normalization is used.
