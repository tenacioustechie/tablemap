// Types for `appPaths.mjs`, so the Vitest suite in `src/` can import it.
export declare const APP_SCHEME: string;
export declare const APP_HOST: string;
export declare const APP_ORIGIN: string;
export declare const APP_START_URL: string;
export declare function resolveAppFile(requestUrl: string, root: string): string | null;
export declare function isAppUrl(target: string): boolean;
export declare function isExternalWebUrl(target: string): boolean;
