/** ONNX session shim: Node (onnxruntime-node) + browser (onnxruntime-web).
 * Lazy imports only — unit tests with a fake provider never touch onnxruntime. */
export interface Batch {
    inputIds: number[][];
    attentionMask: number[][];
    markerPos: number[][];
    markerMask: boolean[][];
    qtype: number[];
}
export interface SessionProvider {
    runEncoder(batch: Batch): Promise<{
        lastHidden: number[][][];
    }>;
    runHead(hidden: number[][][] | unknown, batch: Batch): Promise<{
        logits: number[][];
        act: number[][];
    }>;
}
/** Encoder feeds: input_ids + attention_mask (int64). */
export declare function feed(ort: any, b: Batch): Record<string, any>;
/** Head feeds: encoder hidden + marker_pos/mask + qtype. */
export declare function feedHead(ort: any, hidden: number[][][] | any, b: Batch): Record<string, any>;
export interface ProviderOptions {
    device?: string;
    numThreads?: number;
}
export interface NodeBundle {
    dir: string;
    cfg: any;
    tokenizerJson: unknown | null;
}
export declare function loadNodeBundle(modelDirOrRepo: string, opts?: {
    subfolder?: string | null;
    localDir?: string;
    token?: string | null;
}): Promise<NodeBundle>;
export interface WebBundle {
    dir: string;
    cfg: any;
    tokenizerJson: unknown | null;
}
export declare function loadWebBundle(repoOrUrl: string, opts?: {
    subfolder?: string | null;
}): Promise<WebBundle>;
export declare function createNodeProvider(modelDir: string, opts?: ProviderOptions): Promise<SessionProvider>;
export declare function createWebProvider(modelUrl: string, opts?: ProviderOptions): Promise<SessionProvider>;
