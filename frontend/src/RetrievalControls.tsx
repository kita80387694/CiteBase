export type RetrievalOptions = {
  candidateK: number;
  keywordWeight: number;
  rerank: boolean;
  citationStyle: "uuid" | "compact";
  rerankPolicy?: "always" | "candidate-pressure-v1";
  deduplicate?: boolean;
  cache?: boolean;
};
export const defaultRetrievalOptions: RetrievalOptions = {
  candidateK: 20,
  keywordWeight: 1,
  rerank: false,
  citationStyle: "uuid",
};
// Omit default experimental fields so legacy requests keep their original wire shape.
export function retrievalOptionsForRequest(
  value: RetrievalOptions,
): RetrievalOptions {
  const { rerankPolicy, deduplicate, cache, ...baseline } = value;
  return {
    ...baseline,
    ...(rerankPolicy && rerankPolicy !== "always" ? { rerankPolicy } : {}),
    ...(deduplicate ? { deduplicate: true } : {}),
    ...(cache ? { cache: true } : {}),
  };
}
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
    cost?: {
      rerankDecision:
        | "DISABLED"
        | "EMPTY"
        | "APPLIED"
        | "SKIPPED_CANDIDATE_PRESSURE";
      rawCandidateCount: number;
      uniqueRerankInputs: number;
      savedInputCharacters: number;
      dedupMapping?: { index: number; chunkIds: string[] }[];
      currentProviderCalls: { embedding: number; rerank: number };
      cache: {
        status: "OFF" | "MISS" | "HIT";
        scope: "ACTIVE" | "EVALUATION_SNAPSHOT";
        config?: unknown;
      };
      usageReason?: string;
    };
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
      <fieldset className="retrieval-cost-controls" disabled={disabled}>
        <legend>成本实验选项（默认关闭）</legend>
        <label>
          重排调用策略
          <select
            aria-label="重排调用策略"
            disabled={disabled || !value.rerank}
            value={value.rerankPolicy ?? "always"}
            onChange={(event) =>
              onChange(
                retrievalOptionsForRequest({
                  ...value,
                  rerankPolicy: event.target
                    .value as RetrievalOptions["rerankPolicy"],
                }),
              )
            }
          >
            <option value="always">固定重排（默认）</option>
            <option value="candidate-pressure-v1">
              候选压力条件重排 · 实验
            </option>
          </select>
        </label>
        <label className="check-option">
          <input
            type="checkbox"
            checked={value.deduplicate ?? false}
            onChange={(event) =>
              onChange(
                retrievalOptionsForRequest({
                  ...value,
                  deduplicate: event.target.checked,
                }),
              )
            }
          />
          重排输入精确去重 · 实验
        </label>
        <label className="check-option">
          <input
            type="checkbox"
            checked={value.cache ?? false}
            onChange={(event) =>
              onChange(
                retrievalOptionsForRequest({
                  ...value,
                  cache: event.target.checked,
                }),
              )
            }
          />
          启用检索结果缓存 · 实验
        </label>
        <p className="muted">
          条件重排仅在独立 Reranker 开启时生效；候选文本组不超过 Top K
          时跳过重排。去重只合并重排输入，保留原始来源。缓存仅复用当前授权范围和数据版本内的检索结果，不缓存答案。
        </p>
        <p className="muted">
          探索性成本优化，尚无真人质量非劣化结论。缓存命中不代表本次问答没有模型调用，回答生成仍会执行。
        </p>
      </fieldset>
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
  const cost = result.diagnostics?.cost;
  const cacheHit = cost?.cache.status === "HIT";
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
      {cost ? (
        <section
          className="retrieval-cost-diagnostics"
          aria-label="检索成本诊断"
        >
          <p>
            重排决策：
            {{
              DISABLED: "未启用",
              EMPTY: "无候选",
              APPLIED: "已执行",
              SKIPPED_CANDIDATE_PRESSURE: "按候选压力跳过",
            }[cost.rerankDecision] || cost.rerankDecision}
          </p>
          <p>
            原始候选 {cost.rawCandidateCount} · 唯一重排输入{" "}
            {cost.uniqueRerankInputs} · 减少输入字符 {cost.savedInputCharacters}
          </p>
          <p>
            缓存：{cost.cache.status} · 范围：
            {cost.cache.scope === "EVALUATION_SNAPSHOT"
              ? "评测快照"
              : "当前可用版本"}
          </p>
          <p>
            本次供应商调用：Embedding {cost.currentProviderCalls.embedding} 次 ·
            Reranker {cost.currentProviderCalls.rerank} 次
          </p>
          <p className="muted">
            {cacheHit
              ? "缓存命中：本次未调用检索供应商，embedding/rerank 用量为 null；不继承历史 token，也不把 null 记作零。回答生成用量另行记录。"
              : "调用次数与 token 用量分开记录。MOCK本地调用不计入供应商调用；这些诊断不证明答案质量。"}
          </p>
          <details>
            <summary>成本诊断原始数据</summary>
            <pre>{JSON.stringify(cost, null, 2)}</pre>
          </details>
        </section>
      ) : (
        <p className="legacy-diagnostics">
          此记录未保存成本诊断；不能推断缓存命中或供应商调用次数。
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
        <p>
          Embedding 用量：
          {cacheHit || cost?.currentProviderCalls.embedding === 0
            ? "本次未调用供应商（null）"
            : usage(result.usage?.embedding)}
        </p>
        <p>
          Reranker 用量：
          {cacheHit ||
          cost?.currentProviderCalls.rerank === 0 ||
          options?.rerank === false
            ? "本次未调用供应商（null）"
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
