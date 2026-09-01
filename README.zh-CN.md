<div align="center">

<img src="apps/web/public/icon.svg" width="80" alt="abyss-harness" />

# abyss-harness

</div>

<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md)
</div>

**基于 [Cordis](https://github.com/cordiverse/cordis) 的迷你 Agent Harness —— 一切能力皆插件。**

<p align="center">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/docs-English-blue"></a>
  <a href="README.zh-CN.md"><img alt="简体中文" src="https://img.shields.io/badge/docs-简体中文-red"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white"></a>
  <a href="https://pnpm.io/"><img alt="pnpm" src="https://img.shields.io/badge/pnpm-workspace-f69220?logo=pnpm&logoColor=white"></a>
  <a href="https://github.com/cordiverse/cordis"><img alt="Cordis" src="https://img.shields.io/badge/powered%20by-Cordis-7c3aed"></a>
</p>

*与 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 使用同一套插件框架、同样的组织方式：框架层以 vendor 方式固定在 `vendor/` 目录（重命名为 `@abyss-harness/*`，见 [`vendor/README.md`](vendor/README.md)），所有能力都是 workspace 中的插件包。*

---

## 目录

- [abyss-harness](#abyss-harness)
  - [目录](#目录)
  - [为什么有这个项目](#为什么有这个项目)
  - [特性](#特性)
  - [快速开始](#快速开始)
    - [环境变量](#环境变量)
    - [常用脚本](#常用脚本)
  - [项目结构](#项目结构)
  - [架构](#架构)
  - [一次请求的流转](#一次请求的流转)
  - [上手试试](#上手试试)
  - [注意事项](#注意事项)
  - [许可证](#许可证)
  - [致谢](#致谢)

## 为什么有这个项目

整个应用就是 [`cordis.yml`](cordis.yml) 里的入口列表；[`packages/bundle/base/cordis.patch.yml`](packages/bundle/base/cordis.patch.yml) 以 bundle patch 形式携带完全相同的行。阅读本仓库是一场可读、可运行的架构之旅，能看清：

- 微内核插件框架如何组织一个真实的应用；
- 各服务如何通过**接缝**（service key + 类型化事件）相遇，而不是相互 import 实现；
- 组合如何变成**配置** —— 增删一行配置，就获得/失去一种能力。

## 特性

- 🔌 **微内核架构** —— Cordis 上下文树；加载顺序来自服务依赖（`inject`），与文件位置无关。
- 🧩 **一切皆插件** —— LLM 适配器、工具、审批、持久化、Web 服务、UI：全是 `cordis.yml` 中的条目。
- 🤖 **兼容 OpenAI 接口的 LLM** —— 通过 `OPENAI_BASE_URL` 接入 DeepSeek、Moonshot、OpenRouter、vLLM、Ollama 等。
- 🛠 **内置工具集** —— `read` / `write` / `edit` / glob+grep 搜索 / `bash` / `ask_user_question`。
- 🛡 **沙箱策略 + 审批拦截** —— 策略先行裁决；超出策略的调用升级为浏览器 Allow/Deny 卡片。
- 💾 **日志即事实源** —— 持久化 JSONL 会话日志；重启后会话继续。
- 📊 **Token 计量** —— 每会话的 token/耗时/费用统计实时推送到 UI。
- ⚡ **前端热更新** —— `vite build --watch` + 重建信号；已打开的页面自动刷新。
- 🧠 **上下文压缩** —— 预算驱动；旧工具结果打桩，会话日志绝不改动。

## 快速开始

> 前置要求：Node.js ≥ 20、[pnpm](https://pnpm.io/) ≥ 10。

```sh
git clone <your-fork-url> abyss-harness
cd abyss-harness

pnpm install
pnpm run build:web          # 构建一次浏览器 UI（产物 → web-dist/）

cp .env.example .env        # 填入 OPENAI_API_KEY / OPENAI_BASE_URL / MODEL_NAME
pnpm run dev                # 自动打开 http://127.0.0.1:3080
```

**前端开发**（无需手动构建）：另开一个终端运行 `pnpm run dev:web`
—— 一个 `vite build --watch`，每次源码修改都会重建 `web-dist/`。后端轮询产物
并通过事件下行链路广播重载帧，打开的页面会自动刷新。没有独立的前端开发服
地址：页面始终来自后端源（与 harness 一致）。

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | 是 | 任意 OpenAI 兼容 API Key |
| `OPENAI_BASE_URL` | 是 | 服务端点根地址 —— DeepSeek、Moonshot、OpenRouter、vLLM、Ollama 等 |
| `MODEL_NAME` | 是 | 由所选服务商解释的模型 ID |
| `DEMO_PORT` | 否（默认 `3080`） | Web UI 端口 |

### 常用脚本

| 脚本 | 说明 |
|---|---|
| `pnpm run dev` | 用 tsx 启动整棵服务树，打开浏览器 |
| `pnpm run dev:web` | 监听重建前端到 `web-dist/` |
| `pnpm run build:web` | 一次性前端构建 |
| `pnpm test` | 运行 vitest 测试 |
| `pnpm run typecheck` | 类型检查 vendor（宽松）+ 产品代码（严格）+ web |

## 项目结构

```
vendor/                    框架层，自有且版本固定（@abyss-harness scope）
  cordis/ loader/ include/ hmr/ timer/ group/ logger-console/ cosmokit/ schemastery/
packages/
  core/       session · system-prompt · tools · agent-loop · compaction（上下文预算）
  llm/        llm（适配器接缝）· openai（OpenAI 兼容适配器）· llm-retry
  fs/         tool-read-file · tool-write-file · tool-str-replace-editor · tool-fs-search（glob/grep）
  shell/      tool-bash
  sandbox/    sandbox · sandbox-policy（作用于 ctx.sandboxPolicy 的文件效果策略）
  policy/     approval-service（接缝）· approval-policy · tool-ask-user · tool-result-limiter
  persistence/session-persistence-jsonl
  observe/    tool-observer · token-meter
  host/       webserver · web-api · frontend-static
  client/     connection（浏览器线路客户端）· ui-renderer · ui-layout · ui-sidebar
              ui-conversation · ui-tool（toolviews）· ui-primitives · ui-theme
  boot/       app-boot（.env 加载、启动序列、浏览器交接）
  bundle/base/cordis.patch.yml —— 分发单元
apps/
  cli/        可执行入口：启动整棵树，打开浏览器
  web/        套在 client 包之上的薄 Vite 壳（构建到 web-dist/）
```

## 架构

```
cordis.yml  ──就是应用本身──▶  上下文树
                                    │
   ┌────────────────────────────────┼────────────────────────────────┐
   │ 挂在 ctx 上的服务               │ 服务之间的事件                  │
   ├ ctx.llm        适配器接缝      ├ llm/stream        瀑布         │
   ├ ctx.session     只追加日志      ├ session/event     emit         │
   ├ ctx.systemPrompt 分段系统提示   ├ tools/pre-execute 瀑布         │
   ├ ctx.tools       工具管线        ├ tools/execute      瀑布        │
   ├ ctx.webServer   HTTP 载体       ├ tools/post-execute 瀑布        │
   ├ ctx.approval    人工闸门        ├ approval/request   emit        │
   └ ctx.agentLoop   驱动器          └ approval/settled   emit        │
```

回合流程（`@abyss-harness/agent-loop`）：一个**回合（turn）** = 零或多个**步（step）**；一步 = 一次模型请求 + 其工具调用。每次请求前都从会话日志重新推导历史（"模型可见即已落日志"）。

没有任何插件 import 另一个插件的实现 —— 它们通过 `inject` 声明的 service key（`ctx.llm`、`ctx.tools`、...）与类型化事件相遇。跨包引用使用 `@abyss-harness/*` 名称：类型期由 tsconfig `paths` 解析，运行期由 pnpm workspace 链接解析。

## 一次请求的流转

1. 浏览器 POST `/api/send {text}` → `agentLoop.run()` 在后台启动。
2. 每一条持久事实都落入会话日志，并以 `session/event` 广播。
3. API 插件通过**纯下行** WebSocket 把事件中继给浏览器。
4. 当模型调用 `write`、`edit` 或 `bash` 时，审批策略拦截 `tools/pre-execute`：沙箱策略先行裁决（合规调用自动放行并记录为持久 `tool/policy` 事件；策略直接拒绝的调用附带原因被拒绝），超出策略的调用（如 workspace-write 下写到工作区之外）经 `approval/request` 升级为浏览器的 Allow/Deny 卡片。拒绝是一次瀑布否决。
5. 页面加载时请求 `/api/state`（完整日志快照），之后用同一个纯 fold 折叠实时事件。

## 上手试试

1. **瀑布否决** —— 让模型写一个文件，点击 **拒绝**。拒绝作为工具结果流回，循环继续。
2. **前端开发闭环** —— 同时跑 `pnpm run dev` + `pnpm run dev:web`，编辑 `packages/client/ui-conversation/src/index.tsx`：产物重建，已打开的页面自动刷新。
3. **依赖驱动的加载** —— 注释掉 `cordis.yml` 中的 `session` 条目：`agent-loop` 会永远静默停留在 PENDING。
4. **组合即配置** —— 删掉 `tool-bash` 条目：不改一行代码，模型就失去了 shell。
5. **日志即事实源** —— 聊天、停止、再次启动：对话从 `.sessions/session.jsonl` 继续。

## 注意事项

- 开发脚本里的 `--expose-internals` 是 `hmr` 插件所需。宿主插件 HMR **默认关闭**（与 harness 的 web profile 一致）：chokidar 的递归 `fs.watch` 在这台 Windows 主机上会淹没事件循环（~150% 核心空转，请求延迟涨到 ~15s）。关闭后，编辑 `packages/*` 或 `cordis.yml` 需要重启 `pnpm dev`；前端开发闭环不受影响（它通过重建信号重载）。将 `hmr` 条目的 `disabled` 设为 `false` 可以在该代价下重新启用。
- 宿主侧零构建：各包的 `main` 字段直接指向 TypeScript 源码，由 tsx 执行。唯一的构建步骤是前端（`vite build` → `web-dist/`）。
- vendor 源码以宽松的严格性标志编译（[`tsconfig.vendor.json`](tsconfig.vendor.json)）；产品包通过 `paths` 对其做严格类型检查（[`tsconfig.json`](tsconfig.json)）。
- 审批服务独立成包，是为了让消费者依赖一个接缝而不是策略插件本身 —— 把它挂进消费者内部会在自注入上死锁。
- 本演示**没有内置沙箱执行后端**（harness 的 landlock/bwrap/seatbelt/Windows-ACL provider 未移植），因此受限模式会"失败即关"—— 每次 bash 调用都以 `SANDBOX_UNAVAILABLE` 报错。默认以 `danger-full-access` 运行；挂载 `SandboxProvider` 后端插件即可切换到受限模式。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

## 致谢

- [Cordis](https://github.com/cordiverse/cordis) —— 插件微内核框架。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— 本演示所镜像的架构蓝图。