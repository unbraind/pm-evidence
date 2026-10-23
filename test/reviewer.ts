import { review } from '../index.ts';
/** Independent reviewer process; no shell, git, or SDK substitutes are involved. */
await review(process.argv[3], { workspace: process.argv[2], citation: process.argv[4], author: process.argv[5], disposition: 'still-valid', reason: 'Independent process review' });
