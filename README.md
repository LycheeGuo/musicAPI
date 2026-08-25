# SPlayer Unified Music Source — Ultimate

一个面向 SPlayer-Next 的长期维护型“单插件、多 Provider”音源框架。

> 默认不内置绕过 VIP、付费墙、登录或访问控制的接口。请只配置你有权使用的公开、自建或官方授权 API。

## 你最终只需要安装一个文件

```text
dist/splayer-source.js
```

它注册 SPlayer 当前播放链使用的：

- `wy`
- `tx`
- `kg`

## 已经做好的能力

- 多 Provider 自动回退
- Provider 优先级
- GitHub 健康状态降级
- 客户端连续失败熔断
- 18 秒总预算，避免超过 SPlayer `musicUrl` 默认调用时间
- 远程 `providers.json` 热更新
- 内嵌最后一次构建配置作为 GitHub 不可达时的 fallback
- `@updateUrl` 原生 SPlayer 更新
- GitHub Actions 自动构建
- GitHub Actions Provider 健康检查
- GitHub Actions 上游 SHA 观察
- 不执行远端 JS
- 不需要本地 Node 后台
- Actions/构建零第三方 npm 依赖

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
│   ├── ADD_PROVIDER.md
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   └── SETUP_MAC.md
├── scripts/
├── src/
│   └── plugin-template.js
├── tests/
└── upstreams/
```

## 第一次使用

请直接看：

`docs/SETUP_MAC.md`

## 为什么不直接合并第三方 LX 脚本

第三方脚本常包含混淆代码、动态执行、不同运行时 API、未知更新逻辑，直接自动拼接既脆弱也不安全。

本项目采用：

```text
第三方/自建/官方授权 API
          ↓
统一 JSON Provider 配置
          ↓
统一 SPlayer Adapter
          ↓
fallback / health / circuit breaker
          ↓
SPlayer
```

GitHub workflow 可观察上游仓库版本变化，但不会自动执行未知脚本。

## 更新模型

### Provider 配置

`config/providers.json` 可直接修改；SPlayer 插件会定时读取最新版。

### 插件引擎

修改 `src/plugin-template.js` 后，Build workflow 自动生成：

`dist/splayer-source.js`

版本使用 GitHub Actions run number，例如：

`1.0.23`

SPlayer 通过 `@updateUrl` 自动检查更新。

## 本地验证（可选）

需要 Node.js 22+：

```bash
npm run validate
npm run build
npm test
```

无 `npm install` 步骤，因为没有第三方 npm 依赖。
