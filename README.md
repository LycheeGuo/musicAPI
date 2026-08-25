# Unified Music Source — SPlayer

一个面向 SPlayer-Next 的“单插件、多 Provider、高质量优先、自动回退”音源聚合框架。

> 默认不内置绕过 VIP、付费墙、登录或访问控制的接口。只接入公开、自建或明确授权的 API；不自动执行未知/混淆远端脚本。

## 只需要一个文件

```text
dist/splayer-source.js
```

插件注册 SPlayer 当前播放链使用的：

- `wy` — 网易
- `tx` — QQ
- `kg` — 酷狗

## 当前启用的 Provider

按基础优先级排列，运行时会结合成功率、延迟、熔断和健康状态动态调整：

1. `Xinghai Main` — `wy / tx / kg`
2. `Huibq Share v3` — `wy / tx / kg`
3. `Juhe Direct` — `wy / tx / kg`
4. `Lingchuan Public` — `wy / tx / kg`
5. `Xinlan Public` — `wy / tx / kg`
6. `iKun Public` — `wy`

因此：

- 网易最多有 6 路 Provider
- QQ 最多有 5 路 Provider
- 酷狗最多有 5 路 Provider

## 音质策略

目标不是“必须无损”，而是“在有限时间内尽可能拿到当前可用的最高质量”。

例如 SPlayer 请求无损：

```text
lossless
  ↓ 当前 Provider 不支持/失败
hq (通常 320k)
  ↓ 失败
sq
  ↓ 失败
lq
```

每个 Provider 会按自己声明的能力跳过不支持或重复映射的音质，因此不会把同一个 320k 接口重复请求多次。

## v2 核心能力

- 6 路 Provider 自动回退
- 高音质优先，失败自动降级
- Provider 能力声明（不同源支持不同最高音质）
- URL 短期缓存，重复播放减少解析请求
- 同一首歌同时请求自动去重
- 最近成功率与延迟参与 Provider 动态排序
- 连续失败熔断与冷却
- GitHub `runtime.json` 健康状态降级
- 总解析时间预算，避免无限等待
- 远程 `providers.json` 热更新
- 构建时嵌入配置，GitHub 暂时不可达仍可工作
- `@updateUrl` 原生 SPlayer 更新
- GitHub Actions 自动构建和测试
- 上游版本 SHA 观察
- 不需要本地 Node 后台
- 不需要云端 resolver

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
│   └── splayer-source.js
├── docs/
├── scripts/
│   └── build.mjs
├── src/
│   └── plugin-template.js
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
```

版本使用 GitHub Actions run number，例如 `1.0.23`。SPlayer 根据固定 `@updateUrl` 检查新版。

## 本地验证（可选）

需要 Node.js 22+：

```bash
npm run validate
npm run build
npm test
```

主构建链没有第三方 npm 依赖。
