/** Small compiled-API witnesses for isolated function mutations; exhaustive tests retain all alias orders. */
import * as api from '../dist/index.js';
import { assertCitationReuseContract } from './citation-reuse-contract.ts';
import { nativeContractCli } from './helpers.ts';

await assertCitationReuseContract(api, nativeContractCli, true);
