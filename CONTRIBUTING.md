# 参与 OpenCode 贡献

我们希望让您轻松地为 OpenCode 做出贡献。以下是最常见的、会被合并的变更类型：

- Bug 修复
- 新增 LSP / 格式化工具支持
- 改进 LLM 性能
- 支持新的提供商
- 修复特定环境的兼容性问题
- 补充缺失的标准行为
- 文档改进

然而，任何 UI 或核心产品功能在实现之前，都必须经过核心团队的设计审核。

如果不确定某个 PR 是否会被接受，请随时询问维护者，或查看带有以下标签的 Issue：

- [`help wanted`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Ahelp-wanted)
- [`good first issue`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22)
- [`bug`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug)
- [`perf`](https://github.com/anomalyco/opencode/issues?q=is%3Aopen%20is%3Aissue%20label%3A%22perf%22)

> [!NOTE]
> 忽视上述规则的 PR 可能会被直接关闭。

想认领一个 Issue？请留言，维护者可能会将其分配给您——除非该 Issue 是我们已经在处理的事项。

## 添加新的提供商

新的提供商通常不需要任何（甚至几乎不需要）代码改动。如果您想添加对新提供商的支持，请先向以下仓库提交 PR：
https://github.com/anomalyco/models.dev

## 开发 OpenCode

- **环境要求**：Bun 1.3+
- 从仓库根目录安装依赖并启动开发服务器：

  ```bash
  bun install
  bun dev
  ```

### 针对其他目录运行

默认情况下，`bun dev` 在 `packages/opencode` 目录下运行 OpenCode。要针对其他目录或仓库运行：

```bash
bun dev <目录路径>
```

在 opencode 仓库自身的根目录下运行：

```bash
bun dev .
```

### 构建本地可执行文件

编译独立可执行文件：

```bash
./packages/opencode/script/build.ts --single
```

然后运行：

```bash
./packages/opencode/dist/opencode-<平台>/bin/opencode
```

将 `<平台>` 替换为您的平台（例如 `darwin-arm64`、`linux-x64`）。

- 核心模块：
  - `packages/opencode`：OpenCode 核心业务逻辑与服务器
  - `packages/opencode/src/cli/cmd/tui/`：TUI 代码，使用 SolidJS + [opentui](https://github.com/sst/opentui) 构建
  - `packages/app`：共享的 Web UI 组件，使用 SolidJS 构建
  - `packages/desktop`：原生桌面应用，基于 Electron（封装了 `packages/app`）
  - `packages/plugin`：`@opencode-ai/plugin` 源码

### 理解 bun dev 与 opencode 的区别

开发时，`bun dev` 相当于构建后的 `opencode` 命令。两者使用相同的 CLI 接口：

```bash
# 开发环境（从项目根目录）
bun dev --help           # 显示所有可用命令
bun dev serve            # 启动无头 API 服务器
bun dev web              # 启动服务器并打开 Web 界面
bun dev <目录路径>       # 在指定目录启动 TUI

# 生产环境
opencode --help          # 显示所有可用命令
opencode serve           # 启动无头 API 服务器
opencode web             # 启动服务器并打开 Web 界面
opencode <目录路径>      # 在指定目录启动 TUI
```

### 运行 API 服务器

启动 OpenCode 无头 API 服务器：

```bash
bun dev serve
```

默认在 4096 端口启动。可以指定其他端口：

```bash
bun dev serve --port 8080
```

### 运行 Web 应用

在开发过程中测试 UI 变更：

1. **首先启动 OpenCode 服务器**（见上文[运行 API 服务器](#运行-api-服务器)章节）
2. **然后运行 Web 应用：**

```bash
bun run --cwd packages/app dev
```

这将在 http://localhost:5173（或类似端口，以实际输出为准）启动本地开发服务器。大多数 UI 变更都可以在此处测试，但服务器必须处于运行状态才能实现完整功能。

### 运行桌面应用

桌面应用是封装了 Web UI 的 Electron 应用。

开发模式下运行桌面应用：

```bash
bun run --cwd packages/desktop dev
```

创建生产构建并打包应用：

```bash
bun run --cwd packages/desktop build
bun run --cwd packages/desktop package
```

> [!NOTE]
> 如果您对 API 或 SDK 做了改动（例如 `packages/opencode/src/server/server.ts`），请运行 `./script/generate.ts` 以重新生成 SDK 及相关文件。

请尽量遵循[风格指南](./AGENTS.md)。

### 配置调试器

Bun 的调试功能目前还不太完善。希望本指南能帮助您顺利配置并避开一些常见问题。

调试 OpenCode 最可靠的方式是通过 `bun run --inspect=<url> dev ...` 在终端中手动运行，然后通过该 URL 附加调试器。其他方法可能导致断点映射不正确，至少在 VSCode 中是这样的（具体因环境而异）。

注意事项：

- 如果您想运行 OpenCode TUI 并希望在服务器代码中触发断点，可能需要使用 `bun dev spawn` 而不是通常的 `bun dev`。这是因为 `bun dev` 在工作线程中运行服务器，断点可能无法正常工作。
- 如果 `spawn` 对您不适用，可以单独调试服务器：
  - 调试服务器：`bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve --port 4096`，然后用 `opencode attach http://localhost:4096` 附加 TUI
  - 调试 TUI：`bun run --inspect=ws://localhost:6499/ --cwd packages/opencode --conditions=browser ./src/index.ts`

其他提示与技巧：

- 根据您的工作流程，可能需要使用 `--inspect-wait` 或 `--inspect-brk` 代替 `--inspect`
- 每次都要指定 `--inspect=ws://localhost:6499/` 可能很麻烦，可以 `export BUN_OPTIONS=--inspect=ws://localhost:6499/` 来简化

#### VSCode 配置

如果您使用 VSCode，可以使用我们的示例配置文件 [.vscode/settings.example.json](.vscode/settings.example.json) 和 [.vscode/launch.example.json](.vscode/launch.example.json)。

一些可能有问题的调试方式：

- 使用 `"request": "launch"` 的调试配置可能导致断点映射错误，从而无法使用
- 在 VSCode 的 `JavaScript Debug Terminal` 中运行 OpenCode 时也有同样的问题

尽管如此，您仍然可以尝试这些方法，因为它们在某些环境下可能有效。

## Pull Request 要求

### 先提 Issue

**所有 PR 必须关联一个已有的 Issue。** 在提交 PR 之前，请先创建一个 Issue 描述 bug 或功能需求。这有助于维护者进行分类并避免重复工作。未关联 Issue 的 PR 可能未经审核就被关闭。

- 在 PR 描述中使用 `Fixes #123` 或 `Closes #123` 来关联 Issue
- 对于小型修复，简要说明即可——只需提供足够的上下文让维护者理解问题

### 通用要求

- 保持 PR 小而精
- 解释问题所在以及您的改动为何能修复它
- 在添加新功能之前，请确认代码库中尚未存在相同的功能

### UI 变更

如果 PR 包含 UI 变更，请附上改造前后的截图或视频。这有助于维护者更快地审核，也能让您更快获得反馈。

### 逻辑变更

对于非 UI 的变更（bug 修复、新功能、重构），请说明**您是如何验证其正确性的**：

- 您测试了什么？
- 审核者如何复现或确认修复？

### 禁止 AI 生成的长篇大论

过长的 AI 生成的 PR 描述和 Issue 是不可接受的，可能会被忽略。请尊重维护者的时间：

- 撰写简短、精准的描述
- 用自己的话说明改了什么以及为什么
- 如果您无法简要说明，说明 PR 可能过于庞大

### PR 标题

PR 标题应遵循约定式提交标准：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档或 README 变更
- `chore:` 维护任务、依赖更新等
- `refactor:` 代码重构，不改变行为
- `test:` 新增或更新测试

可以添加作用域来指明受影响的包：

- `feat(app):` app 包的功能
- `fix(desktop):` desktop 包的 bug 修复
- `chore(opencode):` opencode 包的维护

示例：

- `docs: update contributing guidelines`
- `fix: resolve crash on startup`
- `feat: add dark mode support`
- `feat(app): add dark mode support`
- `fix(desktop): resolve crash on startup`
- `chore: bump dependency versions`

### 代码风格偏好

以下并非强制要求，仅供参考：

- **函数**：除非拆分能带来明确的复用性或组合优势，否则尽量将逻辑保持在一个函数内
- **解构赋值**：不要对变量进行不必要的解构
- **控制流**：避免使用 `else`
- **错误处理**：尽量使用 `.catch(...)` 而非 `try`/`catch`
- **类型**：使用精确的类型，避免 `any`
- **变量**：坚持使用不可变模式，避免 `let`
- **命名**：选择简洁的单词标识符，同时保持描述性
- **运行时 API**：在合适的情况下使用 Bun 的辅助方法，如 `Bun.file()`

## 功能请求

对于全新的功能，请先进行设计讨论。创建一个 Issue 描述问题、您提出的方案（可选）以及为何它属于 OpenCode。核心团队将帮助决定是否推进；请等待批准后再直接提交功能 PR，不要跳过这一步骤。

## 信任与担保系统

本项目使用 [vouch](https://github.com/mitchellh/vouch) 管理贡献者信任度。担保名单维护在 [`.github/VOUCHED.td`](.github/VOUCHED.td)。

### 工作方式

- **已担保用户**是明确信任的贡献者
- **被拒绝用户**被明确屏蔽。来自被拒绝用户的 Issue 和 PR 将自动关闭。如果您被拒绝，可以在 [Discord](https://opencode.ai/discord) 上联系维护者请求解除
- **其他所有人**都可以正常参与——您不需要被担保也能提交 Issue 或 PR

### 维护者操作

具有写入权限的协作者可以在任意 Issue 下通过评论管理担保名单：

- `vouch` — 为 Issue 作者担保
- `vouch @username` — 为指定用户担保
- `denounce` — 拒绝 Issue 作者
- `denounce @username` — 拒绝指定用户
- `denounce @username <reason>` — 附带原因拒绝
- `unvouch` / `unvouch @username` — 从名单中移除

变更会自动提交到 `.github/VOUCHED.td`。

### 拒绝政策

拒绝仅适用于那些反复提交低质量 AI 生成贡献、发送垃圾信息或以其他方式恶意行为的用户。不适用于意见分歧或无意的错误。

## Issue 要求

所有 Issue **必须**使用我们的 Issue 模板之一：

- **Bug 报告**——用于报告 bug（需要描述）
- **功能请求**——用于建议增强（需要确认复选框和描述）
- **问题**——用于提问（需要问题内容）

不允许空白 Issue。当新 Issue 被创建时，自动化检查会验证其是否符合模板并满足贡献指南要求。如果 Issue 不符合要求，您将收到一条评论说明需要修复的内容，并有 **2 小时**时间编辑 Issue。之后将被自动关闭。

Issue 可能因以下原因被标记：

- 未使用模板
- 必填字段为空或填写了占位符内容
- AI 生成的长篇大论
- 缺少有意义的内容

如果您认为 Issue 被错误标记，请告知维护者。
