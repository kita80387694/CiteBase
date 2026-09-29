import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  TaskPanel,
  ProgressView,
  type WorkTask,
  type TaskProgress,
} from "./TaskPanel";
import { AgentPanel } from "./AgentPanel";
import {
  RetrievalControls,
  RetrievalDiagnostics,
  defaultRetrievalOptions,
  type RetrievalOptions,
  type RetrievalDetails,
} from "./RetrievalControls";
import {
  ChunkControls,
  DocumentVersions,
  defaultChunkProfile,
  validateChunkProfile,
  type ChunkProfile,
  type DocumentVersion,
} from "./DocumentProfiles";
import {
  EvaluationAnalysis,
  EvaluationReview,
  type ManualScore,
  type EvidenceLabel,
} from "./EvaluationAnalysis";
import {
  BookOpen,
  MessageSquare,
  FlaskConical,
  ListChecks,
  LogOut,
  Plus,
  ArrowUpRight,
  Upload,
  Trash2,
  RefreshCw,
  ChevronRight,
  FileText,
  X,
  Check,
  Database,
} from "lucide-react";

type KB = { id: string; name: string; createdAt: string };
type Doc = {
  id: string;
  name: string;
  status: string;
  error?: string;
  activeVersionId?: string;
  activeProfile?: ChunkProfile | null;
};
export type Evidence = {
  id: string;
  documentName: string;
  page: number;
  paragraph: number;
  startOffset: number;
  endOffset: number;
  text: string;
  score: number;
};
type QA = RetrievalDetails & {
  id: string;
  question: string;
  answer: string;
  mode: string;
  modelMode: string;
  evidence: Evidence[];
  citations: Evidence[];
  citationValid: boolean;
  abstained: boolean;
  retrievalMs: number;
  totalMs: number;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
};
export type Result = QA & {
  caseId: string;
  answerable: boolean;
  expectedAnswer?: string;
  recallAtK?: number;
  mrr?: number;
  evidenceHit: boolean;
  answerCorrect?: boolean | null;
  citationSupported?: boolean | null;
  category?: string | null;
  split?: string | null;
  group?: string | null;
  topic?: string | null;
  expectedEvidence?: EvidenceLabel[];
  evidenceGroupCount?: number;
  hitEvidenceGroupCount?: number;
  allEvidenceHit?: boolean;
  manualScore?: ManualScore | null;
  referenceAnswerMatch?: boolean;
  abstentionCorrect?: boolean;
};
export type Metric = {
  recallAtK: number;
  mrr: number;
  retrievalMs: number;
  totalMs: number;
  count: number;
};
export type Run = {
  id: string;
  name: string;
  kbId?: string;
  taskId?: string;
  taskStatus?: string;
  progress?: TaskProgress;
  partial?: boolean;
  canScore?: boolean;
  pendingItems?: unknown[];
  status: string;
  modelMode: string;
  config: { retrievalOptions?: RetrievalOptions; [key: string]: unknown };
  summary?: Record<string, Metric>;
  results?: Result[];
  manualScores?: ManualScore[];
  breakdowns?: Record<string, Record<string, Record<string, Metric>>>;
  error?: string;
  createdAt: string;
};
const labels: Record<string, string> = {
  QUEUED: "排队",
  RETRY_WAIT: "等待重试",
  CANCEL_REQUESTED: "正在取消",
  CANCELLED: "已取消",
  PENDING: "待处理",
  PROCESSING: "处理中",
  RUNNING: "运行中",
  SUCCESS: "成功",
  SUCCEEDED: "成功",
  COMPLETED: "完成",
  COMPLETED_WITH_ERRORS: "完成（部分失败）",
  FAILED: "失败",
  READY: "就绪",
};
const status = (s: string) => (
  <span className={"badge " + s.toLowerCase()}>{labels[s] || s}</span>
);
const fmt = (n: number | undefined) =>
  n == null ? "不可用" : Number(n).toFixed(2);

export default function App() {
  const [evidenceContext, setEvidenceContext] = useState("当前有效文档版本");
  const [evalPending, setEvalPending] = useState<string | null>(null);
  const [runTask, setRunTask] = useState<WorkTask | null>(null);
  const [evalPollError, setEvalPollError] = useState("");
  const [answerMode, setAnswerMode] = useState("rag");
  const [retrievalOptions, setRetrievalOptions] = useState<RetrievalOptions>(
    defaultRetrievalOptions,
  );
  const [chunkProfile, setChunkProfile] =
    useState<ChunkProfile>(defaultChunkProfile);
  const [versionDocument, setVersionDocument] = useState<Doc | null>(null);
  const [token, setToken] = useState(
    localStorage.getItem("citebase.token") || "",
  );
  const [user, setUser] = useState<{ username: string; mode: string } | null>(
    null,
  );
  const [page, setPage] = useState("library"),
    [kbs, setKbs] = useState<KB[]>([]),
    [kb, setKb] = useState(""),
    [docs, setDocs] = useState<Doc[]>([]),
    [history, setHistory] = useState<QA[]>([]),
    [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [evidence, setEvidence] = useState<Evidence | null>(null),
    [run, setRun] = useState<Run | null>(null),
    [detail, setDetail] = useState<Result | null>(null);
  const [question, setQuestion] = useState(""),
    [mode, setMode] = useState("vector"),
    [topK, setTopK] = useState(5),
    [dataset, setDataset] = useState(""),
    [datasetName, setDatasetName] = useState(""),
    [evalName, setEvalName] = useState("检索配置对比");
  const [username, setUsername] = useState("alice"),
    [password, setPassword] = useState("Alice-demo-123!");
  async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (options.body && !(options.body instanceof FormData))
      headers["Content-Type"] = "application/json";
    const r = await fetch("/api" + path, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    if (!r.ok) {
      let message = `请求失败 (${r.status})`;
      try {
        message = (await r.json()).message || message;
      } catch {}
      if (r.status === 401 && path != "/auth/login") {
        localStorage.removeItem("citebase.token");
        setToken("");
        setUser(null);
      }
      throw Object.assign(new Error(message), { status: r.status });
    }
    const text = await r.text();
    return text ? JSON.parse(text) : (undefined as T);
  }
  async function action(fn: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  const refreshGeneration = useRef(0);
  const viewIdentity = useRef({ token, kb });
  viewIdentity.current = { token, kb };
  async function refresh() {
    const generation = ++refreshGeneration.current;
    const current = () =>
      generation === refreshGeneration.current &&
      viewIdentity.current.token === token &&
      viewIdentity.current.kb === kb;
    setLoading(true);
    try {
      const [bases, rs] = await Promise.all([
        api<KB[]>("/knowledge-bases"),
        api<Run[]>("/evaluations"),
      ]);
      if (!current()) return;
      setKbs(bases);
      setRuns(rs);
      if (!bases.some((b) => b.id === kb)) {
        setKb(bases[0]?.id || "");
        setDocs([]);
        setHistory([]);
        return;
      }
      if (kb) {
        const [ds, hs] = await Promise.all([
          api<Doc[]>(`/knowledge-bases/${kb}/documents`),
          api<QA[]>(`/questions?kbId=${kb}`),
        ]);
        if (!current()) return;
        setDocs(ds);
        setHistory(hs);
      }
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (token)
      action(async () => {
        setUser(await api("/me"));
        await refresh();
      });
  }, [token]);
  useEffect(() => {
    setDocs([]);
    setHistory([]);
    if (token && kb) action(refresh);
  }, [kb]);
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => {
      if (!busy) refresh().catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [token, kb, busy]);
  const logout = () => {
    localStorage.removeItem("citebase.token");
    setToken("");
    setUser(null);
    setKbs([]);
    setKb("");
    setRun(null);
    setEvidence(null);
    setVersionDocument(null);
  };
  async function login(e: FormEvent) {
    e.preventDefault();
    await action(async () => {
      const result = await api<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem("citebase.token", result.token);
      setToken(result.token);
    });
  }
  async function upload(file: File, documentId?: string) {
    await action(async () => {
      validateChunkProfile(chunkProfile);
      const form = new FormData();
      form.append("file", file);
      form.append("chunkStrategy", chunkProfile.strategy);
      form.append("chunkSize", String(chunkProfile.size));
      form.append("chunkOverlap", String(chunkProfile.overlap));
      if (documentId) form.append("documentId", documentId);
      await api(`/knowledge-bases/${kb}/documents`, {
        method: "POST",
        body: form,
      });
      setNotice("文档已提交。后台将持久化处理，完成后可用于问答。");
      await refresh();
    });
  }
  async function cite(ev: Evidence) {
    setEvidenceContext("当前有效文档版本");
    await action(async () =>
      setEvidence(await api<Evidence>(`/citations/${ev.id}`)),
    );
  }
  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    await action(async () => {
      const result = await api<QA>("/questions", {
        method: "POST",
        body: JSON.stringify({
          kbId: kb,
          question,
          mode,
          topK,
          retrievalOptions,
        }),
      });
      setHistory((h) => [result, ...h]);
      setQuestion("");
    });
  }
  const evalJournalKey = `citebase.eval.pending.${user?.username || ""}.${kb}`;
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    setEvalPending(user && kb ? sessionStorage.getItem(evalJournalKey) : null);
  }, [evalJournalKey, user?.username, kb]);
  useEffect(() => {
    if (page !== "eval" || !run?.taskId) {
      setRunTask(null);
      return;
    }
    setRunTask(null);
    let live = true,
      fetching = false;
    const selectedId = run.id,
      taskId = run.taskId;
    async function poll() {
      if (fetching) return;
      fetching = true;
      try {
        const [current, task] = await Promise.all([
          apiRef.current<Run>(`/evaluations/${selectedId}`),
          apiRef.current<WorkTask>(`/tasks/${taskId}`),
        ]);
        if (live) {
          setRun((old) => (old?.id === selectedId ? current : old));
          setRunTask(task);
          setEvalPollError("");
        }
      } catch (e) {
        if (live) {
          setEvalPollError(e instanceof Error ? e.message : "进度读取失败");
          if ((e as { status?: number }).status === 404) {
            setRun(null);
            setDetail(null);
            setEvidence(null);
          }
        }
      } finally {
        fetching = false;
      }
    }
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [page, run?.id, run?.taskId]);
  function selectEvaluation(value: Run) {
    setRun(value);
    setDetail(null);
    setEvalPollError("");
    sessionStorage.setItem(
      `citebase.eval.selected.${user?.username}`,
      value.id,
    );
  }
  useEffect(() => {
    if (page !== "eval" || !user || run) return;
    let active = true;
    const id = sessionStorage.getItem(
      `citebase.eval.selected.${user.username}`,
    );
    if (id)
      void apiRef
        .current<Run>(`/evaluations/${id}`)
        .then((saved) => {
          if (active) setRun(saved);
        })
        .catch((e) => {
          if (active)
            setEvalPollError(e instanceof Error ? e.message : "评测恢复失败");
        });
    return () => {
      active = false;
    };
  }, [page, user?.username]);
  async function evaluate(e: FormEvent) {
    e.preventDefault();
    await action(async () => {
      let body = evalPending;
      if (!body) {
        let data;
        try {
          data = JSON.parse(dataset);
        } catch {
          throw new Error("评测集不是有效 JSON，请检查文件格式。");
        }
        body = JSON.stringify({
          kbId: kb,
          name: evalName,
          dataset: data,
          topK,
          retrievalOptions,
          idempotencyKey: crypto.randomUUID(),
        });
        sessionStorage.setItem(evalJournalKey, body);
        setEvalPending(body);
      }
      try {
        const result = await api<Run>("/evaluations", { method: "POST", body });
        sessionStorage.removeItem(evalJournalKey);
        setEvalPending(null);
        selectEvaluation(result);
        setNotice(
          "评测已持久化并加入任务队列。关闭页面后仍会继续，可从处理任务查看、取消或恢复。",
        );
        await refresh().catch(() =>
          setNotice("评测已创建；列表暂未刷新，请通过已保存任务查看状态。"),
        );
      } catch (e) {
        const code = (e as { status?: number }).status;
        if (code && [400, 403, 404, 422].includes(code)) {
          sessionStorage.removeItem(evalJournalKey);
          setEvalPending(null);
        }
        throw e;
      }
    });
  }
  async function evalTaskAction(actionName: "cancel" | "retry") {
    if (!run?.taskId) return;
    await action(async () => {
      await api(`/tasks/${run.taskId}/${actionName}`, { method: "POST" });
      selectEvaluation(await api<Run>(`/evaluations/${run.id}`));
      setRunTask(await api<WorkTask>(`/tasks/${run.taskId}`));
    });
  }
  function openTask(task: WorkTask) {
    if (task.kind === "INDEX") return;
    if (task.kbId) setKb(task.kbId);
    if (task.kind === "EVALUATION") {
      setPage("eval");
      void action(async () =>
        selectEvaluation(await api<Run>(`/evaluations/${task.id}`)),
      );
    } else {
      sessionStorage.setItem(
        `citebase.agent.selected.${user?.username}.${task.kbId || kb}`,
        task.id,
      );
      setAnswerMode("agent");
      setPage("chat");
    }
  }
  async function exportRun() {
    if (!run) return;
    await action(async () => {
      const data = await api<Run>(`/evaluations/${run.id}/export`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `citebase-${run.id}-${data.partial ? "partial" : "final"}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
  const nav = [
    ["library", "知识库", BookOpen],
    ["chat", "知识问答", MessageSquare],
    ["tasks", "处理任务", ListChecks],
    ["eval", "检索评测", FlaskConical],
  ] as const;
  if (!token)
    return (
      <div className="login">
        <div className="login-story">
          <div className="brand">
            <BookOpen /> CiteBase <span>知据</span>
          </div>
          <div>
            <div className="eyebrow">YOUR KNOWLEDGE, GROUNDED.</div>
            <h1>
              让每个回答，
              <br />
              都有据可循。
            </h1>
            <p>
              从技术文档到可信答案。
              <br />
              构建知识库，追溯证据，衡量检索效果。
            </p>
          </div>
          <small>文档索引 / 来源引用 / 可重复评测</small>
        </div>
        <form className="login-form" onSubmit={login}>
          <div className="eyebrow">WELCOME BACK</div>
          <h2>登录工作空间</h2>
          <p className="muted">开始探索你的知识资产</p>
          <label>
            用户名
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error && (
            <div role="alert" className="alert">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "登录中…" : "进入 CiteBase"}
            <ArrowUpRight size={18} />
          </button>
          <div className="demo">
            <strong>本地演示账号</strong>
            <p>
              alice / Alice-demo-123!
              <br />
              bob / Bob-demo-123!
            </p>
            <small>两个账号的知识库与检索数据相互隔离。</small>
          </div>
        </form>
      </div>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <BookOpen /> CiteBase <span>知据</span>
        </div>
        <div className="nav-label">工作空间</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => {
                setPage(id);
                setError("");
              }}
            >
              <Icon size={19} />
              {label}
              {page === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private">
            <Check size={15} /> 私有知识 · 证据可溯
          </div>
          <button onClick={logout}>
            <span className="avatar">
              {user?.username?.slice(0, 1).toUpperCase()}
            </span>
            <span>{user?.username || "加载中"}</span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main>
        <header>
          <span>
            CiteBase <ChevronRight size={14} />{" "}
            {nav.find((n) => n[0] === page)?.[1]}
          </span>
          <div className="header-right">
            <span className={"mode " + (user?.mode === "mock" ? "mock" : "")}>
              {user?.mode === "mock"
                ? "MOCK · 流程演示"
                : user?.mode || "连接中"}
            </span>
            <button
              className="icon"
              title="刷新数据"
              aria-label="刷新数据"
              disabled={loading}
              onClick={() => action(refresh)}
            >
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </button>
          </div>
        </header>
        <div className="content">
          {user?.mode === "mock" && (
            <div className="mock-banner">
              当前为 Mock
              模式：验证业务流程与权限，生成内容和评测数据不能代表真实模型效果。
            </div>
          )}
          {error && (
            <div className="alert" role="alert">
              {error}
              <button
                className="icon"
                aria-label="关闭错误"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "library"
                  ? "KNOWLEDGE LIBRARY"
                  : page === "chat"
                    ? "GROUNDED ANSWERS"
                    : page === "eval"
                      ? "MEASURE & COMPARE"
                      : "INDEXING PIPELINE"}
              </div>
              <h1>{nav.find((n) => n[0] === page)?.[1]}</h1>
              <p>
                {page === "library"
                  ? "整理技术资料，为每一个答案建立可靠来源。"
                  : page === "chat"
                    ? "基于你选择的知识库回答，点击引用核验原始证据。"
                    : page === "eval"
                      ? "用同一组问题，对比向量检索与混合检索的真实表现。"
                      : "查看索引进度、失败原因与重试记录。"}
              </p>
            </div>
            {page === "library" && (
              <button
                className="primary"
                disabled={busy || loading}
                onClick={() => {
                  const name = prompt("新知识库名称");
                  if (name?.trim())
                    action(async () => {
                      const b = await api<KB>("/knowledge-bases", {
                        method: "POST",
                        body: JSON.stringify({ name: name.trim() }),
                      });
                      ++refreshGeneration.current;
                      setKbs((existing) => [
                        ...existing.filter((item) => item.id !== b.id),
                        b,
                      ]);
                      setKb(b.id);
                    });
                }}
              >
                <Plus size={17} />
                新建知识库
              </button>
            )}
          </div>
          {
            <div className="kb-selector">
              <Database size={17} />
              <label htmlFor="knowledge-base">当前知识库</label>
              <select
                id="knowledge-base"
                value={kb}
                onChange={(e) => setKb(e.target.value)}
              >
                <option value="" disabled>
                  请选择知识库
                </option>
                {kbs.map((k) => (
                  <option value={k.id} key={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
              {loading && <span className="muted">加载中…</span>}
            </div>
          }
          {page === "library" && (
            <>
              <div className="stats">
                <div>
                  <span>知识库</span>
                  <strong>
                    {kbs.length}
                    <small>个</small>
                  </strong>
                </div>
                <div>
                  <span>当前文档</span>
                  <strong>
                    {docs.length}
                    <small>份</small>
                  </strong>
                </div>
                <div>
                  <span>可用索引</span>
                  <strong>
                    {docs.filter((d) => d.activeVersionId).length}
                    <small>份</small>
                  </strong>
                </div>
              </div>
              {kb ? (
                <section className="panel">
                  <div className="panel-title">
                    <h2>
                      文档资料 <span>{docs.length}</span>
                    </h2>
                    <div className="actions">
                      <label
                        className={"button primary " + (busy ? "disabled" : "")}
                      >
                        <Upload size={16} />
                        上传文档
                        <input
                          type="file"
                          hidden
                          disabled={busy}
                          accept=".pdf,.md,.markdown,.txt"
                          onChange={(e) => {
                            if (e.target.files?.[0]) upload(e.target.files[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        className="danger quiet"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "删除整个知识库及所有文档、问答与评测？此操作不可撤销。",
                            )
                          )
                            action(async () => {
                              await api(`/knowledge-bases/${kb}`, {
                                method: "DELETE",
                              });
                              setKb("");
                              setDocs([]);
                              await refresh();
                            });
                        }}
                      >
                        删除知识库
                      </button>
                    </div>
                  </div>
                  <div className="upload-note">
                    支持文本型
                    PDF、Markdown、TXT。重复内容自动检测；更新成功后切换索引版本。
                  </div>
                  <ChunkControls
                    value={chunkProfile}
                    onChange={setChunkProfile}
                    disabled={busy}
                  />
                  {!docs.length ? (
                    <Empty
                      text="还没有文档"
                      sub="上传第一份技术资料，开始构建你的知识库。"
                    />
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>文档名称</th>
                            <th>处理状态</th>
                            <th>可用版本</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {docs.map((d) => (
                            <tr key={d.id}>
                              <td>
                                <div className="file-name">
                                  <FileText size={20} />
                                  <strong>{d.name}</strong>
                                </div>
                                {d.error && (
                                  <div className="inline-error">{d.error}</div>
                                )}
                              </td>
                              <td>{status(d.status)}</td>
                              <td>
                                <span className="muted">
                                  {d.activeVersionId
                                    ? d.activeVersionId.slice(0, 8)
                                    : "尚未索引"}
                                </span>
                                {d.activeProfile && (
                                  <small className="result-sub">
                                    {d.activeProfile.strategy} ·{" "}
                                    {d.activeProfile.size} /{" "}
                                    {d.activeProfile.overlap}
                                  </small>
                                )}
                              </td>
                              <td>
                                <div className="actions">
                                  <button
                                    className="quiet"
                                    onClick={() => setVersionDocument(d)}
                                  >
                                    版本
                                  </button>
                                  <label className="button quiet">
                                    更新
                                    <input
                                      type="file"
                                      hidden
                                      accept=".pdf,.md,.markdown,.txt"
                                      disabled={busy}
                                      onChange={(e) => {
                                        if (e.target.files?.[0])
                                          upload(e.target.files[0], d.id);
                                        e.target.value = "";
                                      }}
                                    />
                                  </label>
                                  <button
                                    className="icon danger"
                                    aria-label={`删除 ${d.name}`}
                                    disabled={busy}
                                    onClick={() => {
                                      if (confirm(`删除文档「${d.name}」？`))
                                        action(async () => {
                                          await api(`/documents/${d.id}`, {
                                            method: "DELETE",
                                          });
                                          await refresh();
                                        });
                                    }}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ) : (
                <Empty
                  text="建立你的第一个知识库"
                  sub="点击右上角「新建知识库」，集中管理一组相关文档。"
                />
              )}
            </>
          )}
          {page === "tasks" && (
            <TaskPanel kbId={kb} api={api} onOpen={openTask} />
          )}
          {page === "chat" && (
            <div
              className="answer-mode-tabs"
              role="group"
              aria-label="问答执行方式"
            >
              <button
                className={answerMode === "rag" ? "selected" : ""}
                aria-pressed={answerMode === "rag"}
                onClick={() => setAnswerMode("rag")}
              >
                基础 RAG
              </button>
              <button
                className={answerMode === "agent" ? "selected" : ""}
                aria-pressed={answerMode === "agent"}
                onClick={() => setAnswerMode("agent")}
              >
                有边界 Agent
              </button>
            </div>
          )}
          {page === "chat" && answerMode === "agent" && (
            <AgentPanel
              key={`${user?.username}:${kb}`}
              kbId={kb}
              username={user?.username || ""}
              api={api}
              onCite={cite}
            />
          )}
          {page === "chat" && answerMode === "rag" && (
            <div className="chat-layout">
              <section className="chat-main">
                <form className="ask-box" onSubmit={ask}>
                  <label htmlFor="question">你想了解什么？</label>
                  <textarea
                    id="question"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="例如：文档更新失败时，系统如何保护旧版本索引？"
                    required
                    disabled={!kb || busy}
                  />
                  <RetrievalControls
                    value={retrievalOptions}
                    onChange={setRetrievalOptions}
                    topK={topK}
                    disabled={busy}
                  />
                  <div className="ask-bottom">
                    <div className="actions">
                      <select
                        aria-label="检索模式"
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                      >
                        <option value="hybrid">混合检索 · RRF</option>
                        <option value="vector">向量检索</option>
                      </select>
                      <label className="k-input">
                        Top K{" "}
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={topK}
                          onChange={(e) => setTopK(Number(e.target.value))}
                        />
                      </label>
                    </div>
                    <button
                      className="primary"
                      disabled={busy || !kb || !question.trim()}
                    >
                      {busy ? "检索与生成中…" : "提问"}
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                </form>
                <div className="section-label">
                  问答记录 <span>{history.length}</span>
                </div>
                {!history.length ? (
                  <Empty
                    text="从一个好问题开始"
                    sub="回答将附带可核验的证据。资料不足时，系统会明确说明。"
                  />
                ) : (
                  history.map((q) => (
                    <article className="answer-card" key={q.id}>
                      <div className="question-line">
                        <MessageSquare size={17} />
                        <h3>{q.question}</h3>
                      </div>
                      {q.error ? (
                        <span className="badge failed">
                          执行失败 · 已停止回答
                        </span>
                      ) : (
                        q.abstained && (
                          <span className="badge pending">
                            证据不足 · 拒绝推断
                          </span>
                        )
                      )}
                      <p className="answer-text">{renderAnswer(q, cite)}</p>
                      {q.error && <div className="inline-error">{q.error}</div>}
                      <div className="citations">
                        {q.citations?.map((ev) => (
                          <button key={ev.id} onClick={() => cite(ev)}>
                            <FileText size={13} />[
                            {q.evidence.findIndex(
                              (source) => source.id === ev.id,
                            ) + 1}
                            ] {ev.documentName}
                            <ArrowUpRight size={12} />
                          </button>
                        ))}
                      </div>
                      <div className="answer-meta">
                        <span>
                          {q.mode === "hybrid" ? "混合检索" : "向量检索"}
                        </span>
                        <span>检索 {fmt(q.retrievalMs)} ms</span>
                        <span>总计 {fmt(q.totalMs)} ms</span>
                        <span>
                          Tokens {q.promptTokens ?? "不可用"} /{" "}
                          {q.completionTokens ?? "不可用"}
                        </span>
                        <span>
                          引用格式 {q.citationValid ? "有效" : "无效"}
                        </span>
                      </div>
                      <RetrievalDiagnostics result={q} />
                      <details>
                        <summary>
                          查看本次检索证据（{q.evidence?.length || 0}）
                        </summary>
                        {q.evidence?.map((ev) => (
                          <button
                            className="evidence-row"
                            key={ev.id}
                            onClick={() => cite(ev)}
                          >
                            {ev.documentName} · 第 {ev.page} 页 / 段落{" "}
                            {ev.paragraph}
                            <ChevronRight size={15} />
                          </button>
                        ))}
                      </details>
                    </article>
                  ))
                )}
              </section>
              <aside className="guide panel">
                <div className="eyebrow">HOW IT WORKS</div>
                <h3>
                  答案之外，
                  <br />
                  还有证据。
                </h3>
                <p>先从当前知识库检索相关片段，再将证据交给模型生成回答。</p>
                <div className="guide-step">
                  01 <span>选择知识库与检索方式</span>
                </div>
                <div className="guide-step">
                  02 <span>提出具体、清晰的问题</span>
                </div>
                <div className="guide-step">
                  03 <span>点击引用，核验原文</span>
                </div>
                <small>
                  当前自建评测中向量排名更稳定，默认使用向量检索，可切换混合对比。
                  混合检索通过 RRF 融合关键词与向量结果；不是多查询 RAG Fusion。
                </small>
              </aside>
            </div>
          )}
          {page === "eval" && (
            <>
              <div className="eval-layout">
                <form className="panel eval-create" onSubmit={evaluate}>
                  <h2>创建对比评测</h2>
                  <p className="muted">
                    同一评测集将分别运行 vector 与 hybrid 配置。
                  </p>
                  <fieldset
                    className="eval-request-fields"
                    disabled={busy || Boolean(evalPending)}
                  >
                    <label>
                      评测名称
                      <input
                        value={evalName}
                        onChange={(e) => setEvalName(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      导入评测集 JSON
                      <input
                        type="file"
                        accept=".json"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f)
                            f.text()
                              .then((t) => {
                                setDataset(t);
                                setDatasetName(f.name);
                              })
                              .catch(() => setError("无法读取评测文件"));
                        }}
                      />
                    </label>
                    <div className="muted">
                      {datasetName ||
                        "选择 samples/evaluation.json 样例，或按文档格式制作评测集。"}
                    </div>
                    <details>
                      <summary>查看导入格式</summary>
                      <pre>
                        {JSON.stringify(
                          {
                            version: "v1",
                            questions: [
                              {
                                id: "q1",
                                question: "示例问题",
                                answerable: true,
                                category: "fact",
                                split: "dev",
                                group: "example-topic",
                                expectedAnswer: "预期答案",
                                evidence: [
                                  {
                                    documentName: "example.md",
                                    page: 1,
                                    paragraph: 1,
                                    quote: "原文证据",
                                    groupId: "required-fact",
                                  },
                                ],
                              },
                            ],
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                    <label>
                      返回证据数量 Top K
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={topK}
                        onChange={(e) => setTopK(Number(e.target.value))}
                      />
                    </label>
                    <RetrievalControls
                      value={retrievalOptions}
                      onChange={setRetrievalOptions}
                      topK={topK}
                      disabled={busy}
                      forEvaluation
                    />
                  </fieldset>
                  <button
                    className="primary"
                    disabled={!kb || (!dataset && !evalPending) || busy}
                  >
                    <FlaskConical size={17} />
                    {busy
                      ? "正在创建任务…"
                      : evalPending
                        ? "核对并重试创建评测"
                        : "运行向量 / 混合对比"}
                  </button>
                  <small className="muted">
                    创建请求返回任务 ID 后即可继续使用页面；进度每 2
                    秒读取，刷新不会重新提交整批评测。
                  </small>
                </form>
                <section className="panel">
                  <div className="panel-title">
                    <h2>评测记录</h2>
                    <span className="muted">{runs.length} 次</span>
                  </div>
                  {!runs.length ? (
                    <Empty
                      text="暂无评测记录"
                      sub="导入一组带证据标注的问题，观察检索质量。"
                    />
                  ) : (
                    runs.map((r) => (
                      <button
                        className={
                          "run-row " + (run?.id === r.id ? "selected" : "")
                        }
                        key={r.id}
                        onClick={() =>
                          action(async () => {
                            selectEvaluation(
                              await api<Run>(`/evaluations/${r.id}`),
                            );
                            setDetail(null);
                          })
                        }
                      >
                        <div>
                          <strong>{r.name}</strong>
                          <p>
                            {new Date(r.createdAt).toLocaleString("zh-CN")} ·{" "}
                            {r.modelMode}
                          </p>
                        </div>
                        {status(r.status)}
                        <ChevronRight size={16} />
                      </button>
                    ))
                  )}
                </section>
              </div>
              {evalPending && (
                <div className="alert" role="alert">
                  有待确认的评测创建请求。再次提交将使用原始配置和同一幂等标识，不创建第二批；请先核对状态，再更改配置。
                </div>
              )}
              {evalPollError && (
                <div className="alert" role="alert">
                  进度读取失败：{evalPollError}
                  。不会自动重新执行，可刷新页面恢复读取。
                </div>
              )}
              {run && (
                <section className="panel results">
                  <div className="panel-title">
                    <div>
                      <h2>{run.name}</h2>
                      <p className="muted">
                        {run.modelMode === "mock"
                          ? "Mock 结果仅用于验证评测流程，不得用于质量或性能结论。"
                          : "原始指标与逐题证据可导出复核。"}
                      </p>
                    </div>
                    <button onClick={exportRun}>
                      导出 JSON
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                  <div className="evaluation-task-status">
                    {status(run.taskStatus || run.status)}
                    {run.taskId && (
                      <span className="muted">任务 {run.taskId}</span>
                    )}
                    <ProgressView progress={run.progress} />
                    {runTask?.canCancel && (
                      <button
                        disabled={busy}
                        onClick={() => void evalTaskAction("cancel")}
                      >
                        取消评测
                      </button>
                    )}
                    {runTask?.canRetry && (
                      <button
                        disabled={busy}
                        onClick={() => void evalTaskAction("retry")}
                      >
                        恢复未完成评测
                      </button>
                    )}
                    {runTask?.retryBlockedReason && (
                      <p className="muted">{runTask.retryBlockedReason}</p>
                    )}
                  </div>
                  {run.partial && (
                    <p className="agent-notice">
                      部分结果：指标仅覆盖已完成项，不代表完整对比。尚未完成{" "}
                      {run.pendingItems?.length ?? "未知"}{" "}
                      个问题/模式项；未运行项不当作正确答案或零分。
                    </p>
                  )}
                  {run.error && <div className="alert">{run.error}</div>}
                  {run.config?.retrievalOptions && (
                    <p className="run-retrieval-config">
                      本次统一配置：候选{" "}
                      {run.config.retrievalOptions.candidateK} · 关键词权重{" "}
                      {run.config.retrievalOptions.keywordWeight}（向量权重 1）
                      · 重排{" "}
                      {run.config.retrievalOptions.rerank ? "开启" : "关闭"} ·
                      引用 {run.config.retrievalOptions.citationStyle}
                    </p>
                  )}
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>检索配置</th>
                          <th>Recall@K</th>
                          <th>MRR</th>
                          <th>检索均值 (ms)</th>
                          <th>端到端均值 (ms)</th>
                          <th>样本数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(run.summary || {}).map(([m, s]) => (
                          <tr key={m}>
                            <td>
                              <strong>
                                {m === "hybrid" ? "混合检索 · RRF" : "向量检索"}
                              </strong>
                            </td>
                            <td>{fmt(s.recallAtK)}</td>
                            <td>{fmt(s.mrr)}</td>
                            <td>{fmt(s.retrievalMs)}</td>
                            <td>{fmt(s.totalMs)}</td>
                            <td>{s.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="metric-note">
                    Recall@K：命中证据组数 /
                    全部必需组数（同组可替代）；MRR：首个命中任一组结果的倒数排名。引用格式有效不等于答案正确。详细统计口径见
                    EVALUATION.md。
                  </p>
                  <details>
                    <summary>查看可复现配置</summary>
                    <pre>{JSON.stringify(run.config, null, 2)}</pre>
                  </details>
                  <EvaluationAnalysis
                    key={run.id}
                    run={run}
                    onSelect={setDetail}
                  />
                </section>
              )}
            </>
          )}
        </div>
        <footer>
          CiteBase 知据 <span>让知识可检索，让答案可验证。</span>
        </footer>
      </main>
      {versionDocument && (
        <DocumentVersions
          document={
            docs.find((document) => document.id === versionDocument.id) ||
            versionDocument
          }
          load={(id) => api<DocumentVersion[]>(`/documents/${id}/versions`)}
          onClose={() => setVersionDocument(null)}
        />
      )}
      {evidence && (
        <div className="drawer-backdrop" onClick={() => setEvidence(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">
              <div className="eyebrow">SOURCE EVIDENCE</div>
              <button
                className="icon"
                aria-label="关闭证据"
                onClick={() => setEvidence(null)}
              >
                <X />
              </button>
            </div>
            <h2>{evidence.documentName}</h2>
            <div className="evidence-location">
              第 {evidence.page} 页 · 段落 {evidence.paragraph}
              <br />
              字符区间 {evidence.startOffset}–{evidence.endOffset}
            </div>
            <div className="source-text">{evidence.text}</div>
            <small className="muted">
              仅展示你有权限访问的证据：{evidenceContext}。
            </small>
          </aside>
        </div>
      )}
      {detail && (
        <div className="drawer-backdrop" onClick={() => setDetail(null)}>
          <aside className="drawer wide" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">
              <div className="eyebrow">EVALUATION CASE / {detail.mode}</div>
              <button
                className="icon"
                aria-label="关闭问题详情"
                onClick={() => setDetail(null)}
              >
                <X />
              </button>
            </div>
            <h2>{detail.question}</h2>
            <h3>预期答案</h3>
            <p className="source-text">
              {detail.expectedAnswer || "无预期答案"}
            </p>
            <h3>实际回答</h3>
            <p className="source-text">
              {renderAnswer(detail, (source) => {
                setDetail(null);
                setEvidenceContext("本次评测快照版本，文档仍须允许访问");
                if (run)
                  void action(async () =>
                    setEvidence(
                      await api<Evidence>(
                        `/evaluations/${run.id}/citations/${source.id}`,
                      ),
                    ),
                  );
              })}
            </p>
            {detail.error && <div className="alert">{detail.error}</div>}
            <RetrievalDiagnostics result={detail} />
            <p className="muted">
              Recall@K {fmt(detail.recallAtK)} · MRR {fmt(detail.mrr)} ·{" "}
              {detail.answerable ? "可回答" : "不可回答"}
            </p>
            {run && (
              <EvaluationReview
                key={`${run.id}-${detail.caseId}-${detail.mode}`}
                result={detail}
                run={run}
                onScore={async (score) => {
                  const saved = await api<ManualScore>(
                    `/evaluations/${run.id}/scores`,
                    { method: "POST", body: JSON.stringify(score) },
                  );
                  const next: Run = {
                    ...run,
                    manualScores: [...(run.manualScores || []), saved],
                    results: run.results?.map((row) =>
                      row.caseId === saved.caseId && row.mode === saved.mode
                        ? { ...row, manualScore: saved }
                        : row,
                    ),
                  };
                  setRun(next);
                  setDetail({ ...detail, manualScore: saved });
                }}
              />
            )}
            <h3>检索证据</h3>
            {detail.evidence?.map((ev) => (
              <div className="case-evidence" key={ev.id}>
                <strong>{ev.documentName}</strong>
                <small>
                  第 {ev.page} 页 · 段落 {ev.paragraph}
                </small>
                <p>{ev.text}</p>
              </div>
            ))}
            <h3>实际引用</h3>
            {detail.citations?.map((ev) => (
              <div className="case-evidence" key={ev.id}>
                <strong>{ev.documentName}</strong>
                <p>{ev.text}</p>
              </div>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}
function renderAnswer(result: QA, onCite: (source: Evidence) => void) {
  return result.answer.split(/(\[[^\[\]\r\n]+\])/g).map((part, index) => {
    const id = part.startsWith("[") ? part.slice(1, -1) : "";
    const source = result.citations?.find((item) => item.id === id);
    if (!source) return part;
    const number = result.evidence.findIndex((item) => item.id === id) + 1;
    return (
      <button
        className="inline-citation"
        key={index}
        onClick={() => onCite(source)}
        aria-label={`查看引用 ${number}：${source.documentName}`}
        title={source.documentName}
      >
        [{number}]
      </button>
    );
  });
}
function Empty({ text, sub }: { text: string; sub: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <BookOpen size={25} />
      </div>
      <h3>{text}</h3>
      <p>{sub}</p>
    </div>
  );
}
