# 撤销/重做方案重构

## 背景

当前撤销（revert/undo）机制依赖 git snapshot 系统：

1. AI 工具执行前，`snap.track()` 将整个 worktree 状态写入隐藏 git 仓库的 tree
2. 工具执行后，`snapshot.patch(hash)` 通过 `git diff --cached` 计算变更文件列表
3. 撤销时，`snap.revert(patches)` 对每个文件执行 `git checkout <hash> -- <file>`
4. 文件在旧快照中不存在时，**直接删除**

## 已修复的问题

已删除 snapshot revert 中的文件删除逻辑（`snapshot/index.ts:440-441, 515-516`），改为跳过。

## 遗留问题

当前方案的根本缺陷：

### 1. 外部变更污染

`git add --all` 扫描整个 worktree，Unity 编辑器、用户手动修改等**外部进程的变更**也会被纳入 patch。撤销时会把这些变更一起回退。

### 2. tracked 文件不可靠

即使文件已被 git tracked，snapshot 内部的 `ignore()` 使用了 `git check-ignore --no-index`（忽略 index 状态），可能导致 tracked 文件被误判为 gitignore 并从 snapshot index 中 drop，最终在撤销时被删除。

### 3. bash 等工具不可回退

bash 工具可能修改无数文件，无法从工具调用本身推断变更范围。当前 snapshot 方案兜底记录所有变更，但代价是精度不够。

## 目标方案

放弃 git checkout 方式，改为**遍历聊天记录中的实际工具调用，做反向操作**：

### 可反向的工具

| 工具 | 反向方式 | 难度 |
|------|----------|------|
| `edit` | 用 oldString 替换 newString | 低 |
| `write` | 需要保存写之前的文件内容 | 中 |
| `apply_patch` | 反向 apply diff | 低 |

### 需要设计的

1. **write 工具**：当前没有保存"写之前的内容"
   - 选项 A：在 write 执行前读取原文件内容，存到 message part 的 metadata 中
   - 选项 B：仍然依赖 git snapshot 来获取 write 之前的文件内容
2. **bash 工具**：无法从工具调用推断改了什么文件
   - 选项 A：跳过 bash 的回退（不完美但安全）
   - 选项 B：仍然用 snapshot 来记录 bash 的变更，但回退时只处理 snapshot 记录的变更
3. **多个工具叠加**：edit Bash edit 三次操作，回退时需要按逆序操作
4. **文件被后续工具再次修改**：回退 edit1 时需要确保文件没有被 edit2 覆盖

### 关联文件

- `packages/opencode/src/session/revert.ts` — SessionRevert 入口
- `packages/opencode/src/snapshot/index.ts` — 快照系统（可能需要保留部分功能）
- `packages/opencode/src/session/processor.ts:731-740,848-857` — patch part 的存储位置
- `packages/core/src/tool/edit.ts` — edit 工具定义
- `packages/core/src/tool/write.ts` — write 工具定义
