import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';

/** Interpose package lifecycle boundaries while every SDK call remains real and unmodified. */
export async function atBoundary(boundary: string, competing: () => Promise<void>, run: () => Promise<void>): Promise<void> {
  const original = { register: Store.prototype.register, getRaw: Store.prototype.getRaw, commit: Store.prototype.commit, author: Store.prototype.author };
  let injected = false;
  /** One competing transition cannot recursively trigger its own injection. */
  const inject = async (current: string) => { if (!injected && current === boundary) { injected = true; await competing(); } };
  Store.prototype.register = async function () { await inject('register:before'); await original.register.call(this); await inject('register:after'); };
  Store.prototype.getRaw = async function (id) { await inject('get:before'); const result = await original.getRaw.call(this, id); await inject('get:after'); return result; };
  Store.prototype.author = async function () { await inject('author:before'); const result = await original.author.call(this); await inject('author:after'); return result; };
  Store.prototype.commit = async function (...args) { await inject('commit:before'); await original.commit.apply(this, args); await inject('commit:after'); };
  try { await run(); assert.equal(injected, true, boundary); }
  finally { Object.assign(Store.prototype, original); }
}
