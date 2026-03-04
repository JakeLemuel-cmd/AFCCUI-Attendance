import { api } from "@/api/client";
import type { PaginationMeta, User, UserRole } from "@/api/types";

export async function getVoters(page = 1, perPage = 25, search = "", electionId?: number, branch?: string) {
  const response = await api.get<{ data: User[]; meta: PaginationMeta }>("/voters", {
    params: {
      page,
      per_page: perPage,
      search: search || undefined,
      election_id: electionId,
      branch: branch || undefined,
    },
  });

  return response.data;
}

export async function updateVoterStatus(userId: number, isActive: boolean) {
  const response = await api.patch<{ data: User }>(`/voters/${userId}/status`, {
    is_active: isActive,
  });

  return response.data.data;
}

interface CreateVoterPayload {
  name: string;
  branch?: string | null;
  email?: string | null;
  voter_id: string;
  voter_key: string;
  is_active?: boolean;
}

export interface ManageUserPayload {
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  voter_id?: string | null;
  voter_key?: string | null;
  password?: string;
}

export async function getUsers(page = 1, perPage = 25, search = "", role?: UserRole) {
  const response = await api.get<{ data: User[]; meta: PaginationMeta }>("/users", {
    params: {
      page,
      per_page: perPage,
      search: search || undefined,
      role: role || undefined,
    },
  });

  return response.data;
}

export async function createUser(payload: ManageUserPayload) {
  const response = await api.post<{ data: User }>("/users", payload);
  return response.data.data;
}

export async function updateUser(userId: number, payload: ManageUserPayload) {
  const response = await api.patch<{ data: User }>(`/users/${userId}`, payload);
  return response.data.data;
}

export async function deleteUser(userId: number) {
  await api.delete(`/users/${userId}`);
}

export async function createVoter(payload: CreateVoterPayload) {
  const response = await api.post<{ data: User }>("/voters", payload);
  return response.data.data;
}

export async function updateVoter(userId: number, payload: CreateVoterPayload) {
  const response = await api.patch<{ data: User }>(`/voters/${userId}`, payload);
  return response.data.data;
}

export async function deleteVoter(userId: number) {
  await api.delete(`/voters/${userId}`);
}

export interface DeleteVotersResponse {
  message: string;
  data: {
    deleted: number;
    reassigned_elections: number;
    protected_accounts: string[];
  };
}

export async function deleteAllVotersExceptProtected(confirmation: string) {
  const response = await api.delete<DeleteVotersResponse>("/voters", {
    data: {
      confirmation,
    },
  });

  return response.data;
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

export async function exportVoters(search = "", electionId?: number, branch?: string) {
  const response = await api.get<Blob>("/voters/export", {
    params: {
      search: search || undefined,
      election_id: electionId,
      branch: branch || undefined,
    },
    responseType: "blob",
  });

  downloadCsvBlob(response.data, "voters.csv");
}

export async function exportVoterLogs(search = "", electionId?: number, branch?: string) {
  const response = await api.get<Blob>("/voters/logs/export", {
    params: {
      search: search || undefined,
      election_id: electionId,
      branch: branch || undefined,
    },
    responseType: "blob",
  });

  downloadCsvBlob(response.data, electionId ? `voter_logs_election_${electionId}.csv` : "voter_logs.csv");
}

export async function downloadVoterTemplate() {
  const response = await api.get<Blob>("/voters/template", {
    responseType: "blob",
  });

  downloadCsvBlob(response.data, "voter_import_template.csv");
}

export interface ImportVotersResponse {
  message: string;
  meta: {
    created: number;
    updated: number;
    total_processed: number;
    skipped?: number;
  };
  errors?: Array<{ line: number; message: string }>;
}

export interface VoterImportProgressSnapshot {
  status: "upload_received" | "validating" | "importing" | "completed" | "failed";
  percent: number;
  processed: number;
  total: number;
  created: number;
  updated: number;
  message: string;
  updated_at: string;
}

export async function getVoterImportProgress(importId: string) {
  const response = await api.get<{ data: VoterImportProgressSnapshot }>(`/voters/import/progress/${encodeURIComponent(importId)}`);
  return response.data.data;
}

export async function importVoters(file: File, importId: string, onProgress?: (percent: number) => void) {
  const formData = new FormData();
  formData.append("import_id", importId);
  formData.append("file", file);
  formData.append("continue_on_error", "1");

  const response = await api.post<ImportVotersResponse>("/voters/import", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
    onUploadProgress: (event) => {
      if (!onProgress) {
        return;
      }

      const total = typeof event.total === "number" && event.total > 0 ? event.total : file.size;
      if (total <= 0) {
        return;
      }

      const loaded = Math.min(Math.max(event.loaded ?? 0, 0), total);
      const percent = Math.min(100, Math.max(0, Math.round((loaded / total) * 1000) / 10));
      onProgress(percent);
    },
  });

  onProgress?.(100);
  return response.data;
}
