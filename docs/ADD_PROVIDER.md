# 添加 Provider

只添加你有权使用的公开、自建或官方授权 API。

编辑 `config/providers.json`，复制示例 Provider 并修改。

支持模板变量：

- `{source}`: `wy` / `tx` / `kg`
- `{id}` / `{songmid}` / `{songId}`: SPlayer 传入的平台歌曲 ID
- `{quality}`: 经过 `qualityMap` 映射后的音质
- `{requestedQuality}`: SPlayer 原始音质
- `{name}`: 歌名
- `{singer}`: 歌手
- `{duration}`: `mm:ss`
- `{album}`: 专辑名

## GET JSON 示例

```json
{
  "id": "my-api",
  "name": "My API",
  "enabled": true,
  "priority": 10,
  "platforms": ["wy", "tx", "kg"],
  "transport": {
    "method": "GET",
    "url": "https://api.example.com/url?source={source}&id={id}&q={quality}",
    "responseType": "json",
    "headers": {},
    "qualityMap": {
      "lq": "128k",
      "sq": "192k",
      "hq": "320k",
      "lossless": "flac",
      "hi-res": "hires"
    },
    "success": {
      "status": [200],
      "bodyPath": "code",
      "equals": 0
    },
    "result": {
      "urlPath": "data.url",
      "expirePath": "data.expire",
      "expireUnit": "ms"
    }
  }
}
```

## POST JSON 示例

```json
{
  "transport": {
    "method": "POST",
    "url": "https://api.example.com/resolve",
    "responseType": "json",
    "headers": {
      "Content-Type": "application/json"
    },
    "body": {
      "source": "{source}",
      "id": "{id}",
      "quality": "{quality}"
    },
    "success": {
      "status": [200]
    },
    "result": {
      "urlPath": "url"
    }
  }
}
```

## 凭据

公开 GitHub 仓库中的所有内容都应视为公开。

不要写：

- Cookie
- Authorization bearer token
- 私有 API key
- 账号密码

如果 API 必须用秘密，请在你自己的服务端保存秘密，再让插件访问你的服务端。
