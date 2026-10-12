# 架构

## 目标

- SPlayer 只安装一个 `dist/splayer-source.js`
- 只支持 SPlayer 当前实际播放链中的 `wy / tx / kg`
- 多 Provider 顺序回退
- GitHub 上的 `config/providers.json` 可热更新，不要求每次都升级插件
- GitHub Actions 下载并校验上游，仅在已审查 Huibq 协议范围内同步地址；未知脚本只观测，不执行或拼接
- 插件代码变更后，`dist/splayer-source.js` 自动生成新版本，SPlayer 用 `@updateUrl` 检查更新

## 两层更新

### 1. 配置热更新

SPlayer 插件会定期读取：

- `config/providers.json`
- `config/runtime.json`

修改 Provider 地址、优先级、启用状态时，不需要更新插件。

### 2. 插件引擎更新

修改 `src/plugin-template.js` 后，Build workflow 自动：

1. 校验
2. 构建
3. 测试
4. 生成 `dist/splayer-source.js`
5. 实际内容变化时从现有版本递增 patch，重复构建保持版本不变
6. 自动 commit

SPlayer 会从固定的 `raw.githubusercontent.com/.../dist/splayer-source.js` 检查新版。

## 回退顺序

排序分数：

`priority + GitHub 健康状态惩罚 + 本地熔断惩罚`

因此健康 Provider 优先，连续失败 Provider 会临时熔断。

## 安全边界

远程配置只允许 JSON 数据，不支持从 GitHub 下载并 `eval`/执行远端 JS。

每周自动更新流程、接口边界与失败处理见 [AUTO_UPDATE.md](AUTO_UPDATE.md)。
