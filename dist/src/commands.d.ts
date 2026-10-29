import type { CommandHandlerContext, ExtensionApi } from '@unbrained/pm-cli/sdk/authoring';
import type { Selector } from './types.ts';
/** Convert an exclusive native selector into its typed SDK representation. */
export declare function selector(options: Record<string, unknown>): Selector;
/** Dispatch through the same public API and let the host render TOON or JSON. */
export declare function runCommand(command: string, ctx: CommandHandlerContext): Promise<unknown>;
/** Register thin commands and their package-owned schema field in the native host. */
export declare function register(api: ExtensionApi): void;
//# sourceMappingURL=commands.d.ts.map