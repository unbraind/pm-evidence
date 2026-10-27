/** Verify many citations with one read per authorized provider/source and explicit cancellation. */
import { check } from '../index.ts';

const controller = new AbortController();
const result = await check([], {
  workspace: '.agents/pm', root: '.', author: 'evidence-reader',
  record: false, budget: 800, signal: controller.signal,
});
console.log(JSON.stringify({ verification: result.receipt.verification, complete: result.receipt.complete, rows: result.rows }));
// A canceled or source-incomplete receipt must be retried before treating the check as exhaustive.
