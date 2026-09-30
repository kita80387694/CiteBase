import { useEffect, useRef, useState } from "react";
import {
  ScoreForm,
  reviewFields,
  type ReviewScoreInput,
} from "./ReviewScoreForm";
type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type Source = {
  kind: "EVALUATION" | "AGENT";
  runId: string;
  caseId?: string;
  mode?: string;
};
type Project = {
  id: string;
  name: string;
  ruleVersion: string;
  createdAt: string;
};
type Assignment = {
  id: string;
  projectName: string;
  ruleVersion: string;
  status: string;
  scored: boolean;
  ordinal: number;
};
type Score = {
  id: string;
  itemId?: string;
  assignmentId?: string;
  scoredBy?: string;
  kind?: string;
  payload: ReviewScoreInput;
  createdAt: string;
};
type Detail = Project & {
  items: { id: string; source: Source; status: string; modelMode: string }[];
  assignments: {
    id: string;
    itemId: string;
    username: string;
    revoked: boolean;
    ordinal: number;
  }[];
  scores: Score[];
  stats: {
    items: number;
    assignments: number;
    scoredAssignments: number;
    doubleReviewedItems: number;
    disputedItems: number;
    agreement: number | null;
  };
};
type Packet = {
  id: string;
  projectName: string;
  ruleVersion: string;
  question: string;
  answer: string;
  status: string;
  executionFailed: boolean;
  referenceAnswer?: string | null;
  answerable?: boolean | null;
  expectedEvidence?: {
    documentName: string;
    page: number;
    paragraph: number;
    quote: string;
    group: string;
  }[];
  evidence: {
    label: string;
    documentName: string;
    page: number;
    paragraph: number;
    text: string;
  }[];
  citations: string[];
  latestScore: Score | null;
  history: Score[];
};
type Candidate = {
  id: string;
  name?: string;
  question?: string;
  status: string;
  modelMode?: string;
};
const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});
function download(data: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function ScoreHistory({ scores }: { scores: Score[] }) {
  return (
    <div className="review-history">
      {scores.length === 0 ? (
        <p className="muted">尚未发生人工评分。</p>
      ) : (
        scores.map((score) => (
          <article key={score.id}>
            <strong>
              {score.kind || "人工评分"} · {score.scoredBy || "当前评审者"}
            </strong>
            <small>{score.createdAt}</small>
            <dl>
              {reviewFields.map((field) => (
                <div key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>
                    {field.options.find(
                      ([value]) => value === score.payload[field.key],
                    )?.[1] || "未评分"}
                  </dd>
                </div>
              ))}
            </dl>
            <p>{score.payload.rationale}</p>
          </article>
        ))
      )}
    </div>
  );
}
function ReferenceEvidence({ packet }: { packet: Packet }) {
  return (
    <section className="review-reference">
      <p>
        资料可回答性：
        {packet.answerable == null
          ? "未标注"
          : packet.answerable
            ? "可回答"
            : "不可回答"}
      </p>
      <p className="muted">
        标注证据：同组片段可以替代，不同组为必需证据。请与答案实际引用逐条比较。
      </p>
      {(packet.expectedEvidence || []).map((e, i) => (
        <details key={i}>
          <summary>
            {e.group} · {e.documentName} · 页 {e.page} / 段 {e.paragraph}
          </summary>
          <p className="review-answer">{e.quote}</p>
        </details>
      ))}
    </section>
  );
}
export function ReviewPanel({ api, kbId }: { api: Api; kbId: string }) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const generation = useRef(0);
  const [sourceRefresh, setSourceRefresh] = useState(0),
    [sourceLoading, setSourceLoading] = useState(false);
  const [tab, setTab] = useState<"reviewer" | "owner">("reviewer"),
    [projects, setProjects] = useState<Project[]>([]),
    [assignments, setAssignments] = useState<Assignment[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null),
    [packet, setPacket] = useState<Packet | null>(null);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [name, setName] = useState(""),
    [ruleVersion, setRuleVersion] = useState("quality-v1"),
    [sources, setSources] = useState<Source[]>([]),
    [kind, setKind] = useState<Source["kind"]>("EVALUATION"),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [candidateId, setCandidateId] = useState("");
  const [usernames, setUsernames] = useState(""),
    [percent, setPercent] = useState(20),
    [seed, setSeed] = useState(20260930),
    [filter, setFilter] = useState("all"),
    [adjudicate, setAdjudicate] = useState(""),
    [adjudicationPacket, setAdjudicationPacket] = useState<Packet | null>(null);
  async function refresh() {
    const gen = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const [p, a] = await Promise.all([
        apiRef.current<Project[]>("/reviews/projects"),
        apiRef.current<Assignment[]>("/reviews/assignments"),
      ]);
      if (gen === generation.current) {
        setProjects(p);
        setAssignments(a);
        if (
          packet &&
          !a.some((row) => row.id === packet.id && row.status === "AVAILABLE")
        )
          setPacket(null);
      }
    } catch (e) {
      if (gen === generation.current)
        setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setCandidates([]);
    setCandidateId("");
    if (tab !== "owner" || (kind === "AGENT" && !kbId)) {
      setSourceLoading(false);
      return;
    }
    setSourceLoading(true);
    apiRef
      .current<Candidate[]>(
        kind === "EVALUATION"
          ? "/evaluations"
          : `/agent-runs?kbId=${encodeURIComponent(kbId)}`,
      )
      .then((rows) => {
        if (!cancelled)
          setCandidates(
            rows.filter(
              (row) =>
                ![
                  "QUEUED",
                  "CREATED",
                  "RUNNING",
                  "PROCESSING",
                  "RETRY_WAIT",
                  "CANCEL_REQUESTED",
                ].includes(row.status),
            ),
          );
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, kind, kbId, sourceRefresh]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  async function openProject(id: string) {
    setPacket(null);
    setAdjudicate("");
    setDetail(await apiRef.current<Detail>(`/reviews/projects/${id}`));
  }
  async function openPacket(id: string) {
    setPacket(null);
    setDetail(null);
    setPacket(await apiRef.current<Packet>(`/reviews/assignments/${id}`));
  }
  const visible = assignments.filter(
    (a) =>
      filter === "all" ||
      (filter === "pending"
        ? !a.scored && a.status === "AVAILABLE"
        : filter === "scored"
          ? a.scored
          : a.status === "WITHDRAWN"),
  );
  return (
    <section className="review-workspace">
      <div className="actions">
        <button
          className={tab === "reviewer" ? "primary" : ""}
          onClick={() => {
            setTab("reviewer");
            setDetail(null);
          }}
        >
          我的盲评任务
        </button>
        <button
          className={tab === "owner" ? "primary" : ""}
          onClick={() => {
            setTab("owner");
            setPacket(null);
          }}
        >
          管理评审项目
        </button>
        <button
          disabled={loading || busy}
          onClick={() =>
            void action(async () => {
              await refresh();
              if (detail) await openProject(detail.id);
              if (packet) await openPacket(packet.id);
            })
          }
        >
          刷新评审数据
        </button>
      </div>
      <p className="muted">
        人工评分由实际登录评审者提交。自动测试中的评分仅验证流程，不能计入真人评审数量。
      </p>
      {error && (
        <div role="alert" className="alert">
          {error}
          <button
            disabled={busy || loading}
            onClick={() =>
              void action(async () => {
                await refresh();
                if (detail) await openProject(detail.id);
                if (packet) await openPacket(packet.id);
              })
            }
          >
            重试加载
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {loading && <p role="status">正在加载评审任务…</p>}
      {tab === "reviewer" && (
        <div className="review-layout">
          <section className="panel review-list">
            <h2>已分配答案</h2>
            <label>
              任务筛选
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="all">全部</option>
                <option value="pending">待评分</option>
                <option value="scored">已评分</option>
                <option value="withdrawn">已撤回</option>
              </select>
            </label>
            {!loading && visible.length === 0 && (
              <p className="empty">
                暂无符合条件的任务。请项目负责人分配评审权限。
              </p>
            )}
            {visible.map((a) => (
              <button
                key={a.id}
                disabled={busy}
                className="review-list-item"
                onClick={() => void action(() => openPacket(a.id))}
              >
                <strong>
                  {a.projectName} · 答案 {a.ordinal + 1}
                </strong>
                <span>
                  {a.status === "WITHDRAWN"
                    ? "已撤回"
                    : a.scored
                      ? "已评分"
                      : "待评分"}{" "}
                  · 规则 {a.ruleVersion}
                </span>
              </button>
            ))}
          </section>
          <section className="panel review-content">
            {!packet ? (
              <p className="empty">选择一份匿名答案开始评审。</p>
            ) : (
              <>
                <h2>{packet.projectName} · 匿名答案</h2>
                <p>评分规则：{packet.ruleVersion}</p>
                {packet.status !== "AVAILABLE" ? (
                  <p className="alert">
                    此答案已撤回，证据不可访问，也不能继续评分。
                  </p>
                ) : (
                  <>
                    <h3>问题</h3>
                    <p>{packet.question}</p>
                    <h3>参考答案要点</h3>
                    <p className="review-answer">
                      {packet.referenceAnswer ||
                        "未提供参考答案；请依据证据人工核验，不能自动认定正确。"}
                    </p>
                    <ReferenceEvidence packet={packet} />
                    <h3>待评答案</h3>
                    {packet.executionFailed && (
                      <p className="alert">
                        该次执行失败。请根据实际输出评价，不将失败当作正确回答。
                      </p>
                    )}
                    <div className="review-answer">
                      {packet.answer || "（无答案输出）"}
                    </div>
                    <h3>引用与证据</h3>
                    <p>
                      引用：
                      {packet.citations.length
                        ? packet.citations.join("、")
                        : "无引用"}
                    </p>
                    {packet.evidence.length === 0 && (
                      <p className="muted">没有可展示的证据。</p>
                    )}
                    {packet.evidence.map((e) => (
                      <details key={e.label} open>
                        <summary>
                          {e.label} · {e.documentName} · 第 {e.page} 页 / 段落{" "}
                          {e.paragraph}
                        </summary>
                        <p className="review-answer">{e.text}</p>
                      </details>
                    ))}
                    <ScoreForm
                      key={packet.id}
                      disabled={busy}
                      onSave={async (score) => {
                        await apiRef.current(
                          `/reviews/assignments/${packet.id}/scores`,
                          post(score),
                        );
                        await openPacket(packet.id);
                        await refresh();
                        setNotice("评分已保存，修改历史保留。");
                      }}
                    />
                  </>
                )}
                <div className="actions">
                  <button
                    disabled={busy || packet.status !== "AVAILABLE"}
                    onClick={() =>
                      download(
                        {
                          assignmentId: packet.id,
                          ruleVersion: packet.ruleVersion,
                          question: packet.question,
                          answer: packet.answer,
                          evidence: packet.evidence,
                          citations: packet.citations,
                          history: packet.history,
                          referenceAnswer: packet.referenceAnswer,
                          answerable: packet.answerable,
                          expectedEvidence: packet.expectedEvidence,
                        },
                        `blind-review-${packet.id}.json`,
                      )
                    }
                  >
                    导出匿名评审包
                  </button>
                  <label className="review-import">
                    导入本人评分 JSON
                    <input
                      type="file"
                      accept=".json"
                      aria-label="导入本人评分 JSON"
                      disabled={busy || packet.status !== "AVAILABLE"}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file)
                          void action(async () => {
                            await apiRef.current(
                              "/reviews/scores/import",
                              post(JSON.parse(await file.text())),
                            );
                            await openPacket(packet.id);
                            await refresh();
                            setNotice("本人评分导入完成。");
                          });
                      }}
                    />
                  </label>
                </div>
                <h3>我的评分历史</h3>
                {packet.status === "AVAILABLE" ? (
                  <ScoreHistory scores={packet.history || []} />
                ) : (
                  <p className="muted">
                    内容撤回后不再展示历史评分；原始审计记录保留。
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
      {tab === "owner" && (
        <>
          <section className="panel review-content">
            <h2>新建评审项目</h2>
            <p className="muted">
              评测源展开为逐题答案；Agent源每次执行一份答案。配置标识仅负责人可见。MOCK源只用于流程测试。
            </p>
            <div className="review-score-grid">
              <label>
                评审项目名称
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                评分规则版本
                <input
                  value={ruleVersion}
                  onChange={(e) => setRuleVersion(e.target.value)}
                />
              </label>
              <label>
                来源类型
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Source["kind"])}
                >
                  <option value="EVALUATION">评测结果</option>
                  <option value="AGENT">Agent执行</option>
                </select>
              </label>
              <label>
                选择已完成来源
                <select
                  value={candidateId}
                  onChange={(e) => setCandidateId(e.target.value)}
                >
                  <option value="">请选择</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.question || c.id} · {c.status} ·{" "}
                      {c.modelMode || "模式请在项目中核验"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="actions">
              <button
                disabled={
                  !candidateId ||
                  busy ||
                  sources.some(
                    (s) => s.kind === kind && s.runId === candidateId,
                  )
                }
                onClick={() =>
                  setSources([...sources, { kind, runId: candidateId }])
                }
              >
                添加来源
              </button>
              <button
                className="primary"
                disabled={
                  !name.trim() ||
                  !ruleVersion.trim() ||
                  sources.length === 0 ||
                  busy
                }
                onClick={() =>
                  void action(async () => {
                    const p = await apiRef.current<Project>(
                      "/reviews/projects",
                      post({
                        name: name.trim(),
                        ruleVersion: ruleVersion.trim(),
                        sources,
                      }),
                    );
                    setSources([]);
                    setName("");
                    await refresh();
                    await openProject(p.id);
                    setNotice("评审项目已创建，请分配实际评审者。");
                  })
                }
              >
                创建评审项目
              </button>
            </div>
            <p className="muted">
              {sourceLoading
                ? "正在加载已完成来源…"
                : candidates.length === 0
                  ? "暂无可用来源。请先完成评测；选择Agent时需先选择知识库。"
                  : `可选来源 ${candidates.length} 个。`}
            </p>
            <button
              disabled={busy || sourceLoading}
              onClick={() => setSourceRefresh((value) => value + 1)}
            >
              重新加载来源
            </button>
            {sources.map((s, i) => (
              <p key={`${s.kind}-${s.runId}`} className="review-source">
                {s.kind} · {s.runId}
                <button
                  disabled={busy}
                  onClick={() =>
                    setSources(sources.filter((_, index) => index !== i))
                  }
                >
                  移除来源 {i + 1}
                </button>
              </p>
            ))}
          </section>
          <div className="review-layout">
            <section className="panel review-list">
              <h2>我的评审项目</h2>
              {!loading && projects.length === 0 && (
                <p className="empty">尚未创建项目。</p>
              )}
              {projects.map((p) => (
                <button
                  className="review-list-item"
                  disabled={busy}
                  key={p.id}
                  onClick={() => void action(() => openProject(p.id))}
                >
                  <strong>{p.name}</strong>
                  <span>
                    {p.ruleVersion} · {p.createdAt}
                  </span>
                </button>
              ))}
            </section>
            <section className="panel review-content">
              {!detail ? (
                <p className="empty">选择项目管理分配、进度和争议。</p>
              ) : (
                <>
                  <h2>{detail.name}</h2>
                  <div className="review-summary">
                    答案 {detail.stats.items} · 分配 {detail.stats.assignments}{" "}
                    · 已评分 {detail.stats.scoredAssignments} · 双评答案{" "}
                    {detail.stats.doubleReviewedItems} · 争议{" "}
                    {detail.stats.disputedItems} · 一致率{" "}
                    {detail.stats.agreement == null
                      ? "不可用"
                      : `${(detail.stats.agreement * 100).toFixed(1)}%`}
                  </div>
                  <div className="review-score-grid">
                    <label>
                      评审者用户名
                      <input
                        placeholder="用逗号分隔现有账号"
                        value={usernames}
                        onChange={(e) => setUsernames(e.target.value)}
                      />
                    </label>
                    <label>
                      双人复核比例（%）
                      <input
                        type="number"
                        min="20"
                        max="100"
                        value={percent}
                        onChange={(e) => setPercent(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      展示顺序随机种子
                      <input
                        type="number"
                        value={seed}
                        onChange={(e) => setSeed(Number(e.target.value))}
                      />
                    </label>
                  </div>
                  <button
                    disabled={busy || !usernames.trim()}
                    onClick={() =>
                      void action(async () => {
                        await apiRef.current(
                          `/reviews/projects/${detail.id}/assign`,
                          post({
                            usernames: usernames
                              .split(/[,，\s]+/)
                              .filter(Boolean),
                            secondReviewPercent: percent,
                            seed,
                          }),
                        );
                        await openProject(detail.id);
                        await refresh();
                        setNotice(
                          "分配已保存。邀请允许评审者读取被分配答案及其证据。",
                        );
                      })
                    }
                  >
                    分配评审任务
                  </button>
                  <p className="muted">
                    分配会授予指定现有用户访问所分配答案及证据的权限；撤销后立即停止访问。
                  </p>
                  <div className="actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () =>
                          download(
                            await apiRef.current(
                              `/reviews/projects/${detail.id}/export`,
                            ),
                            `review-${detail.id}.json`,
                          ),
                        )
                      }
                    >
                      导出评审 JSON
                    </button>
                    <label className="review-import">
                      导入本人评分 JSON
                      <input
                        type="file"
                        accept=".json"
                        aria-label="导入本人评分 JSON"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file)
                            void action(async () => {
                              await apiRef.current(
                                "/reviews/scores/import",
                                post(JSON.parse(await file.text())),
                              );
                              await openProject(detail.id);
                              await refresh();
                              setNotice(
                                "评分导入完成；服务端校验当前用户的分配权限。",
                              );
                            });
                        }}
                      />
                    </label>
                  </div>
                  <h3>评审者权限</h3>
                  {[
                    ...new Set(
                      detail.assignments
                        .filter((a) => !a.revoked)
                        .map((a) => a.username),
                    ),
                  ].map((username) => (
                    <p className="review-source" key={username}>
                      {username}
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await apiRef.current(
                              `/reviews/projects/${detail.id}/revoke`,
                              post({ username }),
                            );
                            await openProject(detail.id);
                            await refresh();
                            setNotice(`已撤销 ${username} 的评审访问权限。`);
                          })
                        }
                      >
                        撤销 {username}
                      </button>
                    </p>
                  ))}
                  <h3>答案映射与争议复核</h3>
                  {detail.items.map((item) => (
                    <details key={item.id} data-review-item={item.id}>
                      <summary>
                        {item.source.kind} ·{" "}
                        {item.source.caseId || item.source.runId} ·{" "}
                        {item.source.mode || "单次执行"} · {item.modelMode} ·{" "}
                        {item.status}
                      </summary>
                      <ScoreHistory
                        scores={detail.scores.filter(
                          (score) => score.itemId === item.id,
                        )}
                      />
                      <button
                        disabled={busy || item.status === "WITHDRAWN"}
                        onClick={() =>
                          void action(async () => {
                            if (adjudicate === item.id) {
                              setAdjudicate("");
                              setAdjudicationPacket(null);
                            } else {
                              setAdjudicationPacket(
                                await apiRef.current<Packet>(
                                  `/reviews/projects/${detail.id}/items/${item.id}`,
                                ),
                              );
                              setAdjudicate(item.id);
                            }
                          })
                        }
                      >
                        复核此答案
                      </button>
                      {adjudicate === item.id && adjudicationPacket && (
                        <>
                          <h4>问题</h4>
                          <p>{adjudicationPacket.question}</p>
                          <h4>参考要点</h4>
                          <p>
                            {adjudicationPacket.referenceAnswer ||
                              "未提供参考答案，请依据证据核验。"}
                          </p>
                          <ReferenceEvidence packet={adjudicationPacket} />
                          <h4>答案</h4>
                          <p className="review-answer">
                            {adjudicationPacket.answer}
                          </p>
                          {(adjudicationPacket.evidence || []).map((e) => (
                            <div key={e.label}>
                              <strong>
                                {e.label} · {e.documentName} · 页 {e.page} / 段{" "}
                                {e.paragraph}
                              </strong>
                              <p className="review-answer">{e.text}</p>
                            </div>
                          ))}
                          <ScoreForm
                            key={item.id}
                            label="保存争议裁决"
                            disabled={busy}
                            onSave={async (score) => {
                              await apiRef.current(
                                `/reviews/projects/${detail.id}/adjudications`,
                                post({ itemId: item.id, ...score }),
                              );
                              await openProject(detail.id);
                              setNotice("裁决已保存，原始评分不变。");
                            }}
                          />
                        </>
                      )}
                    </details>
                  ))}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
