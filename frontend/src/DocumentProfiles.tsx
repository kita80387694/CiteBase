import { useEffect, useState } from "react";
export type ChunkProfile = {
  strategy: "legacy" | "structure-v1";
  size: number;
  overlap: number;
};
export const defaultChunkProfile: ChunkProfile = {
  strategy: "legacy",
  size: 900,
  overlap: 200,
};
export type DocumentVersion = {
  id: string;
  status: string;
  contentHash: string;
  createdAt: string;
  chunkStrategy?: string;
  chunkSize?: number;
  chunkOverlap?: number;
};
export function validateChunkProfile(profile: ChunkProfile) {
  if (
    !Number.isInteger(profile.size) ||
    profile.size < 200 ||
    profile.size > 4000
  )
    throw new Error("分块大小必须是 200–4000 的整数。");
  if (
    !Number.isInteger(profile.overlap) ||
    profile.overlap < 0 ||
    profile.overlap > Math.min(profile.size / 2, 1000)
  )
    throw new Error(
      "重叠大小必须是非负整数，且不能超过分块大小的一半或 1000。",
    );
}
export function ChunkControls({
  value,
  onChange,
  disabled,
}: {
  value: ChunkProfile;
  onChange: (profile: ChunkProfile) => void;
  disabled: boolean;
}) {
  return (
    <details className="chunk-controls">
      <summary>
        上传 / 更新的切分配置 · {value.strategy} · {value.size} /{" "}
        {value.overlap}
      </summary>
      <div className="retrieval-fields">
        <label>
          切分策略
          <select
            aria-label="切分策略"
            value={value.strategy}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...value,
                strategy: e.target.value as ChunkProfile["strategy"],
              })
            }
          >
            <option value="legacy">legacy · 兼容切分</option>
            <option value="structure-v1">structure-v1 · 结构切分</option>
          </select>
        </label>
        <label>
          分块大小
          <input
            type="number"
            required
            min={200}
            max={4000}
            step={1}
            value={value.size}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, size: Number(e.target.value) })
            }
          />
        </label>
        <label>
          重叠大小
          <input
            type="number"
            required
            min={0}
            max={Math.min(value.size / 2, 1000)}
            step={1}
            value={value.overlap}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, overlap: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <p>
        配置应用于下一次上传或更新，只影响新版本；不会直接重建现有索引。更新失败保留上一份可用索引，成功后切换。默认
        legacy / 900 / 200；重叠不能超过分块大小的一半或 1000。
      </p>
    </details>
  );
}
export function DocumentVersions({
  document,
  load,
  onClose,
}: {
  document: { id: string; name: string; activeVersionId?: string };
  load: (id: string) => Promise<DocumentVersion[]>;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<DocumentVersion[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    load(document.id)
      .then((data) => {
        if (!cancelled) setVersions(data);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "读取版本失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [document.id, document.activeVersionId, attempt]);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer wide version-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-title">
          <div className="eyebrow">DOCUMENT VERSIONS</div>
          <button onClick={onClose} aria-label="关闭文档版本">
            关闭
          </button>
        </div>
        <h2>{document.name}</h2>
        <p className="muted">版本记录与切分配置。只有当前可用版本参与检索。</p>
        {loading ? (
          <p role="status">正在读取文档版本…</p>
        ) : error ? (
          <div className="alert" role="alert">
            {error}
            <button onClick={() => setAttempt((n) => n + 1)}>
              重试读取版本
            </button>
          </div>
        ) : !versions.length ? (
          <p>暂无版本记录。</p>
        ) : (
          versions.map((version) => (
            <article className="version-card" key={version.id}>
              <div>
                <strong>
                  {version.id === document.activeVersionId
                    ? "当前可用版本"
                    : "历史 / 待切换版本"}
                </strong>
                <span className={"badge " + version.status.toLowerCase()}>
                  {version.status}
                </span>
              </div>
              <p>
                {version.chunkStrategy ?? "未记录策略"} · 分块{" "}
                {version.chunkSize ?? "不可用"} · 重叠{" "}
                {version.chunkOverlap ?? "不可用"}
              </p>
              <small>
                {new Date(version.createdAt).toLocaleString("zh-CN")}
                <br />
                版本 {version.id}
                <br />
                SHA-256 {version.contentHash}
              </small>
            </article>
          ))
        )}
      </aside>
    </div>
  );
}
