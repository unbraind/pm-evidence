import { open, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { BUNDLE_MAX_BYTES, bundleTarget, exportBundle, importBundle, inspectBundle, setBundleConsent } from './bundles.js';
import { EvidenceError, requireInput } from './core.js';
/** Refuse missing or repeated single-value operands without reflecting input. */
function text(value) { requireInput(typeof value === 'string' && value.length > 0, 'Bundle text operand is required'); return value; }
/** Read a bounded regular UTF-8 JSON bundle without blocking on pipes or allocating unbounded input. */
async function readBundle(path) {
    try {
        const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
        try {
            const stat = await file.stat();
            requireInput(stat.isFile() && stat.size <= BUNDLE_MAX_BYTES, 'Bundle input must be a regular file of at most 4 MiB');
            const bytes = Buffer.alloc(BUNDLE_MAX_BYTES + 1);
            const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
            requireInput(bytesRead === stat.size, 'Bundle read was incomplete or changed size');
            const after = await file.stat();
            requireInput(JSON.stringify([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs]) === JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]), 'Bundle file changed during the read');
            const content = bytes.subarray(0, bytesRead);
            const decoded = new TextDecoder('utf-8', { fatal: true }).decode(content);
            return JSON.parse(decoded);
        }
        finally {
            await file.close();
        }
    }
    catch (error) {
        if (error instanceof EvidenceError)
            throw error;
        throw new EvidenceError('invalid', 'Bundle file could not be read as UTF-8 JSON', 'Supply an accessible regular JSON bundle exported by pm-evidence');
    }
}
/** Delegate all bundle policy, authorization, planning and validation to the public SDK functions. */
export async function runBundleCommand(command, ctx) {
    const flags = ctx.options;
    const options = { workspace: ctx.pm_root, author: ctx.global.author, client: ctx.sdk?.client };
    const item = text(command === 'bundle-import' || command === 'bundle-inspect' ? flags.item : ctx.args[0]);
    if (command === 'bundle-target')
        return bundleTarget(item, options);
    const citations = flags.citation === undefined ? [] : (Array.isArray(flags.citation) ? flags.citation : [flags.citation]).map(text);
    if (command === 'bundle-consent')
        return setBundleConsent({ item, citations, revision: text(flags.expectedRevision), consent: text(flags.consent) }, options);
    if (command === 'bundle-export') {
        const output = text(flags.out);
        const bundle = await exportBundle({ item, citations }, options);
        const bytes = JSON.stringify(bundle);
        try {
            await writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
        }
        catch {
            throw new EvidenceError('inaccessible', 'Bundle output could not be created exclusively', 'Choose a writable output file that does not already exist');
        }
        return { hash: bundle.hash, citations: bundle.entries.length, bytes: Buffer.byteLength(bytes), policy: bundle.policy };
    }
    requireInput(flags.authorize === true, 'Bundle target requires explicit --authorize');
    const authorization = { item, revision: text(flags.expectedRevision), authorized: true };
    const bundle = await readBundle(text(ctx.args[0]));
    if (command === 'bundle-import')
        return importBundle(bundle, authorization, { ...options, preview: flags.preview === true });
    return inspectBundle(bundle, authorization, { ...options, budget: flags.budget === undefined ? undefined : Number(flags.budget) });
}
//# sourceMappingURL=bundle-commands.js.map