# Published pm SDK capability floor

Audited main: `4e8bee4218e022d1a9d45fe4fbecb5b635a0b52d`. Required API floor: **2026.8.18**.

Declared host floor: `2026.10.23`. npm peer: `>=2026.10.23`.

floor verified: the host declaration and the npm peer or exact runtime dependency already cover every API below. No floor change is needed.

## Artifact method and limits

The published version list was obtained with `npm view @unbrained/pm-cli versions --json`. Each capability was bisected over stable published releases, with its first providing release and adjacent previous stable release inspected. Prereleases do not satisfy these stable npm minimum ranges. Tarballs were downloaded with `npm pack @unbrained/pm-cli@VERSION --ignore-scripts` into an isolated scratch directory and inspected as data. No downloaded pm package code or lifecycle script was executed.

Public module exports were checked against both `package.json` entrypoints and the static ESM runtime export graph, then their `dist` declarations. Client methods and context members were read from the published declarations, including inherited members and static methods. A context property is attributed to the context used by this package, rather than a later base-interface refactor. TypeScript symbol resolution covers aliases, typed lazy loaders, destructuring, and clients passed through helpers. Erased interfaces do not create runtime requirements; imported function/constructor types used by loaders are retained conservatively.

This establishes API availability. It does not attest older-host runtime semantics, provider integration, or execution on the declared minimum. The current pinned SDK remains the local test host.

## API to first-version table

The machine-readable source inventory and artifact hashes are in [sdk-floor.json](sdk-floor.json). Source locations refer to the audited main commit.

| Used API | First stable release | Previous stable release lacking it | Source uses |
| --- | --- | --- | --- |
| `@unbrained/pm-cli/sdk :: certifyCompleteListResult` | 2026.8.18 | 2026.8.17 | [src/store.ts:1](../src/store.ts#L1) |
| `@unbrained/pm-cli/sdk :: commitItemMutations` | 2026.7.20 | 2026.7.19 | [src/store.ts:1](../src/store.ts#L1) |
| `@unbrained/pm-cli/sdk :: createOutputOmissionReceipt` | 2026.7.30 | 2026.7.29 | [src/core.ts:2](../src/core.ts#L2) |
| `@unbrained/pm-cli/sdk :: createPmCliExpectedError` | 2026.6.5 | 2026.5.31 | [src/commands.ts:1](../src/commands.ts#L1) |
| `@unbrained/pm-cli/sdk :: estimatePmOutputTokens` | 2026.7.28 | 2026.7.27 | [src/core.ts:2](../src/core.ts#L2) |
| `@unbrained/pm-cli/sdk :: getHistoryPath` | 2026.5.14 | 2026.5.12 | [src/store.ts:1](../src/store.ts#L1) |
| `@unbrained/pm-cli/sdk :: PmClient` | 2026.7.6 | 2026.7.5 | [src/types.ts:1](../src/types.ts#L1), [src/store.ts:1](../src/store.ts#L1) |
| `@unbrained/pm-cli/sdk :: readHistoryEntries` | 2026.7.15 | 2026.7.14 | [src/store.ts:1](../src/store.ts#L1) |
| `@unbrained/pm-cli/sdk :: readSettings` | 2026.5.14 | 2026.5.12 | [src/store.ts:1](../src/store.ts#L1) |
| `@unbrained/pm-cli/sdk :: RelationshipGraph` | 2026.7.15 | 2026.7.14 | [src/evidence.ts:1](../src/evidence.ts#L1) |
| `@unbrained/pm-cli/sdk :: selectImportAuthor` | 2026.5.27 | 2026.5.24 | [src/store.ts:1](../src/store.ts#L1) |
| `@unbrained/pm-cli/sdk :: verifyHistoryEntries` | 2026.7.24 | 2026.7.23 | [src/store.ts:1](../src/store.ts#L1) |
| `@unbrained/pm-cli/sdk/authoring :: defineCommand` | 2026.7.26 | 2026.7.25 | [src/commands.ts:2](../src/commands.ts#L2) |
| `@unbrained/pm-cli/sdk/authoring :: defineExtension` | 2026.7.26 | 2026.7.25 | [index.ts:1](../index.ts#L1) |
| `CommandHandlerContext.args` | 2026.5.1 | 2026.3.12 | [src/commands.ts:24](../src/commands.ts#L24), [src/commands.ts:25](../src/commands.ts#L25), [src/commands.ts:27](../src/commands.ts#L27), [src/commands.ts:28](../src/commands.ts#L28) |
| `CommandHandlerContext.global` | 2026.5.1 | 2026.3.12 | [src/commands.ts:22](../src/commands.ts#L22) |
| `CommandHandlerContext.options` | 2026.5.1 | 2026.3.12 | [src/commands.ts:22](../src/commands.ts#L22) |
| `CommandHandlerContext.pm_root` | 2026.5.1 | 2026.3.12 | [src/commands.ts:22](../src/commands.ts#L22) |
| `CommandHandlerContext.sdk` | 2026.7.19 | 2026.7.18 | [src/commands.ts:22](../src/commands.ts#L22) |
| `ExtensionApi.registerCommand` | 2026.5.1 | 2026.3.12 | [src/commands.ts:47](../src/commands.ts#L47) |
| `ExtensionApi.registerItemFields` | 2026.5.1 | 2026.3.12 | [src/commands.ts:37](../src/commands.ts#L37) |
| `ExtensionCommandSdk.client` | 2026.7.19 | 2026.7.18 | [src/commands.ts:22](../src/commands.ts#L22) |
| `PmClient.get` | 2026.7.6 | 2026.7.5 | [src/store.ts:40](../src/store.ts#L40) |
| `PmClient.listAllComplete` | 2026.8.18 | 2026.8.17 | [src/store.ts:38](../src/store.ts#L38) |
| `PmClient.schemaAddField` | 2026.7.9 | 2026.7.8 | [src/store.ts:34](../src/store.ts#L34) |
| `PmClient.schemaListFields` | 2026.7.9 | 2026.7.8 | [src/store.ts:32](../src/store.ts#L32) |
| `RelationshipGraph.closure` | 2026.7.15 | 2026.7.14 | [src/evidence.ts:71](../src/evidence.ts#L71) |
| `RelationshipGraph.edges` | 2026.7.15 | 2026.7.14 | [src/evidence.ts:61](../src/evidence.ts#L61) |
| `RelationshipGraph.fromItems` | 2026.7.15 | 2026.7.14 | [src/evidence.ts:61](../src/evidence.ts#L61) |
| `RelationshipGraph.nodes` | 2026.7.15 | 2026.7.14 | [src/evidence.ts:61](../src/evidence.ts#L61) |
| `RelationshipGraph.shortestPath` | 2026.7.15 | 2026.7.14 | [src/evidence.ts:74](../src/evidence.ts#L74) |

## Tarball provenance

SHA-256 of the exact packed `.tgz` bytes; package archives and extracted files are not committed.

| pm release | Tarball SHA-256 |
| --- | --- |
| 2026.3.12 | `4e4e6a33cb45d665f072120e9e1ce25d2e5773e738cbc914b29e8f54367747fb` |
| 2026.5.1 | `730de8b79aa0074dc2ca81a54ce37f9aaa0a4167b690c9a62b87d2121a8b37f7` |
| 2026.5.12 | `42dcaef84dc441b7792aeffa059bfe10a86ae8b12b1084472229bba03fb29910` |
| 2026.5.14 | `7f7e9131afadb891344bf2fb93b15bc157d18c532a5da4ec31677957d37b7260` |
| 2026.5.24 | `9d28fff4b06405ea5691ee919ad646c86c0a416a5007ca8104b19251306262af` |
| 2026.5.27 | `afd3c6e0ecca429510f049019069802c0034a3e99fb711035b5b22fc8fa643dd` |
| 2026.5.31 | `d3b4a795704588e414070a22a4034d7fbd7a290a050509cc4852e0051c0969a7` |
| 2026.6.5 | `bb47c85bb2ce1a8ba858651af8d1f4ca6888bc731d0aaaa63a4b97427219cd89` |
| 2026.7.5 | `4a6664f68120cace5648faf48d51b08c14e969d9c7e185e592f1a0fceae57274` |
| 2026.7.6 | `0d6e446cf93a0f0660ce4e21943adf1e0c21381010ef67369f40cc9834b8d158` |
| 2026.7.8 | `b892cce02e555decd3f0d09af0d2a5d8817494fe577e357ffaea84ef385a9b6a` |
| 2026.7.9 | `87600f77a82d5e66c8ac05f120b435a0fb22b5fad42ae5db4540bb4ca45a01ea` |
| 2026.7.14 | `4a42de258a3b1cabff1112dd90ae4f3cc272e25ada229d818becae0f2845e128` |
| 2026.7.15 | `1c5d8e7427d74af157577ff58e0692a986016ee355eaf3a6b5ccebca5a9779aa` |
| 2026.7.18 | `44b48fe680cf330254a4ab8d42b55cbcee81ba5cf21e4d4550b40413265d64b9` |
| 2026.7.19 | `513e0aead42767a113a26b8b2e2cbb8a22879d0cb0500d4d3cdd16d21d9f7a39` |
| 2026.7.20 | `6fbc1d789477491e007d03396dbf1dd2f09376220059887faf6f9d50668a6b08` |
| 2026.7.23 | `caf1a21b0b587dc55c3509654466dd1e20383e30f2d17b47678887a15a5490af` |
| 2026.7.24 | `ae7757c7e4b02bf5c0908a7bcfd487926912bc2f71332c68c9e1be4017d796ab` |
| 2026.7.25 | `20dfec2ca4ddfcebd484af686b76aebcb1f479a7b81c781380a7fe6b6f8506f5` |
| 2026.7.26 | `b10b647a7fce423106dfb964934ac2d43b8770f8f085df89a13c9a04e75569cc` |
| 2026.7.27 | `d42dc525a76d61662929adfbd3e160f6411f0991b1913c0de274d329b46495d4` |
| 2026.7.28 | `aed7dc6af73cf396dc6a6d6069a1a230a5a45503329b257316a5ae455f5c3f82` |
| 2026.7.29 | `70a5e5e6b1a908a0dc5b1f16700a4dbe4c2546ce18e01c9d20863d4746d36e93` |
| 2026.7.30 | `e553adf21f01ff2adbee84d482b66ea64734808103978fc4e90ab65caac6ad81` |
| 2026.8.17 | `fda330eb4887031751889ef85b510d52886fa5f70b4813f3951d7eed705023f2` |
| 2026.8.18 | `b00374f0e32c98ccec03a5893d8bfbbae45650f44bd04292ceafd8d9aac059f7` |
