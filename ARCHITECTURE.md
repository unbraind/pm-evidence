# pm-evidence architecture

Evidence is external context used to justify a native item. This package checks exact bytes, not semantic truth. It has no model, network adapter, daemon, git invocation or hosted service.

## Descriptor and selectors

A descriptor contains `provider`, root-relative `source`, SHA-256 UTF-8 content `revision`, `selector` and an exact text `anchor`. The caller supplies the root each time; roots and resolved filesystem paths are never persisted or returned. The digest covers the entire coherent source snapshot. A git blob identity is optional in the proposal; this implementation always uses content digests, so there is no git dependency.

Line ranges are one-based, inclusive, with the cited quote and up to 24 neighboring characters on each side. Newline bytes within the fragment are significant. The line terminator after the final selected line is outside the fragment. UTF-8 BOMs are preserved; malformed UTF-8 refuses. Markdown supports ATX headings and blank-line-separated paragraphs; CLI selects the first paragraph, the SDK can select a one-based paragraph ordinal. It is not a complete Markdown parser. JSON pointers implement RFC 6901 (`~0`, `~1`), strict array indexes and own properties. JSON selected values are serialized with JSON.stringify, so whitespace outside the selected value does not affect freshness. Object member order remains significant.

Resolution first counts every exact quote occurrence, including overlaps. One exact quote can move anywhere in the same source. Multiple hits are ambiguous even at the original line. There is no fuzzy matching. If the quote is absent, uniquely matching exact surrounding boundaries can identify a changed fragment. Empty boundaries mean the original file edge. Repeated boundaries are ambiguous; absent or reversed boundaries are missing. The original selector is never silently rewritten. Explicit re-anchoring follows the uniquely resolved current fragment, or uses a caller-provided replacement selector, and creates a separate citation from one coherent current snapshot while retaining the original and its reviews.

## Two axes

Resolution: `resolved`, `missing`, `inaccessible`, `ambiguous`, `unsupported`.
Freshness: `current`, `changed`, `unknown`.

Freshness compares selected fragment digests, independently of the source digest. An outside edit or unique movement is resolved/current with `sourceChanged: true`. Ambiguous or unavailable current fragments have unknown freshness. `check({revision:'cited'})` verifies retained original bytes: resolution can be resolved while freshness is changed against the current fragment. `currentResolution` preserves current availability even during historical replay. Without retained bytes, historical resolution is missing. A caller cannot reconstruct original evidence from today's bytes. Ordinary checks do not automatically fall back to historical bytes.

## Native storage and writes

One registered optional string field, `evidence_state`, contains version 1, an evidence revision counter and citations. Native items, relationships, comments, settings and append-only history remain SDK-owned. This is a package field, not a competing core metadata reference or entry-ID schema. A citation includes fragment digest, descriptor, item/author/time provenance, observations, optional base64 retained fragment and compact last check. Citation IDs are deterministic fingerprints of item, descriptor and digest. Review IDs fingerprint citation, author, disposition, reason and replacement. Identical retries deduplicate; distinct reviewers remain distinct.

Schema registration goes through the SDK. Attribution uses SDK `selectImportAuthor` with SDK settings. Changes use `commitItemMutations` with a lock-held field match on the exact previous evidence envelope. The first write matches native `updated_at`: SDK 2026.10.23 does not accept an absent field match. The successful transaction updates the field, links file/JSON identities through native SDK linked files and appends a compact native comment together. Linked paths are logical identities relative to the caller-selected source root, labeled with that convention; they never persist the machine root. Eight CAS attempts bound contention; explicit `expectedRevision` refuses stale callers. No package code writes tracker files directly. SDK transaction journals and locks are disposable runtime data.

`check` records a compact last observation by default. SDK callers can request `record:false` for read-only checks. Check does not change citation digests, descriptors or reviews. No command closes items or declares a Decision false.

The pinned SDK's atomic mutation API takes a tracker root rather than an injected remote client. This MVP is proven for filesystem trackers with and without git. Reads may reuse an active host client; remote backend mutation conformance is not claimed. A future backend-aware atomic SDK API is required before making that claim.

## Limits and completeness

Built-in file and JSON readers canonicalize the selected root and source, reject traversal/absolute identities and symlink escapes, require regular readable files, and use no-follow/nonblocking opens. Discovery, descriptor and post-read path metadata must agree (device, inode, size, mtime and ctime), otherwise the read refuses. A race barrier fixture changes real files between discovery and open; no fragment escapes from a mixed revision. This is cooperative local filesystem access, not a sandbox against a hostile process continually swapping ancestor directories.

Default cap: 1 MiB/source and 5 seconds/read. SDK caps can increase to 16 MiB and 60 seconds. Reads are bounded in memory and check cancellation at read boundaries. Custom adapters receive the same root/cap/signal contract and must provide a coherent SHA-256 content revision; their side effects and source authorization are caller-owned. The deadline bounds returned work even if a custom adapter ignores cancellation. Source bytes are read internally to compute the content revision; only fragments requested with `diff` enter output.

The default check/affected budget is 800 estimated tokens. The estimate is the larger rendered host TOON/pretty JSON byte count divided by four, rounded up, including the omission receipt and its own counter. It is not a model tokenizer. Oversized packets keep a deterministic prefix and exact omitted row count. A budget too small for the receipt refuses. Source checks still cover the selected scope when output rows are omitted.

Affected uses `listAllComplete` and `certifyCompleteListResult`; incomplete corpus reads refuse. SDK `RelationshipGraph` supplies hierarchy and dependency paths. A projection reverses hierarchy edges so parents and incoming dependents share one traversal. Changed and unresolved evidence both require explicit review; current evidence does not. Paths are bounded by depth (default 2, maximum 16) and traversal limit (default 100, maximum 10000) per citation. `sourceComplete:false` and `complete:false` disclose unknown evidence or unexpanded graph frontiers. `omitted` counts enumerated rows withheld by the output budget; nodes beyond a traversal bound have unknown counts and are not included in that number. `scope` records item/citation denominators and requested traversal bounds. The result never claims global exhaustive impact from a partial source or traversal.

## Privacy and inert rendering

Only explicit `--retain` stores replay bytes. Text selectors necessarily store their exact quote/context to relocate evidence even without retention; retained replay is a separate verified copy. Source anchors and retained bytes are excluded from routine show/check output. `--diff` contains labeled `source-data` arrays; control bytes are escaped so ANSI cannot alter terminal output. Source content never becomes a command, callback, instruction, exception message or automatic upload. Diagnostics are package-owned text with remedies. Hashes and relative identities can still reveal equality and filenames; choosing sources and committing tracker evidence remains an explicit caller decision.
