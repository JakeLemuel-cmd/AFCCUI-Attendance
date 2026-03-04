import { createContext, useCallback, useMemo, useRef, useState } from "react";
import { extractErrorMessage } from "@/api/client";
import {
  deleteAttendancesForElection,
  getAttendanceTaskProgress,
  importAttendances,
  type DeleteAttendancesForElectionResponse,
  type ImportAttendanceResponse,
} from "@/api/attendance";

export type AttendanceTaskAction = "import" | "delete" | null;
export type AttendanceTaskStatus = "idle" | "uploading" | "processing" | "deleting" | "success" | "error";

interface AttendanceTaskState {
  action: AttendanceTaskAction;
  status: AttendanceTaskStatus;
  progress: number;
  message: string | null;
  taskId: string | null;
  fileName: string | null;
  processed: number;
  total: number;
}

interface AttendanceTaskContextValue extends AttendanceTaskState {
  isRunning: boolean;
  startImport: (file: File, electionId?: number) => Promise<ImportAttendanceResponse>;
  startDelete: (electionId: number, confirmation: string) => Promise<DeleteAttendancesForElectionResponse>;
  clearState: () => void;
}

const DEFAULT_STATE: AttendanceTaskState = {
  action: null,
  status: "idle",
  progress: 0,
  message: null,
  taskId: null,
  fileName: null,
  processed: 0,
  total: 0,
};

export const AttendanceTaskContext = createContext<AttendanceTaskContextValue | undefined>(undefined);

function generateTaskId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `attendance-task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function AttendanceTaskProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AttendanceTaskState>(DEFAULT_STATE);
  const activeTaskPromise = useRef<Promise<unknown> | null>(null);

  const clearState = useCallback(() => {
    setState((current) => {
      if (current.status === "uploading" || current.status === "processing" || current.status === "deleting") {
        return current;
      }

      return DEFAULT_STATE;
    });
  }, []);

  const startImport = useCallback(async (file: File, electionId?: number) => {
    if (activeTaskPromise.current) {
      throw new Error("Another attendance task is already in progress.");
    }

    const taskId = generateTaskId();
    setState({
      action: "import",
      status: "uploading",
      progress: 0,
      message: null,
      taskId,
      fileName: file.name,
      processed: 0,
      total: 0,
    });

    let shouldPoll = true;
    const pollPromise = (async () => {
      while (shouldPoll) {
        try {
          const snapshot = await getAttendanceTaskProgress(taskId);
          setState((current) => {
            if (current.taskId !== taskId) {
              return current;
            }

            const nextStatus: AttendanceTaskStatus =
              snapshot.status === "failed"
                ? "error"
                : snapshot.status === "completed"
                  ? "success"
                  : snapshot.status === "deleting"
                    ? "deleting"
                    : "processing";

            return {
              ...current,
              status: nextStatus,
              progress: snapshot.percent,
              message: snapshot.message || current.message,
              processed: snapshot.processed,
              total: snapshot.total,
            };
          });

          if (snapshot.status === "completed" || snapshot.status === "failed") {
            break;
          }
        } catch {
          // Snapshot may not be available yet; keep polling.
        }

        await delay(1000);
      }
    })();

    const task = importAttendances(file, electionId, taskId, (percent) => {
      setState((current) => {
        if (current.taskId !== taskId) {
          return current;
        }

        return {
          ...current,
          status: percent >= 100 ? "processing" : "uploading",
          progress: percent >= 100 ? 100 : percent,
          message: percent >= 100 ? "Upload complete. Processing rows..." : current.message,
        };
      });
    });

    activeTaskPromise.current = task;

    try {
      const response = await task;
      shouldPoll = false;
      await pollPromise;

      setState({
        action: "import",
        status: "success",
        progress: 100,
        message: response.message,
        taskId,
        fileName: file.name,
        processed: response.meta.total_processed,
        total: response.meta.total_processed,
      });

      return response;
    } catch (error) {
      shouldPoll = false;
      await pollPromise;

      setState((current) => ({
        ...current,
        action: "import",
        status: "error",
        progress: current.progress > 0 ? current.progress : 100,
        message: extractErrorMessage(error),
      }));

      throw error;
    } finally {
      shouldPoll = false;
      activeTaskPromise.current = null;
    }
  }, []);

  const startDelete = useCallback(async (electionId: number, confirmation: string) => {
    if (activeTaskPromise.current) {
      throw new Error("Another attendance task is already in progress.");
    }

    const taskId = generateTaskId();
    setState({
      action: "delete",
      status: "deleting",
      progress: 0,
      message: "Preparing deletion...",
      taskId,
      fileName: null,
      processed: 0,
      total: 0,
    });

    let shouldPoll = true;
    const pollPromise = (async () => {
      while (shouldPoll) {
        try {
          const snapshot = await getAttendanceTaskProgress(taskId);
          setState((current) => {
            if (current.taskId !== taskId) {
              return current;
            }

            const nextStatus: AttendanceTaskStatus =
              snapshot.status === "failed"
                ? "error"
                : snapshot.status === "completed"
                  ? "success"
                  : "deleting";

            return {
              ...current,
              status: nextStatus,
              progress: snapshot.percent,
              message: snapshot.message || current.message,
              processed: snapshot.processed,
              total: snapshot.total,
            };
          });

          if (snapshot.status === "completed" || snapshot.status === "failed") {
            break;
          }
        } catch {
          // Snapshot may not be available yet; keep polling.
        }

        await delay(1000);
      }
    })();

    const task = deleteAttendancesForElection(electionId, confirmation, taskId);
    activeTaskPromise.current = task;

    try {
      const response = await task;
      shouldPoll = false;
      await pollPromise;

      setState({
        action: "delete",
        status: "success",
        progress: 100,
        message: response.message,
        taskId,
        fileName: null,
        processed: response.meta.deleted_users ?? response.meta.deleted,
        total: response.meta.deleted_users ?? response.meta.deleted,
      });

      return response;
    } catch (error) {
      shouldPoll = false;
      await pollPromise;

      setState((current) => ({
        ...current,
        action: "delete",
        status: "error",
        progress: current.progress > 0 ? current.progress : 100,
        message: extractErrorMessage(error),
      }));

      throw error;
    } finally {
      shouldPoll = false;
      activeTaskPromise.current = null;
    }
  }, []);

  const value = useMemo<AttendanceTaskContextValue>(
    () => ({
      ...state,
      isRunning: state.status === "uploading" || state.status === "processing" || state.status === "deleting",
      startImport,
      startDelete,
      clearState,
    }),
    [state, startImport, startDelete, clearState]
  );

  return <AttendanceTaskContext.Provider value={value}>{children}</AttendanceTaskContext.Provider>;
}
