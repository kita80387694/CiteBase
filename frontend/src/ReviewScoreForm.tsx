import { useState, type FormEvent } from "react";

export type ReviewScoreInput = {
  correctness: string;
  completeness: string;
  citationSupport: string;
  unsupportedContent: string;
  refusal: string;
  rationale: string;
};
export const reviewFields: {
  key: Exclude<keyof ReviewScoreInput, "rationale">;
  label: string;
  options: [string, string][];
}[] = [
  {
    key: "correctness",
    label: "答案正确性",
    options: [
      ["CORRECT", "正确"],
      ["PARTIAL", "部分正确"],
      ["INCORRECT", "错误"],
      ["NA", "不适用"],
    ],
  },
  {
    key: "completeness",
    label: "答案完整性",
    options: [
      ["CORRECT", "完整"],
      ["PARTIAL", "部分完整"],
      ["INCORRECT", "缺少必需要点"],
      ["NA", "不适用"],
    ],
  },
  {
    key: "citationSupport",
    label: "引用支持",
    options: [
      ["SUPPORTED", "支持全部结论"],
      ["PARTIAL", "部分支持"],
      ["UNSUPPORTED", "不支持"],
      ["NA", "不适用"],
    ],
  },
  {
    key: "unsupportedContent",
    label: "无依据内容",
    options: [
      ["NONE", "未发现"],
      ["PRESENT", "存在"],
      ["NA", "不适用"],
    ],
  },
  {
    key: "refusal",
    label: "拒答判断",
    options: [
      ["CORRECT_REFUSAL", "正确拒答"],
      ["INCORRECT_REFUSAL", "错误拒答"],
      ["NOT_REFUSED", "未拒答"],
      ["NA", "不适用"],
    ],
  },
];
export function ScoreForm({
  onSave,
  label = "保存人工评分",
  disabled = false,
}: {
  onSave: (score: ReviewScoreInput) => Promise<void>;
  label?: string;
  disabled?: boolean;
}) {
  const [values, setValues] = useState<ReviewScoreInput>({
    correctness: "",
    completeness: "",
    citationSupport: "",
    unsupportedContent: "",
    refusal: "",
    rationale: "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(values);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="review-score-form" onSubmit={submit}>
      <p className="muted">
        各维度初始为未评分；“不适用”是明确判断，不能代替未评分。保存后保留修改历史。
      </p>
      <fieldset disabled={disabled || busy}>
        <div className="review-score-grid">
          {reviewFields.map((field) => (
            <label key={field.key}>
              {field.label}
              <select
                required
                aria-label={field.label}
                value={values[field.key]}
                onChange={(event) =>
                  setValues({ ...values, [field.key]: event.target.value })
                }
              >
                <option value="">未评分 · 请选择</option>
                {field.options.map(([value, text]) => (
                  <option value={value} key={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label>
          评分依据
          <textarea
            required
            minLength={5}
            aria-label="评分依据"
            value={values.rationale}
            onChange={(event) =>
              setValues({ ...values, rationale: event.target.value })
            }
            placeholder="说明结论与证据的对应关系；不适用也需说明理由。"
          />
        </label>
        <button className="primary" type="submit">
          {busy ? "保存中…" : label}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
    </form>
  );
}
