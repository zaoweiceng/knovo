import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Options } from "react-markdown";

export const markdownPlugins: Pick<Options, "remarkPlugins" | "rehypePlugins"> =
  {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [[rehypeKatex, { trust: false, strict: "ignore" }]],
  };
