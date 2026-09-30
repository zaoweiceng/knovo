export type Review = { id: string; stage: number; due: string; paused: number };
export type Note = {
  hash: string;
  id: string;
  title: string;
  summary: string;
  category: string[];
  tags: string[];
  knowledge_keywords: string[];
  dependency_keywords: string[];
  aliases: string[];
  body: string;
  status: "ready" | "learning";
  updated_at: string;
  created_at: string;
  learning_events: { date: string | null; summary: string }[];
  review: Review;
  snippet?: string;
  path: string;
};
export type Relation = {
  id: string;
  title: string;
  category?: string[];
  missing?: boolean;
  origin?: "keyword";
  matched_keywords?: string[];
};
export type Detail = Note & {
  relations: {
    prerequisites: Relation[];
    related: Relation[];
    dependents: Relation[];
  };
  history: { event_id: number; at: string; rating: string }[];
};
export type Stats = {
  total: number;
  categories: number;
  due: number;
  learning: number;
  today: string;
  days: { date: string; count: number }[];
  learningDays: { date: string; count: number }[];
  version: number;
  errors: { file: string; message: string }[];
};
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch("/api" + url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.headers.get("content-type")?.includes("application/json"))
    throw Error(
      `接口返回异常（HTTP ${res.status}），请确认后端已更新并重启，然后刷新页面`,
    );
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "请求失败");
  return data;
}
export function localDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
