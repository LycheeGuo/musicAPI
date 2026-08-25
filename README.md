# Unified Music Source — SPlayer

一个面向 SPlayer-Next 的“单插件、多 Provider、高质量优先、自动回退”音源聚合框架。

> 默认不内置绕过 VIP、付费墙、登录或访问控制的接口。只接入公开、自建或明确授权的 API；不自动执行未知/混淆远端脚本。

## 只需要一个文件

```text
dist/splayer-source.js
```

SPlayer 当前真正会调用 `musicUrl` 的 source key 只有：

- `wy` — 网易
- `tx` — QQ
- `kg` — 酷狗

因此插件管理里不会把酷我 `kw`、咪咕 `mg` 伪装成可播放的 SPlayer 平台。它们只在插件内部作为最后一层跨平台兜底使用。

## 当前启用的主 Provider

按基础优先级排列，运行时会结合成功率、延迟、熔断和健康状态动态调整：

1. `Xinghai Main` — `wy / tx / kg`
2. `Huibq Share v3` — `wy / tx / kg`
3. `Juhe Direct` — `wy / tx / kg`
4. `Lingchuan Public` — `wy / tx / kg`
5. `Xinlan Public` — `wy / tx / kg`
6. `iKun Public` — `wy`

因此同平台 ID 解析阶段：

- 网易最多有 6 路 Provider
- QQ 最多有 5 路 Provider
- 酷狗最多有 5 路 Provider

## 酷我 / 咪咕跨平台智能兜底

如果同平台 Provider 全部失败，并且歌曲信息里有歌名，插件会保留一部分总超时预算，进入第二阶段：

```text
原平台 wy / tx / kg
  ↓ 主 Provider 全失败
酷我 kw + 咪咕 mg 并行搜索
  ↓
歌名 + 歌手 + 时长匹配
  ↓
匹配分数达标才继续
  ↓
聆川 / 新澜 / iKun（按各自公开能力）解析目标平台 ID
  ↓
咪咕若解析器仍失败，可使用搜索结果里公开返回的直接播放地址作为最后兜底
```

匹配策略会校验歌名、歌手与时长；当双方都有时长且相差超过 20 秒时直接排除，并对 `Live / 现场 / 翻唱 / Cover / 伴奏 / Remix / DJ` 等非原版候选降分，降低误匹配风险。

目前内部跨平台能力：

- 酷我 `kw`：聆川、新澜、iKun 可作为解析器
- 咪咕 `mg`：聆川、新澜可作为解析器；公开搜索结果直链只作为最终低优先级兜底

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

每个 Provider 会按自己声明的能力跳过不支持或重复映射的音质，因此不会把同一个 320k 接口重复请求多次。跨平台阶段同样遵守请求音质上限与自动降级策略。

## 核心能力

- 6 路主 Provider 自动回退
- 酷我 / 咪咕跨平台搜索兜底
- 歌名 + 歌手 + 时长智能匹配
- 非原版候选自动降分
- 高音质优先，失败自动降级
- Provider 能力声明（不同源支持不同最高音质）
- URL 短期缓存，重复播放减少解析请求
- 同一首歌同时请求自动去重
- 最近成功率与延迟参与 Provider 动态排序
- 连续失败熔断与冷却
- GitHub `runtime.json` 健康状态降级
- 总解析时间预算，并为跨平台阶段预留时间
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
