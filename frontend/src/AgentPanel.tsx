import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowUpRight,
  FileText,
  RefreshCw,
  Square,
  Download,
} from "lucide-react";
import type { Evidence } from "./App";
import {
  taskLabels,
  taskTerminal,
  ProgressView,
  type TaskProgress,
} from "./TaskPanel";
import {
  RetrievalControls,
  defaultRetrievalOptions,
  type RetrievalOptions,
} from "./RetrievalControls";

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
const agentStrategies = {
  original: "原策略（默认）",
  "inspection-free-v1": "减少引用检查工具调用 · 实验",
  "stop-aware-v1": "停止与预算约束 · 实验",
  "combined-v1": "组合策略 · 实验",
} as const;
type AgentStrategy = keyof typeof agentStrategies;
function runStrategy(run: AgentRun): string {
  return (
    run.request.strategy ??
    (typeof run.config?.agentStrategy === "string"
      ? run.config.agentStrategy
      : "original")
  );
}
function strategyLabel(value: string) {
  return agentStrategies[value as AgentStrategy] || value;
}
type Budget = {
  maxPlannerSteps: number;
  maxTools: number;
  maxSearch: number;
  maxEvidence: number;
  maxEvidenceChars: number;
  deadlineSeconds: number;
  maxPlannerOutputTokens: number;
  maxFinalOutputTokens: number;
  maxExternalCalls: number;
};
const defaultBudget: Budget = {
  maxPlannerSteps: 4,
  maxTools: 4,
  maxSearch: 2,
  maxEvidence: 12,
  maxEvidenceChars: 20000,
  deadlineSeconds: 120,
  maxPlannerOutputTokens: 256,
  maxFinalOutputTokens: 1024,
  maxExternalCalls: 10,
};
const budgetLabels: Record<keyof Budget, string> = {
  maxPlannerSteps: "最大规划步骤",
  maxTools: "最大工具调用",
  maxSearch: "最大检索次数",
  maxEvidence: "最大证据片段",
  maxEvidenceChars: "最大证据字符",
  deadlineSeconds: "总时限（秒）",
  maxPlannerOutputTokens: "规划输出上限",
  maxFinalOutputTokens: "答案输出上限",
  maxExternalCalls: "最大外部调用",
};
const statuses: Record<string, string> = {
  CREATED: "待执行",
  RUNNING: "运行中",
  CANCEL_REQUESTED: "正在取消",
  COMPLETED: "完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  INTERRUPTED: "执行中断",
};
const reasons: Record<string, string> = {
  BUDGET_EXCEEDED: "预算耗尽",
  TIMEOUT: "执行超时",
  NO_PROGRESS: "重复调用或无进展",
  INVALID_ACTION: "工具动作不合法",
  PROVIDER_ERROR: "模型服务失败",
  INVALID_CITATION: "引用校验失败",
  SOURCE_CHANGED: "文档版本变化",
  CONFIG_CHANGED: "模型或策略配置已变化，请重新创建运行",
  UNSAFE_TO_RESUME: "存在无法确认的外部调用，不能安全续跑；请显式新建运行",
  OUTPUT_LIMIT: "模型输出达到上限，已停止回答",
  INTERRUPTED: "服务中断",
  CANCELLED: "执行已取消",
};
export type AgentRun = {
  taskId?: string;
  taskStatus?: string;
  progress?: TaskProgress;
  id: string;
  kbId: string;
  status: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string | null;
  request: {
    question: string;
    strategy?: AgentStrategy;
    mode: string;
    topK: number;
    retrievalOptions: RetrievalOptions;
    budget: Budget;
  };
  config?: Record<string, unknown>;
  steps: {
    sequence: number;
    kind: string;
    action: string;
    status: string;
    input: unknown;
    output: unknown;
    usage: unknown;
    elapsedMs: number;
    createdAt: string;
  }[];
  result?: {
    question: string;
    answer: string;
    evidence: Evidence[];
    citations: Evidence[];
    citationValid: boolean;
    abstained: boolean;
    error: string | null;
    finishReason: string;
    strategy?: string;
    modelMode: string;
    totalMs: number;
    budgetUsed: Record<string, number>;
    usage: unknown[];
    answerCorrect: null;
    inFlightUsageUnavailable?: boolean;
  } | null;
};
const terminal = (state: string) =>
  ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(state);
const runTerminal = (run: AgentRun) =>
  run.taskStatus ? taskTerminal(run.taskStatus) : terminal(run.status);
const visibleStatus = (run: AgentRun) => run.taskStatus || run.status;
const completed = (run: AgentRun) =>
  ["COMPLETED", "SUCCEEDED"].includes(run.status) &&
  (!run.taskStatus || run.taskStatus === "SUCCEEDED");
const showError = (error: unknown) =>
  error instanceof Error ? error.message : "请求失败";
const json = (value: unknown) => JSON.stringify(value ?? null, null, 2);

export function AgentPanel({
  kbId,
  username,
  api,
  onCite,
}: {
  kbId: string;
  username: string;
  api: Api;
  onCite: (evidence: Evidence) => void;
}) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const mounted = useRef(true);
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState("vector");
  const [strategy, setStrategy] = useState<AgentStrategy>("original");
  const [topK, setTopK] = useState(5);
  const [options, setOptions] = useState<RetrievalOptions>(
    defaultRetrievalOptions,
  );
  const [budget, setBudget] = useState<Budget>(defaultBudget);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [mutation, setMutation] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  // A lost create response can be reconciled using the same body/key. No model call occurs at create.
  const pending = useRef<{ body: string; key: string } | null>(null);
  const storageKey = `citebase.agent.selected.${username}.${kbId}`;
  const pendingKey = `${storageKey}.pending`;
  const selectRun = useCallback(
    (value: AgentRun | null) => {
      setRun(value);
      if (value) sessionStorage.setItem(storageKey, value.id);
      else sessionStorage.removeItem(storageKey);
    },
    [storageKey],
  );
  const reload = useCallback(async () => {
    if (!kbId) {
      setRuns([]);
      return;
    }
    const values = await apiRef.current<AgentRun[]>(
      `/agent-runs?kbId=${encodeURIComponent(kbId)}`,
    );
    if (mounted.current) setRuns(values);
    return values;
  }, [kbId]);
  useEffect(() => {
    mounted.current = true;
    let valid = true;
    setLoading(true);
    setError("");
    setRun(null);
    setRuns([]);
    pending.current = null;
    const savedPending = sessionStorage.getItem(pendingKey);
    if (savedPending) {
      try {
        const journal = JSON.parse(savedPending),
          request = JSON.parse(journal.body);
        if (request.kbId !== kbId || request.idempotencyKey !== journal.key)
          throw Error("invalid draft");
        pending.current = journal;
        setQuestion(request.question);
        setMode(request.mode);
        setTopK(request.topK);
        setOptions(request.retrievalOptions);
        setBudget(request.budget);
        setStrategy(request.strategy ?? "original");
        setNotice(
          "发现尚未确认的创建请求。核对并重试创建使用原标识，不自动执行模型。",
        );
      } catch {
        sessionStorage.removeItem(pendingKey);
      }
    }
    void reload()
      .then(async () => {
        const id = sessionStorage.getItem(storageKey);
        if (id) {
          const value = await apiRef.current<AgentRun>(`/agent-runs/${id}`);
          if (valid && value.kbId === kbId) setRun(value);
        }
      })
      .catch((e) => {
        if (valid) setError(showError(e));
      })
      .finally(() => {
        if (valid) setLoading(false);
      });
    return () => {
      valid = false;
      mounted.current = false;
    };
  }, [kbId, reload, storageKey, pendingKey]);
  useEffect(() => {
    if (!run || runTerminal(run)) return;
    let active = true,
      polling = false;
    const timer = setInterval(async () => {
      setNow(Date.now());
      if (polling) return;
      polling = true;
      try {
        const value = await apiRef.current<AgentRun>(`/agent-runs/${run.id}`);
        if (active) {
          setRun(value);
          if (runTerminal(value)) void reload().catch(() => {});
        }
      } catch (e) {
        if (active) {
          setError(
            `进度读取失败：${showError(e)}。不会自动重复执行；可刷新状态。`,
          );
          setRun(null);
        }
      } finally {
        polling = false;
      }
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [run?.id, run?.status, run?.taskStatus, reload]);
  async function execute(value: AgentRun) {
    if (executing) return;
    setExecuting(value.id);
    setError("");
    setNotice(
      "已请求加入任务队列，可同时查看进度或取消。离开页面不会取消服务端工作。",
    );
    try {
      const saved = await apiRef.current<AgentRun>(
        `/agent-runs/${value.id}/execute`,
        { method: "POST" },
      );
      if (mounted.current) {
        setRun((current) => (current?.id === saved.id ? saved : current));
        await reload();
      }
    } catch (e) {
      if (mounted.current) {
        setError(
          `执行请求未正常返回：${showError(e)}。请刷新查看服务端状态，不会自动重发。`,
        );
        try {
          const saved = await apiRef.current<AgentRun>(
            `/agent-runs/${value.id}`,
          );
          setRun((current) => (current?.id === saved.id ? saved : current));
          await reload();
        } catch {
          /* Keep the interrupted transport warning. */
        }
      }
    } finally {
      if (mounted.current) setExecuting(null);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || !kbId || creating) return;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      if (!pending.current) {
        const key = crypto.randomUUID();
        pending.current = {
          key,
          body: JSON.stringify({
            kbId,
            question: question.trim(),
            ...(strategy === "original" ? {} : { strategy }),
            mode,
            topK,
            retrievalOptions: options,
            budget,
            idempotencyKey: key,
          }),
        };
        sessionStorage.setItem(pendingKey, JSON.stringify(pending.current));
      }
      const saved = await apiRef.current<AgentRun>("/agent-runs", {
        method: "POST",
        body: pending.current.body,
      });
      pending.current = null;
      sessionStorage.removeItem(pendingKey);
      selectRun(saved);
      setRuns((old) => [saved, ...old.filter((item) => item.id !== saved.id)]);
      void reload().catch((e) =>
        setError(`运行已创建，但列表刷新失败：${showError(e)}`),
      );
      // Creation and execution are explicit separate actions. Reload never starts a provider call.
      setNotice("运行已创建，尚未调用模型。核对预算后点击“执行此运行”。");
    } catch (e) {
      setError(
        `创建未完成：${showError(e)}。再次创建将使用同一请求标识核对，避免重复创建。`,
      );
    } finally {
      setCreating(false);
    }
  }
  async function refreshSelected() {
    setLoading(true);
    setError("");
    try {
      await reload();
      const id = run?.id || sessionStorage.getItem(storageKey);
      if (id) selectRun(await apiRef.current<AgentRun>(`/agent-runs/${id}`));
    } catch (e) {
      setError(showError(e));
      setRun(null);
    } finally {
      setLoading(false);
    }
  }
  async function cancel() {
    if (!run) return;
    setMutation(true);
    setError("");
    try {
      if (run.taskId) {
        await apiRef.current(`/tasks/${run.taskId}/cancel`, { method: "POST" });
        selectRun(await apiRef.current<AgentRun>(`/agent-runs/${run.id}`));
      } else
        selectRun(
          await apiRef.current<AgentRun>(`/agent-runs/${run.id}/cancel`, {
            method: "POST",
          }),
        );
      await reload();
      setNotice(
        "取消请求已保存。在途供应商请求可能继续计费，晚到结果不会成为成功答案。",
      );
    } catch (e) {
      setError(showError(e));
    } finally {
      setMutation(false);
    }
  }
  async function download() {
    if (!run) return;
    setMutation(true);
    setError("");
    try {
      const value = await apiRef.current<AgentRun>(
        `/agent-runs/${run.id}/export`,
      );
      const url = URL.createObjectURL(
        new Blob([json(value)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `agent-${run.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(showError(e));
    } finally {
      setMutation(false);
    }
  }
  const elapsed = run?.startedAt
    ? Math.max(
        0,
        (run.finishedAt ? Date.parse(run.finishedAt) : now) -
          Date.parse(run.startedAt),
      )
    : 0;
  const busy = creating || Boolean(pending.current);
  return (
    <div className="agent-layout">
      <section className="agent-main">
        <form className="ask-box" onSubmit={create}>
          <div className="eyebrow">BOUNDED AGENT</div>
          <p className="muted">
            仅在当前知识库内按需补充证据。所有工具由服务端校验权限；基础 RAG
            保持独立。
          </p>
          <label htmlFor="agent-question">Agent 问题</label>
          <textarea
            id="agent-question"
            value={question}
            disabled={!kbId || busy}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={4000}
            required
            placeholder="例如：两份操作规范如何共同决定上线条件？"
          />
          <label htmlFor="agent-strategy">Agent 执行策略</label>
          <select
            id="agent-strategy"
            value={strategy}
            disabled={busy}
            onChange={(event) =>
              setStrategy(event.target.value as AgentStrategy)
            }
          >
            {Object.entries(agentStrategies).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {strategy !== "original" && (
            <p className="notice" role="note">
              探索性策略，尚无真人质量结论。执行预算、权限边界与服务端引用校验保持不变；基础
              RAG 和原策略仍为对照。
            </p>
          )}
          <RetrievalControls
            value={options}
            onChange={setOptions}
            topK={topK}
            disabled={busy}
          />
          <details className="agent-budget-controls">
            <summary>
              执行预算 · 最多 {budget.maxTools} 次工具 /{" "}
              {budget.deadlineSeconds} 秒
            </summary>
            <div className="retrieval-fields">
              {(Object.keys(defaultBudget) as (keyof Budget)[]).map((key) => (
                <label key={key}>
                  {budgetLabels[key]}
                  <input
                    type="number"
                    min={1}
                    max={defaultBudget[key]}
                    step={1}
                    required
                    disabled={busy}
                    value={budget[key]}
                    onChange={(e) =>
                      setBudget({ ...budget, [key]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
            <small>
              缺失的 token
              用量显示为不可用；工具次数、外部调用数、时间和输出上限仍生效。
            </small>
          </details>
          <div className="ask-bottom">
            <div className="actions">
              <select
                aria-label="Agent 检索模式"
                disabled={busy}
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="vector">向量检索</option>
                <option value="hybrid">混合检索 · RRF</option>
              </select>
              <label className="k-input">
                Top K{" "}
                <input
                  aria-label="Agent Top K"
                  type="number"
                  min={1}
                  max={20}
                  required
                  disabled={busy}
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value))}
                />
              </label>
            </div>
            <button
              className="primary"
              disabled={creating || !kbId || !question.trim()}
            >
              {creating
                ? "创建中…"
                : pending.current
                  ? "核对并重试创建"
                  : "创建 Agent 运行"}
              <ArrowUpRight size={17} />
            </button>
          </div>
        </form>
        {pending.current && !creating && (
          <button
            className="agent-reset-draft"
            onClick={() => {
              pending.current = null;
              sessionStorage.removeItem(pendingKey);
              setNotice(
                "已解除请求锁定，可修改配置。若原创建已成功，请先从运行记录确认；创建本身不调用模型。",
              );
            }}
          >
            修改创建请求
          </button>
        )}
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <p className="agent-notice" role="status">
            {notice}
          </p>
        )}
        {run && (
          <article className="answer-card agent-run" data-run-id={run.id}>
            <div className="panel-title">
              <h3>{run.request.question}</h3>
              <span className={`badge ${visibleStatus(run).toLowerCase()}`}>
                {taskLabels[visibleStatus(run)] ||
                  statuses[run.status] ||
                  run.status}
              </span>
            </div>
            <div className="agent-run-id">
              运行 {run.id}
              {run.taskId && ` · 任务 ${run.taskId}`}
            </div>
            {run.taskId && <ProgressView progress={run.progress} />}
            <div className="actions agent-actions">
              {run.status === "CREATED" && !run.taskId && (
                <button
                  className="primary"
                  disabled={!!executing || mutation}
                  onClick={() => void execute(run)}
                >
                  执行此运行
                </button>
              )}
              {!runTerminal(run) && (
                <button
                  disabled={
                    mutation || visibleStatus(run) === "CANCEL_REQUESTED"
                  }
                  onClick={() => void cancel()}
                >
                  <Square size={14} />
                  {visibleStatus(run) === "CANCEL_REQUESTED"
                    ? "等待在途调用结束"
                    : "取消运行"}
                </button>
              )}
              <button disabled={loading} onClick={() => void refreshSelected()}>
                <RefreshCw size={14} />
                刷新运行状态
              </button>
              <button disabled={mutation} onClick={() => void download()}>
                <Download size={14} />
                导出 Agent 记录
              </button>
              {runTerminal(run) && (
                <button
                  onClick={() => {
                    setQuestion(run.request.question);
                    setMode(run.request.mode);
                    setTopK(run.request.topK);
                    setOptions(run.request.retrievalOptions);
                    setBudget(run.request.budget);
                    setStrategy(runStrategy(run) as AgentStrategy);
                    pending.current = null;
                    sessionStorage.removeItem(pendingKey);
                    setNotice(
                      "已填入原问题和配置。点击创建会生成新的运行；执行时可能产生新费用。",
                    );
                  }}
                >
                  填入原配置新建
                </button>
              )}
            </div>
            <p data-testid="agent-run-strategy">
              本次策略：{strategyLabel(runStrategy(run))} · {runStrategy(run)}
            </p>
            {runStrategy(run) !== "original" && (
              <p className="muted">
                探索性运行，尚无真人质量结论；请结合失败样本与对照评测判断。
              </p>
            )}
            <div className="agent-runtime">
              <span>累计耗时 {(elapsed / 1000).toFixed(1)} 秒</span>
              <span>时限 {run.request.budget.deadlineSeconds} 秒</span>
              <span>已记录步骤 {run.steps?.length || 0}</span>
            </div>
            <details className="agent-budget-status" open>
              <summary>预算与用量</summary>
              <div className="agent-runtime">
                {Object.entries(run.request.budget).map(([key, value]) => (
                  <span key={key}>
                    {budgetLabels[key as keyof Budget] || key}：{value}
                  </span>
                ))}
              </div>
              {run.result?.budgetUsed ? (
                <div className="agent-runtime agent-used-budget">
                  {Object.entries(run.result.budgetUsed).map(([key, value]) => (
                    <span key={key}>
                      {(
                        {
                          plannerSteps: "规划步骤",
                          tools: "工具调用",
                          searches: "检索次数",
                          externalCalls: "外部调用",
                          evidenceCount: "证据片段",
                          evidenceChars: "证据字符",
                        } as Record<string, string>
                      )[key] || key}
                      ：{value}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  运行中仅显示服务端已保存的步骤与请求上限；最终实际预算计数在终态返回。
                </p>
              )}
              <p className="muted">
                实际调用用量按供应商返回记录，null
                表示不可用，不作为零计算。未人工评分的答案正确性保持 null。
              </p>
            </details>
            {(run.errorCode || run.result?.error) && (
              <div className="inline-error">
                {reasons[run.errorCode || ""] || run.errorCode}
                {run.result?.error ? ` · ${run.result.error}` : ""}
              </div>
            )}
            {run.status === "CREATED" && !run.taskId && (
              <p className="muted">
                等待显式执行。刷新或重新打开页面不会自动开始模型调用。
              </p>
            )}
            {run.status === "INTERRUPTED" && (
              <p className="muted">
                无法安全续跑本次执行。请保留轨迹排查，再显式创建新运行。
              </p>
            )}
            <details>
              <summary>本次运行配置</summary>
              <pre>
                {json({
                  strategy: runStrategy(run),
                  mode: run.request.mode,
                  topK: run.request.topK,
                  retrievalOptions: run.request.retrievalOptions,
                  config: run.config,
                })}
              </pre>
            </details>
            <h4>行动与工具轨迹</h4>
            {!run.steps?.length ? (
              <p className="muted">尚无执行步骤。</p>
            ) : (
              <ol className="agent-steps">
                {run.steps.map((step) => (
                  <li key={step.sequence}>
                    <div>
                      <strong>
                        {step.sequence}. {step.action || step.kind}
                      </strong>
                      <span className="badge">{step.status}</span>
                      <small>{step.elapsedMs ?? "不可用"} ms</small>
                    </div>
                    <details>
                      <summary>查看工具参数、证据与实际用量</summary>
                      <h5>参数</h5>
                      <pre>{json(step.input)}</pre>
                      <h5>结果</h5>
                      <pre>{json(step.output)}</pre>
                      <h5>供应商用量</h5>
                      <pre>{json(step.usage)}</pre>
                    </details>
                  </li>
                ))}
              </ol>
            )}
            {run.result && (
              <div className="agent-result">
                <h4>
                  {completed(run) ? "最终答案" : "已保存部分结果"}{" "}
                  {run.result.modelMode === "mock" && (
                    <span className="badge pending">MOCK · 仅流程验证</span>
                  )}
                </h4>
                {completed(run) &&
                  run.result.abstained &&
                  !run.result.error && (
                    <span className="badge pending">证据不足 · 明确拒答</span>
                  )}
                {completed(run) && !run.result.error && (
                  <>
                    <p className="answer-text">
                      {run.result.answer
                        ?.split(/(\[[^\[\]\r\n]+\])/g)
                        .map((part, index) => {
                          const ev = run.result?.citations?.find(
                            (e) => `[${e.id}]` === part,
                          );
                          return ev ? (
                            <button
                              key={index}
                              className="inline-citation"
                              onClick={() => onCite(ev)}
                              title={ev.documentName}
                              aria-label={`查看 Agent 引用：${ev.documentName}`}
                            >
                              [
                              {(run.result?.evidence.findIndex(
                                (e) => e.id === ev.id,
                              ) ?? -1) + 1}
                              ]
                            </button>
                          ) : (
                            part
                          );
                        })}
                    </p>
                    <div className="citations">
                      {run.result.citations?.map((ev) => (
                        <button key={ev.id} onClick={() => onCite(ev)}>
                          <FileText size={13} />
                          {ev.documentName} · 第 {ev.page} 页 / 段落{" "}
                          {ev.paragraph}
                        </button>
                      ))}
                    </div>
                    <p className="muted">
                      引用格式：{run.result.citationValid ? "有效" : "无效"} ·
                      终态原因：{run.result.finishReason} ·
                      引用格式有效不代表答案正确
                    </p>
                  </>
                )}
                {!completed(run) && (
                  <p className="muted">
                    本次尚未成功完成回答。以下仅为已保存证据与用量，不代表正常答案或正确拒答。
                  </p>
                )}
                <details>
                  <summary>
                    本次获得的证据（{run.result.evidence?.length || 0}）
                  </summary>
                  {run.result.evidence?.map((ev) => (
                    <button
                      className="evidence-row"
                      key={ev.id}
                      onClick={() => onCite(ev)}
                    >
                      {ev.documentName} · 第 {ev.page} 页 / 段落 {ev.paragraph}
                    </button>
                  ))}
                </details>
                <details>
                  <summary>逐次调用用量</summary>
                  {run.result.inFlightUsageUnavailable && (
                    <p className="muted">
                      中断时存在在途调用，其结果与用量未保存；供应商可能已执行并计费，不能按零计入。
                    </p>
                  )}
                  <pre>{json(run.result.usage)}</pre>
                </details>
              </div>
            )}
          </article>
        )}
      </section>
      <aside className="panel agent-history">
        <div className="panel-title">
          <h3>Agent 运行记录</h3>
          <button
            className="icon"
            aria-label="刷新 Agent 列表"
            disabled={loading}
            onClick={() => void refreshSelected()}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <p className="muted">
          仅当前知识库，最近 100 条。刷新页面可查看已保存状态。
        </p>
        {loading && <p role="status">加载运行记录…</p>}
        {!loading && !runs.length && (
          <p className="muted">还没有 Agent 运行。</p>
        )}
        {runs.map((item) => (
          <button
            className={`agent-history-item ${run?.id === item.id ? "selected" : ""}`}
            key={item.id}
            onClick={async () => {
              setError("");
              try {
                selectRun(
                  await apiRef.current<AgentRun>(`/agent-runs/${item.id}`),
                );
              } catch (e) {
                setError(showError(e));
                setRun(null);
              }
            }}
          >
            <strong>{item.request.question}</strong>
            <span>
              {taskLabels[visibleStatus(item)] ||
                statuses[item.status] ||
                item.status}{" "}
              · {new Date(item.createdAt).toLocaleString("zh-CN")}
            </span>
          </button>
        ))}
      </aside>
    </div>
  );
}
