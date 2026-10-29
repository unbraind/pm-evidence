/** Explicit sharing and target authorization preserve exact retained fragments without source access. */
import { bundleTarget, exportBundle, importBundle, inspectBundle, setBundleConsent } from '../index.ts';

const workspace = process.argv[2]; const sourceItem = process.argv[3]; const citation = process.argv[4]; const targetItem = process.argv[5];
if (!workspace || !sourceItem || !citation || !targetItem) throw new Error('Pass tracker, source item, citation and existing target item');
const options = { workspace, author: 'bundle-example' };
await setBundleConsent({ ...await bundleTarget(sourceItem, options), citations: [citation], consent: 'granted' }, options);
const bundle = await exportBundle({ item: sourceItem, citations: [citation] }, options);
const authorization = { ...await bundleTarget(targetItem, options), authorized: true as const };
console.log(await inspectBundle(bundle, authorization, { ...options, budget: 800 }));
console.log(await importBundle(bundle, authorization, { ...options, preview: true }));
console.log(await importBundle(bundle, authorization, options));
