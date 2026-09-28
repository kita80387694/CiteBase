export type RetrievalOptions = {
  candidateK: number;
  keywordWeight: number;
  rerank: boolean;
  citationStyle: "uuid" | "compact";
};
export const defaultRetrievalOptions: RetrievalOptions = {
  candidateK: 20,
  keywordWeight: 1,
  rerank: false,
  citationStyle: "uuid",
};
export type ProviderUsage = {
  promptTokens: number | null;
  totalTokens: number | null;
  completionTokens?: number | null;
  providerUsage?: unknown;
  providerTokens?: unknown;
  billedUnits?: unknown;
} | null;
export type RetrievalDetails = {
  retrievalOptions?: RetrievalOptions;
  diagnostics?: {
    timings?: Record<string, number | null>;
    candidateCounts?: Record<string, number>;
    trace?: Record<string, unknown[]>;
    rawAnswer?: string | null;
    aliasMap?: Record<string, string>;
  };
  usage?: { embedding: ProviderUsage; rerank: ProviderUsage };
  error?: string | null;
};
const timingLabels: Record<string, string> = {
  embeddingMs: "查询向量化",
  vectorMs: "向量检索",
  keywordMs: "关键词检索",
  fusionMs: "结果融合",
  rerankMs: "独立重排",
  generationMs: "回答生成",
  citationMs: "引用校验",
};
const countLabels: Record<string, string> = {
  vector: "向量候选",
  keyword: "关键词候选",
  fused: "融合候选",
  rerankInput: "重排输入",
  selected: "最终证据",
};

export function RetrievalControls({
  value,
  onChange,
  topK,
  disabled = false,
  forEvaluation = false,
}: {
  value: RetrievalOptions;
  onChange: (value: RetrievalOptions) => void;
  topK: number;
  disabled?: boolean;
  forEvaluation?: boolean;
}) {
  return (
    <details className="retrieval-controls">
      <summary>
        检索选项 · 候选 {value.candidateK} ·{" "}
        {value.rerank ? "启用重排" : "重排关闭"} ·{" "}
        {value.citationStyle === "compact" ? "紧凑引用" : "UUID 引用"}
      </summary>
      <div className="retrieval-fields">
        <label>
          候选数 candidateK
          <input
            type="number"
            required
            min={topK}
            max={100}
            step={1}
            value={value.candidateK}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, candidateK: Number(e.target.value) })
            }
          />
        </label>
        <label>
          关键词权重
          <input
            type="number"
            required
            min={0}
            max={4}
            step={0.1}
            value={value.keywordWeight}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, keywordWeight: Number(e.target.value) })
            }
          />
        </label>
        <label>
          引用格式
          <select
            aria-label="引用格式选项"
            value={value.citationStyle}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...value,
                citationStyle: e.target
                  .value as RetrievalOptions["citationStyle"],
              })
            }
          >
            <option value="uuid">UUID（默认）</option>
            <option value="compact">紧凑别名 E1…En</option>
          </select>
        </label>
      </div>
      <label className="check-option">
        <input
          type="checkbox"
          checked={value.rerank}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, rerank: e.target.checked })}
        />
        启用独立 Reranker
      </label>
      <p>
        候选数须在 Top K 与 100 之间；向量权重固定为
        1，关键词权重仅用于混合检索。
        {forEvaluation ? "本次评测的向量与混合模式共用这组配置。" : ""}
        重排仅在启用时调用已配置的独立模型，缺配置或供应商失败会明确报错。紧凑引用只改变模型输入的来源编号，输出仍校验本次证据集合。
      </p>
    </details>
  );
}

export function RetrievalDiagnostics({ result }: { result: RetrievalDetails }) {
  if (!result.retrievalOptions && !result.diagnostics && !result.usage)
    return <p className="legacy-diagnostics">此历史记录未保存阶段诊断信息。</p>;
  const options = result.retrievalOptions;
  const timings = result.diagnostics?.timings;
  const counts = result.diagnostics?.candidateCounts;
  const usage = (value: ProviderUsage | undefined) =>
    value
      ? `输入 ${value.promptTokens ?? "不可用"}${"completionTokens" in value ? ` / 输出 ${value.completionTokens ?? "不可用"}` : ""} / 总量 ${value.totalTokens ?? "不可用"}`
      : "供应商未返回（null）";
  return (
    <details className="retrieval-diagnostics">
      <summary>检索配置、阶段耗时与供应商用量</summary>
      <div className="diagnostic-config">
        候选数 {options?.candidateK ?? "不可用"} · 向量权重 1 · 关键词权重{" "}
        {options?.keywordWeight ?? "不可用"} · 引用{" "}
        {options?.citationStyle ?? "不可用"}
      </div>
      <p className="rerank-status">
        重排状态：
        {options?.rerank === false
          ? "关闭 · 未调用"
          : options?.rerank
            ? "已启用，执行状态见阶段耗时与错误"
            : "未记录"}
      </p>
      {result.error && (
        <p className="inline-error">
          本次执行错误：{result.error}
          。下方保留已完成阶段的数据，不代表整次请求成功。
        </p>
      )}
      <div className="stage-timings">
        {Object.entries(timingLabels).map(([key, label]) => (
          <div key={key}>
            <small>{label}</small>
            <strong>
              {key === "rerankMs" && options?.rerank === false
                ? "关闭"
                : timings?.[key] == null
                  ? "不可用"
                  : `${Number(timings[key]).toFixed(2)} ms`}
            </strong>
          </div>
        ))}
      </div>
      <p className="diagnostic-counts">
        {Object.entries(countLabels).map(([key, label]) => (
          <span key={key}>
            {label} {counts?.[key] ?? "不可用"}
          </span>
        ))}
      </p>
      <div className="provider-usage">
        <p>Embedding 用量：{usage(result.usage?.embedding)}</p>
        <p>
          Reranker 用量：
          {options?.rerank === false
            ? "未调用（null）"
            : usage(result.usage?.rerank)}
        </p>
        <small>仅展示实际供应商返回值；没有返回的 token 不估算。</small>
        {result.usage?.rerank && (
          <details>
            <summary>Reranker 原始用量 / 计费单位</summary>
            <pre>{JSON.stringify(result.usage.rerank, null, 2)}</pre>
          </details>
        )}
      </div>
      {result.diagnostics?.trace && (
        <details>
          <summary>各阶段原始候选与重排结果</summary>
          <pre>{JSON.stringify(result.diagnostics.trace, null, 2)}</pre>
        </details>
      )}
      {result.diagnostics?.aliasMap && (
        <details>
          <summary>引用别名映射</summary>
          <pre>{JSON.stringify(result.diagnostics.aliasMap, null, 2)}</pre>
        </details>
      )}
      {result.diagnostics?.rawAnswer != null && (
        <details>
          <summary>供应商原始回答（引用规范化前）</summary>
          <pre>{result.diagnostics.rawAnswer}</pre>
        </details>
      )}
    </details>
  );
}
