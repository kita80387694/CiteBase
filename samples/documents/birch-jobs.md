# Birch 任务队列规范

Birch 任务初次执行失败后最多重试 3 次，总尝试次数不超过 4 次。

Birch 的三次重试退避间隔依次为 2 秒、4 秒、8 秒。

Birch worker 每隔 10 秒更新一次任务心跳。

Birch 任务租约为 60 秒，租约到期且没有心跳时允许重新领取。

Birch 单个 worker 默认并发处理 6 个任务。

Birch 通过业务幂等键和数据库唯一约束防止任务重复写入。

Birch 遇到参数校验错误时直接标记 FAILED，不进行自动重试。

Birch 任务执行日志保留 30 天，审计日志单独保留 180 天。

Birch 优雅停机会停止领取任务，并等待正在执行的任务最多 45 秒。

Birch 任务状态包括 PENDING、RUNNING、SUCCEEDED 和 FAILED。
