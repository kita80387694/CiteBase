import { useEffect, useRef, useState } from "react";
import { RefreshCw, Download } from "lucide-react";
export type TaskProgress = {
  completed: number;
  total: number | null;
  unit: string;
  failed?: number;
  [key: string]: unknown;
};
export type WorkTask = {
  id: string;
  workTaskId?: string;
  kbId?: string;
  kind: "INDEX" | "EVALUATION" | "AGENT";
  status: string;
  attempts: number;
  maxAttempts: number;
  retryGeneration?: number;
  progress?: TaskProgress;
  errorCode?: string;
  errorSummary?: string;
  canCancel?: boolean;
  canRetry?: boolean;
  retryBlockedReason?: string;
  documentId?: string;
  documentName?: string;
  versionId?: string;
  createdAt?: string;
  availableAt?: string;
};
export const taskLabels: Record<string, string> = {
  QUEUED: "排队",
  RUNNING: "运行中",
  RETRY_WAIT: "等待重试",
  CANCEL_REQUESTED: "正在取消",
  SUCCEEDED: "任务完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};
export const taskTerminal = (status: string) =>
  ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status);
export function ProgressView({ progress }: { progress?: TaskProgress }) {
  if (!progress || typeof progress.completed !== "number")
    return <span className="muted">准备中 · 尚无进度</span>;
  const unit =
    (
      {
        chunks: "分块",
        question_modes: "问题/模式项",
        steps: "步骤",
      } as Record<string, string>
    )[progress.unit] || progress.unit;
  return (
    <div className="task-progress">
      <span>
        {progress.completed} / {progress.total ?? "总量未知"} {unit}
        {progress.failed != null ? ` · 失败 ${progress.failed}` : ""}
      </span>
      {progress.total != null && progress.total > 0 && (
        <progress
          max={progress.total}
          value={progress.completed}
          aria-label="任务完成进度"
        />
      )}
    </div>
  );
}
type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
export function TaskPanel({
  kbId,
  api,
  onOpen,
}: {
  kbId: string;
  api: Api;
  onOpen: (task: WorkTask) => void;
}) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [kind, setKind] = useState(""),
    [tasks, setTasks] = useState<WorkTask[]>([]),
    [selected, setSelected] = useState<WorkTask | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true,
      fetching = false;
    setTasks([]);
    setSelected(null);
    setLoading(true);
    setError("");
    async function refresh() {
      if (fetching) return;
      fetching = true;
      try {
        const values = await apiRef.current<WorkTask[]>(
          `/tasks?${new URLSearchParams({ ...(kbId ? { kbId } : {}), ...(kind ? { kind } : {}) })}`,
        );
        if (active) {
          setTasks(values);
          setSelected((old) =>
            old && values.some((item) => item.id === old.id) ? old : null,
          );
          setError("");
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "任务读取失败");
          setTasks([]);
          setSelected(null);
        }
      } finally {
        fetching = false;
        if (active) setLoading(false);
      }
    }
    void refresh();
    const timer = setInterval(refresh, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [kbId, kind, revision]);
  useEffect(() => {
    if (!selected) return;
    let active = true,
      fetching = false;
    const id = selected.id;
    async function refreshDetail() {
      if (fetching) return;
      fetching = true;
      try {
        const value = await apiRef.current<WorkTask>(`/tasks/${id}`);
        if (active) setSelected(value);
      } catch (e) {
        if (active) {
          setSelected(null);
          setError(e instanceof Error ? e.message : "任务详情读取失败");
        }
      } finally {
        fetching = false;
      }
    }
    void refreshDetail();
    const timer = setInterval(refreshDetail, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selected?.id]);
  async function mutate(task: WorkTask, action: "cancel" | "retry") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRef.current(`/tasks/${task.id}/${action}`, { method: "POST" });
      setNotice(
        action === "cancel"
          ? "取消请求已保存；在途供应商请求可能继续计费。"
          : "已请求恢复未完成工作；已完成检查点保留。",
      );
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  async function exportTask(task: WorkTask) {
    setBusy(true);
    setError("");
    try {
      const path =
        task.kind === "EVALUATION"
          ? `/evaluations/${task.id}/export`
          : task.kind === "AGENT"
            ? `/agent-runs/${task.id}/export`
            : `/tasks/${task.id}`;
      const value = await apiRef.current(path);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${task.kind.toLowerCase()}-${task.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel unified-tasks">
      <div className="panel-title">
        <h2>处理任务</h2>
        <div className="actions">
          <select
            aria-label="任务类型"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">全部类型</option>
            <option value="INDEX">索引</option>
            <option value="EVALUATION">评测</option>
            <option value="AGENT">Agent</option>
          </select>
          <button disabled={loading} onClick={() => setRevision((v) => v + 1)}>
            <RefreshCw size={14} />
            刷新任务
          </button>
        </div>
      </div>
      <p className="muted task-description">
        每 2.5
        秒读取当前知识库任务。任务完成不代表答案正确；重试只恢复服务端允许的未完成工作。
      </p>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="agent-notice">
          {notice}
        </p>
      )}
      {loading && <p role="status">正在加载任务…</p>}
      {!loading && !error && !tasks.length && (
        <p className="empty">暂无处理任务</p>
      )}
      <div className="task-list">
        {tasks.map((task) => (
          <article className="task" key={task.id} data-task-id={task.id}>
            <div className="grow">
              <strong>
                {
                  { INDEX: "索引", EVALUATION: "评测", AGENT: "Agent" }[
                    task.kind
                  ]
                }{" "}
                · {task.documentName || task.id.slice(0, 8)}
              </strong>
              <p className="muted">
                尝试 {task.attempts}/{task.maxAttempts} · 恢复代次{" "}
                {task.retryGeneration ?? 0}
              </p>
              <ProgressView progress={task.progress} />
              {task.status === "RETRY_WAIT" && task.availableAt && (
                <p className="muted">
                  下次尝试：{new Date(task.availableAt).toLocaleString("zh-CN")}
                </p>
              )}
              {task.errorCode && (
                <div className="inline-error">
                  {task.errorCode}
                  {task.errorSummary ? ` · ${task.errorSummary}` : ""}
                </div>
              )}
              {task.retryBlockedReason && (
                <p className="muted">重试限制：{task.retryBlockedReason}</p>
              )}
            </div>
            <span className={`badge ${task.status.toLowerCase()}`}>
              {taskLabels[task.status] || task.status}
            </span>
            <div className="actions">
              <button
                onClick={() => {
                  setSelected(task);
                }}
              >
                任务详情
              </button>
              {task.kind !== "INDEX" && (
                <button onClick={() => onOpen(task)}>打开结果</button>
              )}
              {task.canCancel && (
                <button
                  disabled={busy}
                  onClick={() => void mutate(task, "cancel")}
                >
                  取消任务
                </button>
              )}
              {task.canRetry && (
                <button
                  disabled={busy}
                  onClick={() => void mutate(task, "retry")}
                >
                  重试任务
                </button>
              )}
              <button disabled={busy} onClick={() => void exportTask(task)}>
                <Download size={14} />
                {task.kind === "INDEX" ? "导出任务详情" : "导出已保存结果"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {selected && (
        <details className="task-details" open>
          <summary>任务详情 · {selected.kind}</summary>
          <pre>{JSON.stringify(selected, null, 2)}</pre>
          <p className="muted">
            UNKNOWN
            表示供应商调用结果未保存，用量不可用，不能按零计算；索引失败或取消不会替换上一份可用索引。
          </p>
        </details>
      )}
    </section>
  );
}
