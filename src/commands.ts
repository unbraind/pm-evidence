import { createPmCliExpectedError } from '@unbrained/pm-cli/sdk';
import { defineCommand } from '@unbrained/pm-cli/sdk/authoring';
import type { CommandHandlerContext, ExtensionApi, FlagDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { affected, check, cite, review, show } from './evidence.ts';
import { bindCriterion, criterionFacts } from './criteria.ts';
import { EvidenceError, requireInput } from './core.ts';
import { FIELDS } from './store.ts';
import type { Disposition, Selector } from './types.ts';

/** Validate one text flag without coercing missing or multiple operands. */
function text(value: unknown): string { requireInput(typeof value === 'string', 'Required text operand is missing'); return value; }
/** Convert an exclusive native selector into its typed SDK representation. */
export function selector(options: Record<string, unknown>): Selector {
  requireInput(['lines', 'heading', 'pointer'].filter(key => options[key] !== undefined).length === 1, 'Choose exactly one selector');
  if (options.pointer !== undefined) return { kind: 'pointer', pointer: text(options.pointer) };
  if (options.heading !== undefined) return { kind: 'heading', heading: text(options.heading), paragraph: 1 };
  const match = /^(\d+)-(\d+)$/.exec(text(options.lines)); requireInput(match !== null, 'Lines require the a-b format');
  return { kind: 'lines', start: Number(match[1]), end: Number(match[2]) };
}
/** Dispatch through the same public API and let the host render TOON or JSON. */
export async function runCommand(command: string, ctx: CommandHandlerContext): Promise<unknown> {
  try {
    const options = ctx.options; const base = { workspace: ctx.pm_root, author: ctx.global.author, client: ctx.sdk?.client, root: options.root === undefined ? '.' : text(options.root) };
    const bounded = { ...base, budget: options.budget === undefined ? undefined : Number(options.budget), diff: options.diff === true, maxBytes: options.maxBytes === undefined ? undefined : Number(options.maxBytes), timeoutMs: options.timeoutMs === undefined ? undefined : Number(options.timeoutMs) };
    if (command === 'bind') return await bindCriterion({ item: text(ctx.args[0]), citation: text(options.citation), criterion: { text: text(options.criterion), revision: text(options.criterionRevision) } }, base);
    if (command === 'criteria') return await criterionFacts(ctx.args.map(text), bounded);
    if (command === 'cite') return await cite(text(ctx.args[0]), text(ctx.args[1]), { ...base, selector: selector(options), retain: options.retain === true });
    if (command === 'check' || command === 'affected') {
      const controller = new AbortController();
      /** Convert process cancellation into a receipt while the active verification unwinds. */
      const cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
      try {
        if (command === 'check') return await check(ctx.args.map(text), { ...bounded, record: options.readOnly !== true, signal: controller.signal });
        return await affected({ ...bounded, signal: controller.signal, changed: options.changed === undefined ? undefined : (Array.isArray(options.changed) ? options.changed : [options.changed]).map(text), depth: options.depth === undefined ? undefined : Number(options.depth) });
      } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    }
    if (command === 'review') return await review(text(ctx.args[0]), { ...base, citation: text(options.citation), disposition: text(options.disposition) as Disposition, reason: text(options.reason), selector: ['lines', 'heading', 'pointer'].some(key => options[key] !== undefined) ? selector(options) : undefined, expectedRevision: options.expectedRevision === undefined ? undefined : Number(options.expectedRevision) });
    if (command === 'show') return await show(text(ctx.args[0]), base);
    throw new EvidenceError('invalid', 'Unknown evidence command', 'Run pm evidence --help');
  } catch (error) {
    const refusal = error instanceof EvidenceError ? error : new EvidenceError('sdk', 'Evidence operation failed', 'Check tracker health, source access and SDK schema');
    throw createPmCliExpectedError(`evidence ${refusal.code}: ${refusal.message}. Remedy: ${refusal.remedy}`, { exitCode: refusal.code === 'conflict' ? 3 : 2 });
  }
}
/** Register thin commands and their package-owned schema field in the native host. */
export function register(api: ExtensionApi): void {
  api.registerItemFields(FIELDS);
  const definitions = [
    ['cite', ['item', 'source'], ['root', 'lines', 'heading', 'pointer'], ['retain'], 'Record an exact source fragment', 'pm evidence cite decision-id README.md --lines 3-5'],
    ['check', ['items'], ['root', 'budget', 'max-bytes', 'timeout-ms'], ['diff', 'read-only'], 'Verify citations with one snapshot per source and read counts', 'pm evidence check decision-id --budget 800 --read-only'],
    ['affected', [], ['root', 'budget', 'changed', 'depth', 'max-bytes', 'timeout-ms'], [], 'List context requiring explicit evidence review', 'pm evidence affected --changed README.md --depth 2'],
    ['review', ['item'], ['root', 'citation', 'disposition', 'reason', 'expected-revision', 'lines', 'heading', 'pointer'], [], 'Record an idempotent fenced review observation', 'pm evidence review decision-id --citation ev-id --disposition still-valid --reason "Reviewed"'],
    ['show', ['item'], [], [], 'Show citations and their last checks', 'pm evidence show decision-id'],
    ['bind', ['item'], ['citation', 'criterion', 'criterion-revision'], [], 'Bind a citation to an exact current criterion revision', 'pm evidence bind decision-id --citation ev-id --criterion "Expected outcome" --criterion-revision sha256'],
    ['criteria', ['items'], ['root', 'budget', 'max-bytes', 'timeout-ms'], [], 'Read criterion revision and source support facts without asserting truth', 'pm evidence criteria decision-id --root . --budget 800'],
  ] as const;
  for (const [name, args, strings, booleans, description, example] of definitions) {
    const flags: FlagDefinition[] = [...strings.map(flag => ({ long: `--${flag}`, description: `${flag} (example: ${example})`, value_type: 'string' as const, value_name: flag, repeatable: flag === 'changed' })), ...booleans.map(flag => ({ long: `--${flag}`, description: `${flag} (example: ${example} --${flag})`, value_type: 'boolean' as const }))];
    api.registerCommand(defineCommand({ name: `evidence ${name}`, description, intent: 'Project management = context management: evidence freshness for agents', arguments: args.map(arg => ({ name: arg, description: `${arg} (example: ${example})`, required: !['check', 'criteria'].includes(name), variadic: ['check', 'criteria'].includes(name) })), flags, examples: [example], run: ctx => runCommand(name, ctx) }));
  }
}
