# 每周更新与兼容性边界

## 实际更新流程

每周一 02:41 UTC（北京时间 10:41，GitHub 排队可能延迟）或手动执行 Upstream Watch：

1. 下载 `upstreams/watch.json` 中的 8 个 GitHub 文件，限制大小、超时与重试；通过 Git blob SHA 校验下载内容。
2. 下载文件仅保存为 14 天 Actions 审查附件，不执行、不拼接进插件、不提交第三方源码。
3. Huibq 使用本地已核对的适配规则：除 `API_URL` 字面量外，完整源码的 SHA-256 必须匹配 `scripts/adapters/huibq.mjs` 中的已审查指纹。只允许 HTTPS、已审查主机 `lxmusicapi.onrender.com` 与简单路径，不允许凭据、端口、查询参数。地址或协议超出规则时保留旧配置，标记 `review-required`。
4. 其余 7 个脚本没有获准自动适配，只更新观测清单，提示人工核对；SHA 变化不代表解析逻辑已被集成。源代码结构、密钥或新域名发生变化也需要人工审查并补测。
5. 无论 SHA 是否变化，都在同一个工作流校验、构建、测试、验证二次构建一致性。
6. 全部通过后，单个提交发布 `upstreams/status.json`、`config/providers.json`、`dist/splayer-source.js` 的实际变化。没有变化时不提交。任何下载失败都不写回状态或 Provider 配置；测试失败不发布。

不承诺自动集成任意 LX 上游。当前自动适配范围是已审查 Huibq 请求协议的允许地址变化；不能自动学习新的鉴权、加密或返回格式。

## 已核对的接口

核对日期：2026-10-13。下载内容 SHA 与 SHA-256 见 `upstreams/status.json`。

| 上游 | 核对结果 | 自动处理 |
| --- | --- | --- |
| Huibq v1.2.0 | LX `on(EVENT_NAMES.request)`，`info.type/musicInfo`；GET `/url/{source}/{hash-or-songmid}/{quality}`，公开 `share-v3`，`code === 0` 返回 `body.url` | 已审查结构内同步允许地址；SPlayer Promise 请求与 `{url, quality}` 返回由现有引擎适配 |
| Juhe | LX 初始化 `/init.conf`；POST 平台路径；直接 URL 与 code 303 下发二次请求 | 仅观测；当前 Provider 保留直接 URL 子集，拒绝二次任意请求；LX 额外 musicInfo 字段不保证宿主提供 |
| iKun | LX 回调请求、平台/音质声明、远程更新检查；code 200 URL | 仅观测；现有手工配置没有获得全脚本自动更新资格 |
| Qdy | 多 Provider LX 调度与独立音质选择 | 仅观测；没有将其调度引擎叠加到当前引擎 |
| Sixyin / Flower / LX / Grass | 混淆或压缩/打包代码；不能凭文本标记证明其完整接口安全兼容 | 仅观测；未执行、未完整反混淆 |

SPlayer-Next 官方文档说明宿主有 LX 兼容层，部分原始脚本可单独导入；这与将多个脚本拼接进本仓库聚合插件不同。本文只保证已测试的适配链路。

参考：[SPlayer-Next 音源插件](https://splayer-next.imsyy.top/plugins/source.html)、[已审查 Huibq blob](https://api.github.com/repos/pdone/lx-music-source/git/blobs/f2028068db448a9e0b738106112eb300bcefbcc2)。

## 版本与发布

- `build.mjs` 比较现有插件内容；引擎或内嵌配置真正变化时，基于现有 `@version` 增加 patch 版本。运行次数和提交 SHA 不再制造新版本。
- 上游清单不再嵌入插件：仅清单变化不会伪装成插件功能更新。
- `BUILD_VERSION` 仅用于明确的手动版本覆盖；常规 Actions 不设置它。没有旧产物时使用 `package.json` 的初始版本。
- 配置继续通过 GitHub JSON 热更新；失败时使用插件内嵌/缓存配置。
- 主分支发布、健康检查与周更共享并发组；普通 push 若遇到外部同时提交会安全失败，不强推、不盲目重基合并生成文件。GitHub 的并发组最多保留一个 pending run，频繁提交可能替换旧的排队任务；最新任务从当前默认分支重新构建。
- 写入任务只允许在默认分支触发，不从 PR 或 fork 发布。PR 校验是只读权限。
- Actions 使用 Node 24 运行时版本，固定到已查询的完整 commit SHA；runner 固定为 Ubuntu 24.04；删除跨工作流 dispatch 和 `actions: write`。写权限只在需要提交的 job 启用，checkout 不保留凭据，推送步骤单独使用 token。
- 自动提交不使用 `[skip ci]`，因此不会跳过人工 PR 检查。GitHub 的 `GITHUB_TOKEN` push 通常不会触发另一轮 workflow，本次发布已经先运行完整验证。
- 仓库限制若禁止机器人推送，会显示明确失败，不绕过保护规则。启用 Actions，并在仓库策略中允许该工作流所需的 contents 写权限。

## 如何发现失败与人工审查项

Actions 的 Summary 和日志显示每个上游的下载/适配结果、待审查原因、提交文件清单。`upstream-audit-<run_id>` 附件包含下载文件与报告，保留 14 天。下载/完整性/验证/推送失败会让任务失败，可使用 GitHub 原生 Actions 失败通知。

`review-required` 使用 warning 明确提示，不被称为已成功集成。其余步骤仍可以安全生成现有插件；不设置邮件或聊天机器人通知，也不创建重复 Issue。

所有现有 Provider 的健康检查均未启用，Health Summary 中 `unknown` 表示未测试，不能等同于可播放。只有提供明确有效的健康 URL 后才开启探测；首页 HTTP 200 不能证明音乐解析可用。

## 验证与回退

无需第三方 npm 依赖。使用 Node 22：

```sh
npm run validate
npm run watch
GITHUB_REPOSITORY=LycheeGuo/musicAPI npm run build
npm test
GITHUB_REPOSITORY=LycheeGuo/musicAPI npm run check:build
npm run health
```

`watch` 需要网络，Actions 传入 `GITHUB_TOKEN` 可提高 GitHub API 配额；本地无需 token 也可以运行。

若上游变更被拒绝：在附件中审查协议、域名、凭据、质量映射和平台 ID；修改本地适配规则与测试，通过 PR 合并，不单纯替换指纹。

回退时恢复上一次通过验证的源文件/配置，然后重新构建，让版本继续递增；不要直接降低 `@version`，否则客户端可能不提示更新。

验证覆盖自动更新逻辑、内容完整性、安全边界、模拟 SPlayer 请求/响应、降级、缓存与跨平台兜底。不等同于已在真实 SPlayer 安装播放，也不保证公共 Provider 当前/未来服务可用。
