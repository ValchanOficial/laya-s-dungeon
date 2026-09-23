import { type AnalyseResult } from "./lang.js";
import type { QuestionDef, SystemOneResult } from "./agent.js";
export declare const BUNDLE_REPO = "convaiinnovations/laya";
export interface ModelSpec {
    repo: string;
    subfolder: string | null;
}
export declare const DEFAULT_MODELS: Record<string, ModelSpec>;
export declare const STANDALONE_MODELS: Record<string, string>;
export type ModelName = "english" | "multilingual" | "typed-decisions";
export declare function normaliseName(name: string): ModelName;
export declare function matchTypedDecisionsWorkflow(questions: Record<string, unknown> | null | undefined): string | null;
export declare function englishFromCode(value: unknown): boolean | null;
/** Parity alias for the Python `_english_from_code` name. */
export declare const _englishFromCode: typeof englishFromCode;
export interface RouteDecision {
    model: ModelName;
    repo: string;
    reason: string;
    detection: AnalyseResult | null;
    workflow: string | null;
}
export type RoutedResult = SystemOneResult & {
    routing: RouteDecision;
};
export type LangGuess = string | null | undefined | ((state: unknown) => unknown);
export type AgentLoader = (name: ModelName, spec: ModelSpec) => unknown | Promise<unknown>;
export interface RouterOptions {
    models?: Record<string, string | ModelSpec | [string, string | null]>;
    device?: string | null;
    token?: string | null;
    maxLoaded?: number;
    max_loaded?: number;
    default?: string;
    autoTaskDetection?: boolean;
    auto_task_detection?: boolean;
    standaloneRepos?: boolean;
    standalone_repos?: boolean;
    preload?: boolean | string[];
    langGuess?: LangGuess;
    lang_guess?: LangGuess;
    loader?: AgentLoader;
}
export interface RouteOptions {
    model?: string | null;
    task?: string | null;
    lang?: string | null;
    langGuess?: LangGuess;
    lang_guess?: LangGuess;
}
export declare class Router {
    models: Record<string, ModelSpec>;
    device: string | null;
    token: string | null | undefined;
    maxLoaded: number;
    default: ModelName;
    autoTaskDetection: boolean;
    langGuess: LangGuess;
    loader: AgentLoader | null;
    _agents: Map<string, unknown>;
    _order: string[];
    constructor(opts?: RouterOptions);
    load(name: string): Promise<unknown>;
    _touch(key: string): void;
    _evict(): void;
    attach(name: string, agent: unknown): unknown;
    preload(names?: string[]): Promise<this>;
    unload(name?: string | null): void;
    get loaded(): string[];
    _resolveHint(hint: LangGuess, state: unknown): boolean | null;
    route(state: unknown, questions?: Record<string, unknown> | null, opts?: RouteOptions): RouteDecision;
    predict(state: unknown, questions: Record<string, QuestionDef>, opts?: RouteOptions): Promise<RoutedResult>;
    systemOne(state: unknown, questions: Record<string, QuestionDef>, opts?: RouteOptions): Promise<RoutedResult>;
}
