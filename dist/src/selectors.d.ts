import type { Anchor, Descriptor, Selector } from './types.ts';
/** A selected byte-preserving substring and its offsets within the UTF-8 decoded text. */
export interface Fragment {
    text: string;
    start: number;
    end: number;
}
/** Resolve exact current bytes with the production selector, independently of retained historical replay; performs no I/O or writes. */
export declare function resolveFragmentText(text: string, descriptor: Descriptor): string;
/** Report every exact occurrence, including overlaps; never accept a fuzzy match. */
export declare function hits(text: string, quote: string): number[];
/** Resolve the caller's initial structural selector without whole-document output. */
export declare function select(text: string, selector: Selector): Fragment;
/** Determine the full ATX heading ancestry at the cited passage, including repeated parent titles. */
export declare function sectionPath(text: string, offset: number): string[];
/** Retain exact quote, neighboring characters and Markdown ancestry for conservative relocation. */
export declare function anchor(text: string, fragment: Fragment, heading?: boolean): Anchor;
/** Relocate only a unique exact quote or unique exact surrounding boundaries. */
export declare function resolveFragment(text: string, descriptor: Descriptor): Fragment;
//# sourceMappingURL=selectors.d.ts.map