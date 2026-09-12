/**
 * Import-UI state shared by the file picker and drag-drop: runs imports one
 * at a time through `MapActions`, exposing progress and the last error.
 */
import { useCallback, useRef, useState } from "react";
import { isSupportedImageFile, MapImportError, type MapActions } from "../state/mapActions";

export interface MapImportState {
  importFiles: (files: readonly File[]) => Promise<void>;
  importing: boolean;
  error: string | null;
}

function describeError(error: unknown): string {
  if (error instanceof MapImportError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export function useMapImport(actions: MapActions): MapImportState {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const importFiles = useCallback(
    (files: readonly File[]) => {
      const run = async () => {
        setError(null);
        const supported = files.filter(isSupportedImageFile);
        const rejected = files.filter((f) => !isSupportedImageFile(f));
        if (rejected.length > 0) {
          setError(
            `${rejected.map((f) => f.name).join(", ")}: only PNG, JPEG and WebP images can be imported.`
          );
        }
        if (supported.length === 0) return;
        setImporting(true);
        try {
          for (const file of supported) {
            try {
              await actions.importImage(file);
            } catch (e) {
              setError(describeError(e));
            }
          }
        } finally {
          setImporting(false);
        }
      };
      chain.current = chain.current.then(run, run);
      return chain.current;
    },
    [actions]
  );

  return { importFiles, importing, error };
}
