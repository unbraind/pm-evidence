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
    "resolved/current": 16,
    "resolved/changed": 1,
    "ambiguous/unknown": 1,
    "missing/unknown": 2
  },
  "ambiguous": [
    {
      "item": "pmc-lwfw",
      "citation": "ev-4982f42c132f4e4040682aff"
    }
  ],
  "comparison": {
    "estimator": "ceil(utf8_bytes/4), not a tokenizer",
    "fullCheckTokens": 2607,
    "wholeDocumentsTokens": 17174,
    "wholeDocumentsBytes": 68694,
    "boundedCheckTokens": 708,
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
    "returned": 4,
    "omitted": 0,
    "complete": false
  },
  "elapsedMs": 52949,
  "noGit": true,
  "scratchRemoved": true
}
```

Reproduce with `node test/real-data.acceptance.ts <public-pm-changelog-checkout>`. The harness uses that checkout's origin/main, archives only the public tracker and README/docs, verifies the scratch project is not a git repository, then removes git from PATH during the evidence journey.
