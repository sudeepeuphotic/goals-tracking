import axios from "axios";
import { getAuthToken } from "@/lib/authToken";

function normalizeBaseUrl(rawUrl) {
  if (!rawUrl) return "";
  // Guard against accidentally passing placeholders like <url> or trailing symbols.
  return rawUrl
    .trim()
    .replace(/[<>]/g, "")
    .replace(/\/+$/, "");
}

const BACKEND_URL = normalizeBaseUrl(process.env.REACT_APP_BACKEND_URL || "");
export const API = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function formatApiError(err) {
  const detail = err?.response?.data?.detail;
  if (detail == null) return err?.message || "Something went wrong";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}
