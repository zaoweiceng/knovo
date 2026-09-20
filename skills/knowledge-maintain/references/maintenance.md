# 增量维护脚本

所有路径以 root 为基准，不允许隐藏目录、绝对路径、越界或符号链接。隐藏工作目录为 `<root>/.knowledge`，与网站一致。

## scan

`node <runtime>/scripts/knowledge.mjs scan --root <root> [--files '["a.md"]']`

首次建立 baseline，返回零增量（除非指定 files）。后续返回最多 20 项：path、kind（added/modified/deleted）、hash、元信息、最多 10 个候选；remaining 是未处理数量。扫描不会把后续增量标记成功。

## apply

`node <runtime>/scripts/knowledge.mjs apply --root <root> --manifest <JSON 文件>`

```json
{
  "operations": [
    {"path": "a.md", "expected_hash": "读取时的 sha256", "content": "完整的新 Markdown"},
    {"path": "new.md", "expected_hash": null, "content": "完整的新 Markdown"},
    {"path": "duplicate.md", "expected_hash": "读取时的 sha256", "content": null}
  ],
  "processed": [
    {"path": "a.md", "expected_hash": "读取时的 sha256"}
  ],
  "report": {
    "summary": "本次变化的简述",
    "corrections": [],
    "unverified": []
  }
}
```

content=null 归档删除；expected_hash=null 表示文件原来不存在。processed 是本次成功检查的增量项，最多 20 个；其 hash 同样是执行前值。operations 可以包含为了这些增量需要变更的候选及新建文件，最多 240 项；不是全库写入许可。未解决的问题可以通过正文标记后视为已处理，但格式错误或执行失败不能假装成功。

先校验全部输入和最终身份，再备份到 `.knowledge/batches/<batch>/` 并写 journal，最后逐文件原子替换和更新本批缓存。进程中断时 journal 为 pending/interrupted；不能自行删除备份。

## restore / unlock

`node <runtime>/scripts/knowledge.mjs restore --root <root> --batch <batch>`

恢复前验证当前文件匹配该批次之前或之后的指纹，不覆盖第三方变更。恢复仅影响本批路径及其缓存，不倒退其他批次。网站随后同步并还原合并身份；合并之后新发生的复习记录仍保留。

`node <runtime>/scripts/knowledge.mjs unlock --root <root>` 只解除死亡进程遗留的写锁。若 PID 仍存在则拒绝，不猜测锁是否过期。
