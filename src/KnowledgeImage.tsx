import { useState } from "react";
export default function KnowledgeImage({
  src,
  alt,
}: {
  src?: string;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (/^\/api\/assets\/[a-f0-9]{64}$/.test(src || ""))
    return failed ? (
      <span role="status">[图片缺失：{alt || "请重新导入含图片的迁移包"}]</span>
    ) : (
      <img
        src={src}
        alt={alt || "知识点图片"}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ maxWidth: "100%", height: "auto", borderRadius: 6 }}
      />
    );
  return (
    <a href={src} target="_blank" rel="noreferrer">
      [图片：{alt || "查看图片"}]
    </a>
  );
}
