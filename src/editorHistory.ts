export type EditorSnapshot = {
  text: string;
  selection?: { from: number; to: number; surface: "source" | "rich" };
};
/** One history shared by source, visual editor and toolbar commands. */
export class EditorHistory {
  past: EditorSnapshot[] = [];
  future: EditorSnapshot[] = [];
  current: EditorSnapshot;
  private last = 0;
  private group = "";
  constructor(text = "") {
    this.current = { text };
  }
  reset(text: string) {
    this.current = { text };
    this.past = [];
    this.future = [];
    this.group = "";
  }
  record(next: EditorSnapshot, group = "", now = Date.now()) {
    if (next.text === this.current.text) {
      this.current = next;
      return;
    }
    if (
      !group ||
      this.group !== group ||
      now - this.last > 700 ||
      this.future.length
    ) {
      this.past.push(this.current);
      if (this.past.length > 200) this.past.shift();
    }
    this.future = [];
    this.current = next;
    this.last = now;
    this.group = group;
  }
  undo() {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(this.current);
    this.current = previous;
    this.group = "";
    return previous;
  }
  redo() {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.current);
    this.current = next;
    this.group = "";
    return next;
  }
}
