import { useEffect, useState, type FormEvent } from "react";
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
};
type Task = {
  id: string;
  documentId: string;
  documentName: string;
  status: string;
  attempts: number;
  error?: string;
};
type Evidence = {
  id: string;
  documentName: string;
  page: number;
  paragraph: number;
  startOffset: number;
  endOffset: number;
  text: string;
  score: number;
};
type QA = {
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
type Result = QA & {
  caseId: string;
  answerable: boolean;
  expectedAnswer?: string;
  recallAtK?: number;
  mrr?: number;
  evidenceHit: boolean;
  answerCorrect?: boolean;
  referenceAnswerMatch?: boolean;
  abstentionCorrect?: boolean;
};
type Metric = {
  recallAtK: number;
  mrr: number;
  retrievalMs: number;
  totalMs: number;
  count: number;
};
type Run = {
  id: string;
  name: string;
  status: string;
  modelMode: string;
  config: unknown;
  summary?: Record<string, Metric>;
  results?: Result[];
  error?: string;
  createdAt: string;
};
const labels: Record<string, string> = {
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
    [tasks, setTasks] = useState<Task[]>([]),
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
      throw new Error(message);
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
  async function refresh() {
    setLoading(true);
    try {
      const [bases, ts, rs] = await Promise.all([
        api<KB[]>("/knowledge-bases"),
        api<Task[]>("/tasks"),
        api<Run[]>("/evaluations"),
      ]);
      setKbs(bases);
      setTasks(ts);
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
        setDocs(ds);
        setHistory(hs);
      }
    } finally {
      setLoading(false);
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
      const form = new FormData();
      form.append("file", file);
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
        body: JSON.stringify({ kbId: kb, question, mode, topK }),
      });
      setHistory((h) => [result, ...h]);
      setQuestion("");
    });
  }
  async function evaluate(e: FormEvent) {
    e.preventDefault();
    await action(async () => {
      let data;
      try {
        data = JSON.parse(dataset);
      } catch {
        throw new Error("评测集不是有效 JSON，请检查文件格式。");
      }
      const result = await api<Run>("/evaluations", {
        method: "POST",
        body: JSON.stringify({ kbId: kb, name: evalName, dataset: data, topK }),
      });
      setRun(result);
      await refresh();
    });
  }
  async function exportRun() {
    if (!run) return;
    await action(async () => {
      const data = await api(`/evaluations/${run.id}/export`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `citebase-${run.id}.json`;
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
                disabled={busy}
                onClick={() => {
                  const name = prompt("新知识库名称");
                  if (name?.trim())
                    action(async () => {
                      const b = await api<KB>("/knowledge-bases", {
                        method: "POST",
                        body: JSON.stringify({ name: name.trim() }),
                      });
                      await refresh();
                      setKb(b.id);
                    });
                }}
              >
                <Plus size={17} />
                新建知识库
              </button>
            )}
          </div>
          {page !== "tasks" && (
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
          )}
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
                              </td>
                              <td>
                                <div className="actions">
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
            <section className="panel">
              <div className="panel-title">
                <h2>索引任务</h2>
                <span className="muted">每 8 秒自动刷新</span>
              </div>
              {!tasks.length ? (
                <Empty
                  text="暂无处理任务"
                  sub="上传文档后，可以在这里追踪解析、向量化和入库。"
                />
              ) : (
                <div className="task-list">
                  {tasks.map((t) => (
                    <div className="task" key={t.id}>
                      <FileText size={22} />
                      <div className="grow">
                        <strong>{t.documentName}</strong>
                        <p className="muted">
                          任务 {t.id.slice(0, 8)} · 已尝试 {t.attempts} 次
                        </p>
                        {t.error && (
                          <div className="inline-error">{t.error}</div>
                        )}
                      </div>
                      {status(t.status)}
                      {t.status === "FAILED" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            action(async () => {
                              await api(`/tasks/${t.id}/retry`, {
                                method: "POST",
                              });
                              await refresh();
                            })
                          }
                        >
                          <RefreshCw size={15} />
                          重试
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {page === "chat" && (
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
                      {q.abstained && (
                        <span className="badge pending">
                          证据不足 · 拒绝推断
                        </span>
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
                              expectedAnswer: "预期答案",
                              evidence: [
                                {
                                  documentName: "example.md",
                                  page: 1,
                                  paragraph: 1,
                                  quote: "原文证据",
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
                  <button
                    className="primary"
                    disabled={!kb || !dataset || busy}
                  >
                    <FlaskConical size={17} />
                    {busy ? "正在运行，请稍候…" : "运行向量 / 混合对比"}
                  </button>
                  <small className="muted">
                    评测可能耗时较长。任务持久化后可从右侧历史列表查看状态。
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
                            setRun(await api<Run>(`/evaluations/${r.id}`));
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
                  {run.error && <div className="alert">{run.error}</div>}
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
                    Recall@K：相关标注证据的召回比例；MRR：首个相关结果倒数排名。引用格式有效不等于答案正确。详细统计口径见
                    EVALUATION.md。
                  </p>
                  <details>
                    <summary>查看可复现配置</summary>
                    <pre>{JSON.stringify(run.config, null, 2)}</pre>
                  </details>
                  <div className="section-label">逐题结果 · 点击查看证据</div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>问题 / 配置</th>
                          <th>证据命中</th>
                          <th>引用格式</th>
                          <th>答案判定</th>
                          <th>耗时</th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.results?.map((r, i) => (
                          <tr
                            key={i}
                            className="clickable"
                            onClick={() => setDetail(r)}
                          >
                            <td>
                              <button
                                className="question-button"
                                onClick={() => setDetail(r)}
                              >
                                {r.question}
                              </button>
                              <small className="muted">
                                {r.caseId} · {r.mode}
                              </small>
                            </td>
                            <td>{r.evidenceHit ? "命中" : "未命中"}</td>
                            <td>{r.citationValid ? "有效" : "无效"}</td>
                            <td>
                              {r.answerCorrect == null
                                ? "未评分"
                                : r.answerCorrect
                                  ? "通过"
                                  : "未通过"}
                            </td>
                            <td>{fmt(r.totalMs)} ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
        <footer>
          CiteBase 知据 <span>让知识可检索，让答案可验证。</span>
        </footer>
      </main>
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
              仅展示你有权限访问的当前有效文档版本。
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
                void cite(source);
              })}
            </p>
            {detail.error && <div className="alert">{detail.error}</div>}
            <p className="muted">
              Recall@K {fmt(detail.recallAtK)} · MRR {fmt(detail.mrr)} ·{" "}
              {detail.answerable ? "可回答" : "不可回答"}
            </p>
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
