import type { TokenizerLike } from "./tokenizer.js";
export type QType = "choice" | "score" | "noul";
export interface InternalQ {
    t: QType;
    ins: string;
    crit: unknown;
}
export declare function serializeState(state: unknown): string;
export declare function renderOptions(q: InternalQ): string[];
export declare function buildSequence(tok: TokenizerLike, state: unknown, q: InternalQ, maxLen?: number, headMaxLen?: number, optionOrder?: number[], truncateLeft?: boolean): {
    ids: number[];
    markers: number[];
};
export declare function softmax(z: number[]): number[];
export declare function confidenceFromProbs(p: number[]): number;
export declare const TEMP_MIN = 0.5, TEMP_MAX = 5;
export declare function clampTemperature(t: unknown): number;
export declare function tempBucket(qtype: number, k: number): string;
export interface CollateItem {
    ids: number[];
    markers: number[];
    qtype: number;
    label?: number;
    target?: number[];
    [k: string]: unknown;
}
export interface CollatedBatch {
    inputIds: number[][];
    attentionMask: number[][];
    markerPos: number[][];
    markerMask: boolean[][];
    qtype: number[];
    label: number[];
    meta: Record<string, unknown>[];
    target?: number[][];
}
/** TS parity of py `collate_items(batch, pad_id)`: batch = list of groups. */
export declare function collateItems(batch: CollateItem[][], padId: number): CollatedBatch | null;
