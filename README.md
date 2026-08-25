# Unified Music Source — SPlayer + LX Music

一个“单仓库、多 Provider、双播放器 Adapter”的音源聚合框架。

> 默认不内置绕过 VIP、付费墙、登录或访问控制的接口。请只配置你有权使用的公开、自建或官方授权 API。

## 生成两个播放器版本

```text
dist/splayer-source.js   # SPlayer-Next
dist/lx-source.js        # LX Music
```

两个文件共用同一个：

```text
config/providers.json
```

所以新增、删除或调整 Provider 优先级时，只改一份配置，GitHub Actions 会同时构建两个播放器版本。

## 当前聚合音源

按优先级自动回退：

1. `Xinghai Main` — `wy / tx / kg`
2. `Huibq Share v3` — `wy / tx / kg`
3. `Juhe Direct` — `wy / tx / kg`，仅接受直接返回播放 URL 的模式
4. `iKun Public` — `wy`

因此网易最多有 4 路回退，QQ/酷狗最多有 3 路回退。

六音、QDY、Flower、LX、Grass 等上游仍可由 watcher 观察版本变化，但不会自动执行或复制未知/混淆脚本，也不会自动接入需要登录 Cookie、会员/SVIP 或其他访问控制的链路。

## SPlayer 版

安装：

```text
dist/splayer-source.js
```

SPlayer Adapter 使用 `splayer.register / splayer.on / splayer.request`，并支持远程 `providers.json`、熔断、健康降级和 `@updateUrl`。

## LX Music 版

导入：

```text
dist/lx-source.js
```

LX Adapter 使用 `globalThis.lx / EVENT_NAMES.request / EVENT_NAMES.inited`，初始化时直接载入构建时嵌入的 Provider 配置；因此不会因为 GitHub 配置文件暂时不可达而初始化失败。

LX 版也会检查 GitHub 上的 `dist/lx-source.js` 版本，并通过 `updateAlert` 提示更新。

## 已经做好的能力

- 多 Provider 自动回退
- Provider 优先级
- SPlayer 与 LX Music 双 Adapter
- GitHub Actions 一次构建两个插件文件
- Provider 配置统一维护
- SPlayer 健康状态降级与客户端熔断
- SPlayer 远程配置热更新
- LX 初始化 smoke test
- LX Provider 回退 smoke test
- GitHub Actions Provider 健康检查
- GitHub Actions 上游 SHA 观察
- 不执行远端 JS
- 不需要本地 Node 后台
- 不需要云端 resolver
- 构建零第三方 npm 依赖

## 仓库结构

```text
.
├── .github/workflows/
│   ├── validate.yml
│   ├── build.yml
│   ├── health.yml
│   └── upstream-watch.yml
├── config/
│   ├── providers.json
│   ├── runtime.json
│   └── schema.json
├── dist/
│   ├── splayer-source.js
│   └── lx-source.js
├── docs/
├── scripts/
│   └── build.mjs
├── src/
│   ├── plugin-template.js
│   └── lx-template.js
├── tests/
└── upstreams/
```

## 更新模型

修改以下任意内容：

```text
src/**
config/providers.json
scripts/build.mjs
```

Build workflow 会重新生成：

```text
dist/splayer-source.js
dist/lx-source.js
```

版本使用 GitHub Actions run number，例如 `1.0.23`。

## 本地验证（可选）

需要 Node.js 22+：

```bash
npm run validate
npm run build
npm test
```

无 `npm install` 步骤，因为主构建链没有第三方 npm 依赖。
