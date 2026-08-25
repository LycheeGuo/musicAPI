# Mac 小白部署流程

## 1. 在 GitHub 新建仓库

建议名字：

`splayer-music-source`

选择 **Public**。

## 2. 上传本项目全部文件

必须保持目录结构，尤其：

- `.github/workflows/`
- `src/`
- `config/`
- `scripts/`
- `dist/`

## 3. 运行 Build workflow

GitHub 仓库：

`Actions -> Build SPlayer Plugin -> Run workflow`

成功后，`dist/splayer-source.js` 会被自动重建。

如果最后 `git push` 报 403：

`Settings -> Actions -> General -> Workflow permissions -> Read and write permissions`

然后重新运行。

## 4. 配置你有权使用的 Provider

编辑：

`config/providers.json`

然后：

- 把 `enabled` 改成 `true`
- 填写你的 API 地址
- 设置返回 URL 的 `urlPath`
- 如有 health endpoint，再启用 `healthcheck`

不要把私密 Token/Cookie 放进公开仓库。

## 5. 导入 SPlayer

下载你仓库中的：

`dist/splayer-source.js`

SPlayer：

`设置 -> 插件管理 -> 本地导入`

导入后启用。

## 6. 以后更新

插件代码更新：

- GitHub Actions 生成新 `dist`
- SPlayer 启动时检查 `@updateUrl`
- 插件卡片显示“有更新”
- 你点击“更新”

Provider 配置更新：

- 直接改 `config/providers.json`
- 插件会自动刷新配置
- 不需要重新导入 JS
