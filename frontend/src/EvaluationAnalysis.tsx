import { useState, type FormEvent } from "react";
import type { Result, Run } from "./App";

export type EvidenceLabel = {
  documentName: string;
  quote: string;
  page?: number;
  paragraph?: number;
  startOffset?: number;
  endOffset?: number;
  sourceHash?: string;
  groupId?: string;
};
export type ManualScore = {
  id: string;
  caseId: string;
  mode: string;
  answerCorrect: boolean;
  citationSupported: boolean | null;
  errorCategories: string[];
  source: string;
  rationale: string;
  ruleVersion: string;
  scoredAt: string;
  scoredBy: string;
};
export type ScoreInput = Pick<
  ManualScore,
  | "caseId"
  | "mode"
  | "answerCorrect"
  | "citationSupported"
  | "errorCategories"
  | "rationale"
  | "ruleVersion"
> & { source: "human" };
const verdict = (
  value: boolean | null | undefined,
  yes: string,
  no: string,
  unknown = "未评估",
) => (value == null ? unknown : value ? yes : no);
const decimal = (value: number | null | undefined) =>
  value == null ? "不可用" : value.toFixed(3);
const dimensionNames: Record<string, string> = {
  category: "题型",
  split: "数据划分",
  group: "题组",
  topic: "主题",
};
const errorLabels: Record<string, string> = {
  retrieval_miss: "检索未命中",
  ranking_poor: "排名不佳",
  unsupported_answer: "答案缺少支持",
  contradiction: "答案与证据矛盾",
  unsupported_citation: "引用不支持结论",
  correct_abstention: "正确拒答",
  incorrect_abstention: "错误拒答",
};

export function EvaluationAnalysis({
  run,
  onSelect,
}: {
  run: Run;
  onSelect: (result: Result) => void;
}) {
  const [category, setCategory] = useState("");
  const [split, setSplit] = useState("");
  const [mode, setMode] = useState("");
  const [filter, setFilter] = useState("");
  const [dimension, setDimension] = useState("category");
  const rows = run.results || [];
  const values = (key: "category" | "split") =>
    [
      ...new Set(
        rows.map((row) => row[key]).filter((value): value is string => !!value),
      ),
    ].sort();
  const filtered = rows.filter(
    (row) =>
      (!category || row.category === category) &&
      (!split || row.split === split) &&
      (!mode || row.mode === mode) &&
      (!filter ||
        (filter === "error" && !!row.error) ||
        (filter === "missing" &&
          row.answerable &&
          (row.allEvidenceHit === false || row.evidenceHit === false)) ||
        (filter === "unscored" && !row.manualScore) ||
        (filter === "incorrect" && row.manualScore?.answerCorrect === false) ||
        (filter === "citation" && row.citationValid === false) ||
        row.manualScore?.errorCategories?.includes(filter)),
  );
  const breakdown = run.breakdowns?.[dimension];
  return (
    <div className="evaluation-analysis">
      <div className="analysis-notice">
        自动引用格式、证据命中与人工答案正确性分别记录。参考答案字符串匹配不代表答案正确；没有评分时保持「未评分」。
      </div>
      {run.breakdowns && (
        <details className="breakdown-panel">
          <summary>分组统计 · 按题型 / 数据划分 / 题组 / 主题</summary>
          <label>
            统计维度
            <select
              value={dimension}
              onChange={(e) => setDimension(e.target.value)}
            >
              {Object.entries(dimensionNames).map(([key, name]) => (
                <option value={key} key={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {breakdown && Object.keys(breakdown).length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>分组</th>
                    <th>检索配置</th>
                    <th>Recall@K</th>
                    <th>MRR</th>
                    <th>样本数</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(breakdown).flatMap(([group, modes]) =>
                    Object.entries(modes).map(([m, metric]) => (
                      <tr key={`${group}-${m}`}>
                        <td>{group}</td>
                        <td>{m}</td>
                        <td>{decimal(metric.recallAtK)}</td>
                        <td>{decimal(metric.mrr)}</td>
                        <td>{metric.count}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">当前结果没有该维度的分组统计。</p>
          )}
        </details>
      )}
      <div className="section-label">
        逐题结果 · {filtered.length} / {rows.length} 条 · 点击查看证据和人工评分
      </div>
      <div className="result-filters">
        <label>
          题型筛选
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">全部题型</option>
            {values("category").map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          数据划分筛选
          <select value={split} onChange={(e) => setSplit(e.target.value)}>
            <option value="">全部划分</option>
            {values("split").map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          检索配置筛选
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">全部配置</option>
            <option value="vector">向量检索</option>
            <option value="hybrid">混合检索</option>
          </select>
        </label>
        <label>
          错误与评分筛选
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">全部结果</option>
            <option value="error">执行失败</option>
            <option value="missing">必需证据未齐</option>
            <option value="citation">引用格式无效</option>
            <option value="unscored">尚未人工评分</option>
            <option value="incorrect">人工判定错误</option>
            {Object.entries(errorLabels).map(([value, label]) => (
              <option key={value} value={value}>
                人工标签：{label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!filtered.length ? (
        <p className="filter-empty" role="status">
          没有符合筛选条件的问题。可调整筛选后重试。
        </p>
      ) : (
        <div className="table-scroll">
          <table className="question-results">
            <thead>
              <tr>
                <th>问题 / 分类</th>
                <th>证据命中</th>
                <th>引用格式</th>
                <th>引用支持</th>
                <th>答案正确性</th>
                <th>失败原因 / 耗时</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={`${row.caseId}-${row.mode}`}
                  className="clickable"
                  onClick={() => onSelect(row)}
                >
                  <td>
                    <button
                      className="question-button"
                      onClick={() => onSelect(row)}
                    >
                      {row.question}
                    </button>
                    <small className="muted">
                      {row.caseId} · {row.mode}
                      <br />
                      {row.category || "未分类"} · {row.split || "未划分"}
                      {row.group ? ` · ${row.group}` : ""}
                      {row.topic ? ` · ${row.topic}` : ""}
                    </small>
                  </td>
                  <td>
                    {row.answerable
                      ? verdict(row.evidenceHit, "部分或全部命中", "未命中")
                      : "不适用"}
                    {row.evidenceGroupCount != null && (
                      <small className="result-sub">
                        {row.hitEvidenceGroupCount ?? 0} /{" "}
                        {row.evidenceGroupCount} 组
                        {row.allEvidenceHit ? " · 全部命中" : ""}
                      </small>
                    )}
                  </td>
                  <td>{verdict(row.citationValid, "有效", "无效")}</td>
                  <td>
                    {verdict(
                      row.manualScore?.citationSupported,
                      "人工：支持",
                      "人工：不支持",
                    )}
                  </td>
                  <td>
                    {row.manualScore ? (
                      <>
                        <span
                          className={
                            "badge " +
                            (row.manualScore.answerCorrect
                              ? "success"
                              : "failed")
                          }
                        >
                          {row.manualScore.answerCorrect
                            ? "人工：正确"
                            : "人工：错误"}
                        </span>
                        <small className="result-sub">
                          自动：
                          {verdict(row.answerCorrect, "正确", "错误", "未评分")}
                        </small>
                      </>
                    ) : (
                      <span className="muted">未评分</span>
                    )}
                  </td>
                  <td>
                    {row.error ? (
                      <span className="inline-error">{row.error}</span>
                    ) : (
                      <span className="muted">无执行错误</span>
                    )}
                    <small className="result-sub">
                      {row.manualScore?.errorCategories
                        ?.map((value) => errorLabels[value] || value)
                        .join("、")}
                    </small>
                    <small className="result-sub">
                      {decimal(row.totalMs)} ms
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function EvaluationReview({
  result,
  run,
  onScore,
}: {
  result: Result;
  run: Run;
  onScore: (score: ScoreInput) => Promise<void>;
}) {
  const [answerCorrect, setAnswerCorrect] = useState("");
  const [citationSupported, setCitationSupported] = useState("");
  const [errorCategories, setErrorCategories] = useState<string[]>([]);
  const [rationale, setRationale] = useState("");
  const [ruleVersion, setRuleVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const events = (run.manualScores || []).filter(
    (score) => score.caseId === result.caseId && score.mode === result.mode,
  );
  const labels = result.expectedEvidence || [];
  const groups = new Map<string, EvidenceLabel[]>();
  labels.forEach((label, index) => {
    const key = label.groupId ? `group:${label.groupId}` : `item:${index + 1}`;
    groups.set(key, [...(groups.get(key) || []), label]);
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await onScore({
        caseId: result.caseId,
        mode: result.mode,
        answerCorrect: answerCorrect === "true",
        citationSupported:
          citationSupported === "" ? null : citationSupported === "true",
        errorCategories,
        source: "human",
        rationale: rationale.trim(),
        ruleVersion: ruleVersion.trim(),
      });
      setNotice("人工评分已保存；自动结果保持不变。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="evaluation-review">
      <div className="case-tags">
        <span>题型：{result.category || "未分类"}</span>
        <span>划分：{result.split || "未划分"}</span>
        <span>题组：{result.group || "未分组"}</span>
        {result.topic && <span>主题：{result.topic}</span>}
      </div>
      <div className="review-metrics">
        <div>
          <small>引用格式 · 自动校验</small>
          <strong>{verdict(result.citationValid, "有效", "无效")}</strong>
        </div>
        <div>
          <small>证据命中 · 检索标注</small>
          <strong>
            {result.answerable
              ? verdict(result.evidenceHit, "已命中", "未命中")
              : "不适用"}
          </strong>
        </div>
        <div>
          <small>引用支持 · 人工判断</small>
          <strong>
            {verdict(result.manualScore?.citationSupported, "支持", "不支持")}
          </strong>
        </div>
        <div>
          <small>答案正确 · 自动评分</small>
          <strong>
            {verdict(result.answerCorrect, "正确", "错误", "未评分")}
          </strong>
        </div>
      </div>
      <p className="analysis-note">
        引用支持未评估时不能从格式有效或证据命中推导。参考答案字符串匹配：
        {verdict(result.referenceAnswerMatch, "匹配", "未匹配", "不可用")}
        ，仅是诊断信号。
      </p>
      <h3>标注证据组</h3>
      <p className="analysis-note">
        同组证据可替代；不同组均为必需。
        {result.evidenceGroupCount != null
          ? `已命中 ${result.hitEvidenceGroupCount ?? 0} / ${result.evidenceGroupCount} 组。`
          : ""}
      </p>
      {!groups.size ? (
        <p className="muted">本题没有标注证据。</p>
      ) : (
        [...groups].map(([key, items]) => (
          <div className="evidence-group" key={key}>
            <strong>{key.startsWith('group:') ? key.slice(6) : `独立必需证据 ${key.slice(5)}`}</strong>
            <small>
              {items.length > 1
                ? `${items.length} 个可替代来源，任一命中即可`
                : "独立必需来源"}
            </small>
            {items.map((label, index) => (
              <div className="label-evidence" key={index}>
                <b>{label.documentName}</b>
                <small>
                  第 {label.page ?? "未指定"} 页 · 段落{" "}
                  {label.paragraph ?? "未指定"}
                  {label.startOffset != null
                    ? ` · 字符 ${label.startOffset}–${label.endOffset}`
                    : ""}
                </small>
                <p>{label.quote}</p>
                {label.sourceHash && (
                  <code title={label.sourceHash}>
                    SHA-256 {label.sourceHash}
                  </code>
                )}
              </div>
            ))}
          </div>
        ))
      )}
      <form className="score-form" onSubmit={submit}>
        <h3>人工评分</h3>
        <p className="analysis-note">
          依据预期答案与证据做人工判断。评分以追加事件保存，评分人和时间由服务端记录；不会覆盖自动指标。
        </p>
        {result.manualScore && (
          <div className="current-score">
            当前人工结论：
            <strong>
              {result.manualScore.answerCorrect ? "正确" : "错误"}
            </strong>{" "}
            · 规则 {result.manualScore.ruleVersion}
          </div>
        )}
        <label>
          人工答案正确性
          <select
            required
            value={answerCorrect}
            aria-label="人工答案正确性"
            onChange={(e) => setAnswerCorrect(e.target.value)}
            disabled={saving}
          >
            <option value="">请选择人工判定</option>
            <option value="true">正确</option>
            <option value="false">错误</option>
          </select>
        </label>
        <label>
          人工引用支持
          <select
            value={citationSupported}
            aria-label="人工引用支持"
            onChange={(e) => setCitationSupported(e.target.value)}
            disabled={saving}
          >
            <option value="">未评估</option>
            <option value="true">支持答案结论</option>
            <option value="false">不支持答案结论</option>
          </select>
        </label>
        <fieldset disabled={saving}>
          <legend>错误分析与拒答标签（可多选）</legend>
          {Object.entries(errorLabels).map(([value, label]) => (
            <label key={value} className="error-category">
              <input
                type="checkbox"
                checked={errorCategories.includes(value)}
                onChange={(e) =>
                  setErrorCategories((current) =>
                    e.target.checked
                      ? [...current, value]
                      : current.filter((v) => v !== value),
                  )
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label>
          评分依据
          <textarea
            required
            maxLength={4000}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="指出答案与哪条原文一致或冲突，说明判断依据。"
            disabled={saving}
          />
        </label>
        <label>
          评分规则版本
          <input
            required
            maxLength={100}
            value={ruleVersion}
            onChange={(e) => setRuleVersion(e.target.value)}
            placeholder="例如 human-rubric-v1"
            disabled={saving}
          />
        </label>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        <button
          className="primary"
          disabled={
            saving ||
            run.status === "RUNNING" ||
            !answerCorrect ||
            !rationale.trim() ||
            !ruleVersion.trim()
          }
        >
          {saving
            ? "保存人工评分中…"
            : error
              ? "重试保存人工评分"
              : "保存人工评分"}
        </button>
        {run.status === "RUNNING" && (
          <p className="analysis-note">评测结束后才能提交人工评分。</p>
        )}
      </form>
      <details className="score-history" open={events.length > 0}>
        <summary>人工评分审计记录（{events.length}）</summary>
        {!events.length ? (
          <p className="muted">尚无人工评分；自动结果不计入人工历史。</p>
        ) : (
          events.map((score) => (
            <article key={score.id}>
              <strong>{score.answerCorrect ? "正确" : "错误"}</strong>
              <span>
                来源：{score.source === "human" ? "人工 (human)" : score.source}
              </span>
              <p>{score.rationale}</p>
              <p>
                引用支持：{verdict(score.citationSupported, "支持", "不支持")} ·
                标签：
                {score.errorCategories
                  ?.map((category) => errorLabels[category] || category)
                  .join("、") || "未标注"}
              </p>
              <small>
                规则 {score.ruleVersion}
                <br />
                评分人 {score.scoredBy}
                <br />
                {new Date(score.scoredAt).toLocaleString("zh-CN")}
              </small>
            </article>
          ))
        )}
      </details>
    </section>
  );
}
