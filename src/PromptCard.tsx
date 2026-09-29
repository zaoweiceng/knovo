import { useState } from "react";
import { knowledgePrompt } from "./knowledgePrompt";
export default function PromptCard({ onPaste }: { onPaste: () => void }) {
  const [state, setState] = useState("");
  const [show, setShow] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(knowledgePrompt);
      else {
        const field = document.createElement("textarea");
        field.value = knowledgePrompt;
        field.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(field);
        try {
          field.select();
          if (!document.execCommand("copy"))
            throw Error("clipboard unavailable");
        } finally {
          field.remove();
        }
      }
      setState("已复制，粘贴到原来的 AI 对话窗口即可");
    } catch {
      setShow(true);
      setState("无法访问剪贴板，请从下方手动复制");
    }
  };
  return (
    <section className="prompt-card">
      <div>
        <h3>把一次对话，变成可以回顾的知识</h3>
        <p>
          复制提示词 → 发到原来的 AI 对话窗口 →
          将返回的文本块粘贴导入，支持一次导入多个知识点。
        </p>
      </div>
      <div className="prompt-actions">
        <button className="btn primary" onClick={copy}>
          复制整理提示词
        </button>
        <button className="btn" onClick={onPaste}>
          粘贴 AI 整理结果
        </button>
        <button className="text-btn" onClick={() => setShow(!show)}>
          {show ? "收起提示词" : "查看提示词"}
        </button>
      </div>
      {state && <small role="status">{state}</small>}
      {show && (
        <textarea
          aria-label="整理提示词"
          readOnly
          value={knowledgePrompt}
          onFocus={(e) => e.target.select()}
        />
      )}
    </section>
  );
}
