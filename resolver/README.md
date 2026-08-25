# Koyeb Cloud YouTube Resolver

这个目录提供一个给 SPlayer 使用的云端 YouTube fallback resolver。它不依赖 Piped / Invidious，也不要求 Mac 本地常驻服务。

仅用于公开可播放内容；不处理登录、付费、年龄或地区限制的内容。

## 架构

```text
SPlayer
  -> Xinghai
  -> Huibq
  -> Koyeb /resolve
       -> YouTube.js 搜索和匹配
       -> Koyeb /stream/:videoId
            -> YouTube audio stream
```

`/stream` 由 Koyeb 转发媒体流并保留 `Range` / `206 Partial Content`，避免把容易因出口 IP 不一致而 403 的临时 Google 媒体地址直接交给客户端。

## Koyeb 免费版部署

1. 登录 Koyeb，选择 **Create Web Service**。
2. Deployment method 选择 **GitHub**，安装 Koyeb GitHub App。
3. 允许 Koyeb 访问仓库 `LycheeGuo/musicAPI`。
4. Repository 选择 `LycheeGuo/musicAPI`。
5. Branch 选择 `main`（本分支验证期间也可以临时选 `koyeb-cloud-resolver`）。
6. Builder 选择 **Dockerfile**。
7. **Work directory** 填：

   ```text
   resolver
   ```

8. **Dockerfile location** 填：

   ```text
   Dockerfile
   ```

9. Service type 选择 **Web Service**。
10. Instance 选择 **Free**。
11. Region 选择免费实例当前支持的区域之一，例如 Frankfurt 或 Washington, D.C.。
12. Exposed port 填：

   ```text
   8000
   ```

   Protocol 选择 HTTP，route 为 `/`。

13. Environment variables 可先保持默认。可选参数：

   | 变量 | 默认值 | 作用 |
   | --- | ---: | --- |
   | `PORT` | `8000` | HTTP 监听端口 |
   | `MIN_MATCH_SCORE` | `45` | YouTube 候选最低匹配分 |
   | `MATCH_CACHE_MS` | `21600000` | 歌曲匹配缓存 6 小时 |
   | `RESOLVE_LIMIT_PER_MINUTE` | `30` | 单 IP 每分钟解析次数 |
   | `STREAM_LIMIT_PER_MINUTE` | `180` | 单 IP 每分钟媒体请求次数 |

14. 点击 **Deploy**。

免费实例空闲一段时间后会休眠，所以第一次播放可能有几秒冷启动。

## 部署后测试

假设 Koyeb 给出的域名是：

```text
https://musicapi-xxxx.koyeb.app
```

先浏览器访问：

```text
https://musicapi-xxxx.koyeb.app/health
```

应返回：

```json
{"ok":true,"service":"splayer-koyeb-youtube-resolver"}
```

然后测试解析：

```text
https://musicapi-xxxx.koyeb.app/resolve?name=简单爱&singer=周杰伦&duration=270&quality=hq
```

成功时会返回类似：

```json
{
  "code": 0,
  "source": "youtube",
  "url": "https://musicapi-xxxx.koyeb.app/stream/VIDEO_ID?quality=hq",
  "videoId": "VIDEO_ID",
  "title": "...",
  "author": "...",
  "duration": 270,
  "score": 120
}
```

## 接到 SPlayer

部署成功后，把你的 Koyeb 域名发给 ChatGPT。仓库里的 `config/providers.json` 会加入并启用如下 Provider：

```text
Koyeb YouTube Cloud
```

优先级会放在 Xinghai、Huibq 之后，并关闭旧的 Piped fallback。

最终顺序：

```text
Xinghai -> Huibq -> Koyeb YouTube Cloud -> fail
```

## 自动部署

Koyeb 的 GitHub 部署默认可以启用自动 redeploy。之后 `main` 分支中 `resolver/` 代码更新时，Koyeb 会重新构建并发布新版本。
