/** Bind one existing citation to a current criterion, then consume source-only adapter facts. */
import { bindCriterion, criterionFacts, EvidenceError } from '../index.ts';

const [item, citation] = process.argv.slice(2);
if (!item || !citation) throw new Error('Usage: node examples/criteria.ts item-id ev-id');
const options = { workspace: '.agents/pm', root: '.', author: 'evidence-example', budget: 800 };
try {
  const before = await criterionFacts([item], options);
  const criterion = before.rows.find(row => row.support === 'unbound' && row.revision !== null);
  if (criterion === undefined) throw new Error('Choose an unbound criterion; increase the budget if rows were omitted');
  await bindCriterion({ item, citation, criterion: { text: criterion.criterion, revision: criterion.revision! } }, options);
  console.log(JSON.stringify(await criterionFacts([item], options)));
} catch (error) {
  if (error instanceof EvidenceError) console.error(JSON.stringify({ code: error.code, remedy: error.remedy }));
  else throw error;
}
