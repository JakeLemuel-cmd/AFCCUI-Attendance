import axios from "axios";

const normalizeUrl = (value: string) => value.replace(/\/+$/, "");
const LOCAL_API_ORIGIN = "http://localhost:8000";
const isDev = import.meta.env.DEV;

const apiOriginFromEnv = import.meta.env.VITE_API_ORIGIN ?? import.meta.env.VITE_API_URL ?? "";
const API_ORIGIN = normalizeUrl(apiOriginFromEnv || (isDev ? LOCAL_API_ORIGIN : ""));
const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim();

const API_BASE_URL = (() => {
  if (rawBaseUrl && rawBaseUrl !== "/api") {
    return normalizeUrl(rawBaseUrl);
  }

  if (API_ORIGIN) {
    return `${API_ORIGIN}/api`;
  }

  if (isDev) {
    return `${LOCAL_API_ORIGIN}/api`;
  }

  return "/api";
})();

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  withXSRFToken: true,
  xsrfCookieName: "XSRF-TOKEN",
  xsrfHeaderName: "X-XSRF-TOKEN",
  headers: {
    Accept: "application/json",
  },
});

export async function ensureCsrfCookie() {
  const csrfOrigin = API_ORIGIN || (isDev ? LOCAL_API_ORIGIN : "");

  await axios.get(`${csrfOrigin}/sanctum/csrf-cookie`, {
    withCredentials: true,
    withXSRFToken: true,
    xsrfCookieName: "XSRF-TOKEN",
    xsrfHeaderName: "X-XSRF-TOKEN",
    headers: {
      Accept: "application/json",
    },
  });
}

export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | {
          message?: string;
          errors?: Record<string, string[]> | Array<{ line?: number | string; message?: string }>;
        }
      | undefined;

    if (!error.response) {
      const errorCode = String(error.code ?? "").toUpperCase();
      const rawMessage = String(error.message ?? "").toLowerCase();
      const isTimeout = errorCode.includes("TIMEOUT") || rawMessage.includes("timeout") || rawMessage.includes("timed out");

      if (isTimeout) {
        return `The API request to ${API_BASE_URL} timed out. The backend may still be processing the task.`;
      }

      return `No response from the API at ${API_BASE_URL}. Check backend URL/origin settings and CORS, then retry.`;
    }

    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      const firstError = data.errors[0];
      const linePrefix =
        typeof firstError?.line === "number" || typeof firstError?.line === "string"
          ? `Line ${firstError.line}: `
          : "";
      if (firstError?.message) {
        return `${linePrefix}${firstError.message}`;
      }
    }

    if (data?.errors && !Array.isArray(data.errors)) {
      const firstField = Object.values(data.errors)[0];
      if (firstField?.[0]) {
        return firstField[0];
      }
    }

    if (data?.message) {
      return data.message;
    }
  }

  return "An unexpected error occurred.";
}
