import { useLayoutEffect, useRef, useState } from "react";

export type View =
  "home" | "library" | "detail" | "review" | "graph" | "timeline";
type Page = {
  view: View;
  selected: string | null;
  category: string[];
  q: string;
  tags: string[];
  page: number;
  fromDate: string;
  toDate: string;
};
const defaults: Page = {
  view: "home",
  selected: null,
  category: [],
  q: "",
  tags: [],
  page: 1,
  fromDate: "",
  toDate: "",
};
export function readPage(hash: string): Page {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const view = params.get("view") as View;
  let category: string[] = [];
  try {
    const value = JSON.parse(params.get("category") || "[]");
    if (Array.isArray(value) && value.every((item) => typeof item === "string"))
      category = value;
  } catch {
    /* Invalid links fall back to all categories. */
  }
  const page = Number(params.get("page") || 1);
  return {
    ...defaults,
    view: ["home", "library", "detail", "review", "graph", "timeline"].includes(
      view,
    )
      ? view === "detail" && !params.get("id")
        ? "library"
        : view
      : "home",
    selected: params.get("id"),
    category,
    q: params.get("q") || "",
    tags: [...new Set(params.getAll("tag").filter(Boolean))],
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    fromDate: params.get("from") || "",
    toDate: params.get("to") || "",
  };
}
export function pageHash(page: Page) {
  const params = new URLSearchParams({ view: page.view });
  if (page.selected && page.view === "detail") params.set("id", page.selected);
  if (page.category.length)
    params.set("category", JSON.stringify(page.category));
  if (page.q) params.set("q", page.q);
  for (const tag of page.tags) params.append("tag", tag);
  if (page.page > 1) params.set("page", String(page.page));
  if (page.fromDate) params.set("from", page.fromDate);
  if (page.toDate) params.set("to", page.toDate);
  return "#" + params.toString();
}
export const scrollToTop = () =>
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });

export function usePageNavigation() {
  const [page, setPage] = useState(() => readPage(window.location.hash));
  const [index, setIndex] = useState(
    () => Number(window.history.state?.knovoIndex) || 0,
  );
  const previous = useRef(page);
  useLayoutEffect(() => {
    const restore = () => {
      const restored = readPage(window.location.hash);
      previous.current = restored;
      setPage(restored);
      setIndex(Number(window.history.state?.knovoIndex) || 0);
      scrollToTop();
    };
    const restoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    window.addEventListener("popstate", restore);
    return () => {
      window.history.scrollRestoration = restoration;
      window.removeEventListener("popstate", restore);
    };
  }, []);
  useLayoutEffect(() => {
    const old = previous.current;
    const hash = pageHash(page);
    // Typing updates the current search entry instead of creating one per key.
    const push =
      pageHash(old) !== hash &&
      (old.view !== page.view ||
        old.selected !== page.selected ||
        (old.page !== page.page && old.q === page.q) ||
        JSON.stringify(old.category) !== JSON.stringify(page.category) ||
        JSON.stringify(old.tags) !== JSON.stringify(page.tags));
    if (push) {
      const nextIndex = (Number(window.history.state?.knovoIndex) || 0) + 1;
      window.history.pushState({ knovoIndex: nextIndex }, "", hash);
      setIndex(nextIndex);
    } else {
      window.history.replaceState(
        { ...window.history.state, knovoIndex: index },
        "",
        hash,
      );
    }
    if (pageHash(old) !== hash) scrollToTop();
    previous.current = page;
  }, [page, index]);
  const set = <K extends keyof Page>(key: K, value: Page[K]) => {
    setPage((old) => ({
      ...old,
      [key]: value,
      ...(["q", "category", "tags"].includes(key) ? { page: 1 } : {}),
    }));
  };
  return {
    ...page,
    setView: (value: View) => set("view", value),
    setSelected: (value: string | null) => set("selected", value),
    setCategory: (value: string[]) => set("category", value),
    setQ: (value: string) => set("q", value),
    setTags: (value: string[]) => set("tags", [...new Set(value)]),
    setLibraryPage: (value: number) => set("page", value),
    setFromDate: (value: string) => set("fromDate", value),
    setToDate: (value: string) => set("toDate", value),
    back: () => {
      if (index > 0) window.history.back();
      else {
        set("view", page.view === "detail" ? "library" : "home");
        scrollToTop();
      }
    },
    canGoBack: index > 0 || page.view !== "home",
  };
}
