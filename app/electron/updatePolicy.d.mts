// Types for `updatePolicy.mjs`, so the Vitest suite in `src/` can import it.
export type UpdateMode = "off" | "install" | "notify";
export interface UpdatePrompt {
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}
export declare const RELEASES_OWNER: string;
export declare const RELEASES_REPO: string;
export declare const UPDATE_CHECK_INTERVAL_MS: number;
export declare function updateMode(context: {
  platform: string;
  isPackaged: boolean;
  env: Record<string, string | undefined>;
}): UpdateMode;
export declare function releasePageUrl(version: string): string;
export declare function downloadedPrompt(version: string): UpdatePrompt;
export declare function availablePrompt(version: string): UpdatePrompt;
