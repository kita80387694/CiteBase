# Atlas API 运行手册

Atlas API 的默认 HTTP 监听端口是 9081。

Atlas API 单次请求体上限为 8 MiB，超过限制返回 HTTP 413。

Atlas API 的服务端请求超时阈值为 12 秒。

Atlas API 的存活检查路径是 /health/live，就绪检查路径是 /health/ready。

Atlas API 使用 X-Trace-Id 请求头传递追踪号；缺失时服务端生成 UUID。

Atlas API 按用户限流，每分钟允许 120 次请求，超额返回 HTTP 429。

Atlas API 的 Idempotency-Key 幂等键保留 24 小时，重复键返回首次结果。

Atlas API 的时间字段采用 UTC 时区的 ISO-8601 格式。

Atlas API 的错误响应包含 code、message、traceId 三个字段。

Atlas API 分页默认每页 20 条，最大每页 100 条。
