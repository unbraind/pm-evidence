/** Test-only native host preload: fix wall time and persist a peer review immediately before a bind. */
import { mock } from 'node:test';
import { Store } from '../src/store.ts';
import { review } from '../index.ts';

mock.timers.enable({ apis: ['Date'], now: new Date('2032-03-04T05:06:07.000Z') });
const commit = Store.prototype.commit;
let injected = false;
Store.prototype.commit = async function (...args) {
  if (!injected) {
    injected = true;
    const current = await this.get(args[0]);
    await review(args[0], { ...this.options, author: 'peer', citation: current.value.citations[0].id, disposition: 'still-valid', reason: `Persisted CLI peer review ${process.argv.includes('bind') ? 'bind' : 'check'}` });
  }
  await commit.apply(this, args);
};
