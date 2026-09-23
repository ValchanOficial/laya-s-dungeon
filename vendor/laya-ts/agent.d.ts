import type { SessionProvider } from "./providers.js";
import { type TokenizerLike } from "./tokenizer.js";
export declare const QTYPES: Record<string, number>;
export interface QuestionDef {
    type: string;
    instructions?: unknown;
    criteria?: unknown;
    [k: string]: unknown;
}
export interface ActionInfo {
    act_probability: number;
}
export interface ChoiceAnswer {
    type: "choice";
    choice: string;
    probabilities: Record<string, number>;
    confidence: number;
    action: ActionInfo;
}
export interface ScoreAnswer {
    type: "score";
    score: number;
    legend: Record<string, unknown>;
    probabilities: Record<string, number>;
    confidence: number;
    action: ActionInfo;
}
export interface NoulAnswer {
    type: "noul";
    noul: number;
    confidence: number;
    action: ActionInfo;
}
export type SystemAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;
export interface SystemUsage {
    input_tokens: number;
    output_tokens: number;
}
export interface SystemOneResult {
    model: string;
    answers: Record<string, SystemAnswer>;
    usage: SystemUsage;
}
export interface AgentCfg {
    max_len?: number;
    head_max_len?: number;
    temperature?: unknown;
    temperature_by_options?: Record<string, unknown>;
    [k: string]: unknown;
}
export interface AgentOptions {
    provider: SessionProvider;
    tok?: TokenizerLike;
    cfg?: AgentCfg;
    max_len?: number;
    head_max_len?: number;
    temperature?: unknown;
    temperature_by_options?: Record<string, unknown>;
}
export declare function checkQuestion(qid: string, qdef: unknown): void;
export declare function toInternal(qdef: QuestionDef): {
    t: "choice" | "score" | "noul";
    ins: string;
    crit: unknown;
};
export declare function defaultTokenizer(): TokenizerLike;
export declare class Agent {
    cfg: AgentCfg;
    provider: SessionProvider;
    tok: TokenizerLike;
    maxLen: number;
    headMaxLen: number;
    temperatureRaw: unknown;
    temperatureByOptionsRaw: Record<string, unknown>;
    temperature: number[];
    temperatureByOptions: Record<string, number>;
    constructor(opts: AgentOptions);
    systemOne(state: unknown, questions: Record<string, QuestionDef>): Promise<SystemOneResult>;
    predict(state: unknown, questions: Record<string, QuestionDef>): Promise<SystemOneResult>;
    static load(modelDirOrRepo: string, opts?: {
        device?: string;
        subfolder?: string | null;
        localDir?: string;
        token?: string | null;
        numThreads?: number;
    }): Promise<Agent>;
}
