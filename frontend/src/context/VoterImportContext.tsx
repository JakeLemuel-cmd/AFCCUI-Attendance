import { createContext, useCallback, useMemo, useRef, useState } from "react";
import { extractErrorMessage } from "@/api/client";
import { getVoterImportProgress, importVoters, type ImportVotersResponse } from "@/api/users";

export type VoterImportStatus = "idle" | "uploading" | "processing" | "success" | "error";

interface VoterImportState {
  status: VoterImportStatus;
  progress: number;
  fileName: string | null;
  message: string | null;
  importId: string | null;
  processed: number;
  total: number;
  meta: ImportVotersResponse["meta"] | null;
}

interface VoterImportContextValue extends VoterImportState {
  isImporting: boolean;
  startImport: (file: File) => Promise<ImportVotersResponse>;
  clearState: () => void;
}

const DEFAULT_STATE: VoterImportState = {
  status: "idle",
  progress: 0,
  fileName: null,
  message: null,
  importId: null,
  processed: 0,
  total: 0,
  meta: null,
};

export const VoterImportContext = createContext<VoterImportContextValue | undefined>(undefined);

function generateImportId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `import-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function VoterImportProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<VoterImportState>(DEFAULT_STATE);
  const activeImportPromise = useRef<Promise<ImportVotersResponse> | null>(null);

  const clearState = useCallback(() => {
    setState((current) => {
      if (current.status === "uploading" || current.status === "processing") {
        return current;
      }

      return DEFAULT_STATE;
    });
  }, []);

  const startImport = useCallback(async (file: File) => {
    if (activeImportPromise.current) {
      throw new Error("A voter import is already in progress.");
    }

    const importId = generateImportId();
    setState({
      status: "uploading",
      progress: 0,
      fileName: file.name,
      message: null,
      importId,
      processed: 0,
      total: 0,
      meta: null,
    });

    let shouldPoll = true;
    const pollPromise = (async () => {
      while (shouldPoll) {
        try {
          const snapshot = await getVoterImportProgress(importId);

          setState((current) => {
            if (current.importId !== importId) {
              return current;
            }

            const nextStatus =
              snapshot.status === "failed"
                ? "error"
                : snapshot.status === "completed"
                  ? "success"
                  : snapshot.status === "importing"
                    ? "processing"
                    : "uploading";

            return {
              ...current,
              status: nextStatus === "error" || nextStatus === "success" ? current.status : nextStatus,
              progress: snapshot.percent,
              processed: snapshot.processed,
              total: snapshot.total,
              message: snapshot.message || current.message,
            };
          });

          if (snapshot.status === "completed" || snapshot.status === "failed") {
            break;
          }
        } catch {
          // Import may not have written progress yet; keep polling.
        }

        await delay(700);
      }
    })();

    const task = importVoters(file, importId, (percent) => {
      setState((current) => {
        if (current.importId !== importId) {
          return current;
        }

        return {
          ...current,
          progress: percent >= 100 ? current.progress : percent,
          status: percent >= 100 ? "processing" : "uploading",
          message: percent >= 100 ? "Upload complete. Waiting for server processing..." : current.message,
        };
      });
    });

    activeImportPromise.current = task;

    try {
      const response = await task;
      shouldPoll = false;
      await pollPromise;

      setState({
        status: "success",
        progress: 100,
        fileName: file.name,
        message:
          typeof response.meta.skipped === "number" && response.meta.skipped > 0
            ? `Import complete. ${response.meta.created} created, ${response.meta.updated} updated, ${response.meta.total_processed} processed, ${response.meta.skipped} skipped.`
            : `Import complete. ${response.meta.created} created, ${response.meta.updated} updated, ${response.meta.total_processed} processed.`,
        importId,
        processed: response.meta.total_processed,
        total: response.meta.total_processed,
        meta: response.meta,
      });

      return response;
    } catch (error) {
      shouldPoll = false;
      await pollPromise;

      setState((current) => ({
        ...current,
        status: "error",
        fileName: file.name,
        message: extractErrorMessage(error),
        importId,
        meta: null,
      }));

      throw error;
    } finally {
      shouldPoll = false;
      activeImportPromise.current = null;
    }
  }, []);

  const value = useMemo<VoterImportContextValue>(
    () => ({
      ...state,
      isImporting: state.status === "uploading" || state.status === "processing",
      startImport,
      clearState,
    }),
    [state, startImport, clearState]
  );

  return <VoterImportContext.Provider value={value}>{children}</VoterImportContext.Provider>;
}
