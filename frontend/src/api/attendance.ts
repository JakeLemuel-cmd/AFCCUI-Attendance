import { api } from "@/api/client";
import type { Attendance, AttendanceStatus, PaginationMeta } from "@/api/types";

interface GetAttendancesResponse {
  data: Attendance[];
  meta: PaginationMeta;
  summary: {
    total: number;
    present: number;
    absent: number;
  };
}

interface GetAttendancesParams {
  election_id?: number;
  search?: string;
  status?: AttendanceStatus;
  page?: number;
  per_page?: number;
}

interface UpsertAttendancePayload {
  election_id: number;
  voter_id?: string;
  attendance_id?: number;
  status: AttendanceStatus;
  checked_in_at?: string | null;
}

interface UpsertAttendanceResponse {
  message: string;
  data: Attendance;
}

interface DeleteAttendanceResponse {
  message: string;
  data: Attendance;
}

export interface DeleteAttendancesForElectionResponse {
  message: string;
  meta: {
    deleted: number;
    affected_voters: number;
    deleted_users?: number;
    protected_accounts?: string[];
  };
}

export interface ImportAttendanceResponse {
  message: string;
  meta: {
    created: number;
    updated: number;
    total_processed: number;
    skipped?: number;
  };
  errors?: Array<{ line: number; message: string }>;
}

interface AttendanceAccessCheckInPayload {
  election_id: number;
  attendance_id: number;
}

export interface AttendanceAccessCheckInResponse {
  message: string;
  data: {
    voter: {
      name: string;
      branch: string | null;
      voter_id: string | null;
      is_active: boolean;
      attendance_status: AttendanceStatus;
    };
    attendance_id?: number | null;
    election: {
      id: number;
      title: string;
      status: "draft" | "open" | "closed";
      start_datetime: string;
      end_datetime: string;
    };
    already_present: boolean;
    marked_present: boolean;
    marked_at: string | null;
  };
}

export interface AttendanceTaskProgressSnapshot {
  task_id: string;
  action: "import" | "delete" | string;
  status: "uploading" | "processing" | "deleting" | "completed" | "failed" | string;
  percent: number;
  message: string;
  processed: number;
  total: number;
  meta?: Record<string, unknown> | null;
  updated_at: string;
}

export async function getAttendances(params: GetAttendancesParams) {
  const response = await api.get<GetAttendancesResponse>("/attendances", {
    params: {
      election_id: params.election_id,
      search: params.search || undefined,
      status: params.status,
      page: params.page ?? 1,
      per_page: params.per_page ?? 25,
    },
  });

  return response.data;
}

export async function upsertAttendance(payload: UpsertAttendancePayload) {
  const response = await api.post<UpsertAttendanceResponse>("/attendances", payload);
  return response.data;
}

export async function deleteAttendance(userId: number, electionId: number) {
  const response = await api.delete<DeleteAttendanceResponse>(`/attendances/${userId}`, {
    params: {
      election_id: electionId,
    },
  });

  return response.data;
}

export async function deleteAttendancesForElection(electionId: number, confirmation: string, taskId?: string) {
  const response = await api.delete<DeleteAttendancesForElectionResponse>("/attendances", {
    params: {
      election_id: electionId,
      confirmation,
      task_id: taskId || undefined,
    },
  });

  return response.data;
}

export async function importAttendances(
  file: File,
  electionId?: number,
  taskId?: string,
  onUploadProgress?: (percent: number) => void
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("continue_on_error", "1");
  if (typeof electionId === "number") {
    formData.append("election_id", String(electionId));
  }
  if (taskId) {
    formData.append("task_id", taskId);
  }

  const response = await api.post<ImportAttendanceResponse>("/attendances/import", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
    onUploadProgress: onUploadProgress
      ? (event) => {
          const total = typeof event.total === "number" && event.total > 0 ? event.total : file.size;
          if (total <= 0) {
            return;
          }

          const loaded = Math.min(Math.max(event.loaded ?? 0, 0), total);
          const percent = Math.round((loaded / total) * 1000) / 10;
          onUploadProgress(Math.max(0, Math.min(100, percent)));
        }
      : undefined,
  });

  return response.data;
}

export async function getAttendanceTaskProgress(taskId: string) {
  const response = await api.get<AttendanceTaskProgressSnapshot>(`/attendances/progress/${encodeURIComponent(taskId)}`);
  return response.data;
}

export async function attendanceAccessCheckIn(payload: AttendanceAccessCheckInPayload) {
  const response = await api.post<AttendanceAccessCheckInResponse>("/attendance-access/check-in", payload);
  return response.data;
}

function escapeCsvValue(value: string) {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function downloadCsvBlob(blobData: BlobPart, fileName: string) {
  const blob = new Blob([blobData], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportPresentAttendancesCsv(electionId?: number) {
  const keepPresentRows = (rows: Attendance[]) => rows.filter((row) => row.status === "present");

  const firstPage = await getAttendances({
    election_id: electionId,
    status: "present",
    page: 1,
    per_page: 200,
  });

  const allRows: Attendance[] = [...keepPresentRows(firstPage.data)];
  for (let page = 2; page <= firstPage.meta.last_page; page += 1) {
    const nextPage = await getAttendances({
      election_id: electionId,
      status: "present",
      page,
      per_page: 200,
    });
    allRows.push(...keepPresentRows(nextPage.data));
  }

  const header = ["Name", "Branch", "Voter ID"];
  const body = allRows.map((row) => [
    row.user?.name ?? "",
    row.user?.branch ?? "",
    row.user?.voter_id ?? "",
  ]);

  const csv = [header, ...body]
    .map((line) => line.map((value) => escapeCsvValue(value)).join(","))
    .join("\r\n");

  downloadCsvBlob(csv, electionId ? `attendance_present_election_${electionId}.csv` : "attendance_present.csv");

  return allRows.length;
}
