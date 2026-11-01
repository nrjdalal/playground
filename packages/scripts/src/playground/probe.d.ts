import "@packages/env/aliases";
import { type DashboardBeat, type Dispatcher, type Probes } from "./plan";
export declare const homeDataDir: () => string;
declare const run: (argv: string[], cwd?: string, timeout?: number) => {
    code: number;
    out: string;
};
export declare const liveBranch: () => string;
export declare const NO_CHECKOUT = "no Dashboard checkout yet; run playground once to set it up";
export declare const dashboardCheckout: (repo: string, exec?: typeof run, branch?: string) => string | null;
export declare const dashboardPath: (repo: string) => string;
export declare const cutDashboardCheckout: (repo: string, exec?: typeof run, branch?: string) => {
    checkout: string;
} | {
    error: string;
};
export type Urls = {
    api: string;
    web: string;
};
export declare const dashboardUrls: (dashboard: string) => Urls | null;
export declare const apiUp: (urls: Urls | null) => Promise<boolean>;
export declare const webUp: (urls: Urls | null) => Promise<boolean>;
export declare const liveDispatchers: () => Dispatcher[];
export declare const liveSessions: (keep: (name: string) => boolean) => Dispatcher[];
export declare const glmSetUp: () => Promise<boolean>;
export declare const linesSince: (file: string, offset: number) => Promise<string[]>;
export declare const opsDashboard: () => string;
export declare const followerRunning: () => boolean;
export declare const dashboardBeat: (now?: number) => DashboardBeat | null;
export declare const supervisorRunning: () => boolean;
export declare const probe: (urls: Urls | null) => Promise<Probes>;
export {};
