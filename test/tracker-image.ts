import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Exact authoritative tracker image; SDK read-usage receipts and metadata caches are runtime state. */
export async function durable(workspace: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  /** Enumerate only this disposable tracker, including metadata, history and SDK state. */
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(join(workspace, relative), { withFileTypes: true })) {
      const name = join(relative, entry.name);
      if (name === 'runtime') continue;
      if (entry.isDirectory()) await visit(name); else result[name] = createHash('sha256').update(await readFile(join(workspace, name))).digest('hex');
    }
  }
  await visit(''); return result;
}
