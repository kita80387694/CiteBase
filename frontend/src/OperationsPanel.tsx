import { useEffect, useRef, useState } from "react";
type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type Latency = {sampleCount:number; meanMs:number|null; p50Ms:number|null; p95Ms:number|null};
type Kind = {kind:string;queued:number;retryWait:number;running:number;cancelRequested:number;oldestQueuedAgeMs:number|null;activeLeases:number;terminal:{succeeded:number;failed:number;cancelled:number};queueLatency:Latency;endToEndLatency:Latency};
type Summary = {scope:string;generatedAt:string;windowMinutes:number;modelMode:string;kinds:Kind[];failures:{code:string;count:number}[];calls:{started:number;returned:number;unknown:number;usageAvailable:number;usageUnavailable:number};events:{event:string;count:number}[]};
const duration=(n:number|null|undefined)=>n==null?"不可用":`${(n/1000).toFixed(2)} 秒`;
function Latencies({value}:{value:Latency}){return <span>样本 {value.sampleCount} · 均值 {duration(value.meanMs)} · P50 {duration(value.p50Ms)} · P95 {duration(value.p95Ms)}</span>}
export function OperationsPanel({api}:{api:Api}){
 const [windowMinutes,setWindow]=useState(60),[data,setData]=useState<Summary|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
 const generation=useRef(0),apiRef=useRef(api); apiRef.current=api;
 async function refresh(){const own=++generation.current;setLoading(true);setError("");setData(null);try{const next=await apiRef.current<Summary>(`/operations/summary?windowMinutes=${windowMinutes}`);if(next.scope!=="SELF")throw new Error("运行状态返回了不支持的统计范围");if(own===generation.current)setData(next);}catch(e){if(own===generation.current)setError(e instanceof Error?e.message:"运行状态加载失败");}finally{if(own===generation.current)setLoading(false);}}
 useEffect(()=>{void refresh();return()=>{generation.current++}},[windowMinutes]);
 return <section className="operations-panel" aria-label="个人运行状态">
  <p>范围：当前账号（SELF）。任务、租约与调用记录来自共享数据库，覆盖多个 worker；不包含其他用户或全局资源数据。</p>
  <p className="muted">CPU、内存和连接池属于单进程资源，需要运维接口的独立授权，本页不展示。下方终态、延迟、失败及调用按所选时间窗口统计，队列与租约为当前快照。</p>
  <div className="operations-toolbar"><label>统计窗口 <select aria-label="统计窗口" value={windowMinutes} onChange={e=>setWindow(Number(e.target.value))}><option value={5}>最近 5 分钟</option><option value={60}>最近 1 小时</option><option value={1440}>最近 24 小时</option></select></label><button disabled={loading} onClick={()=>void refresh()}>刷新运行状态</button></div>
  {loading&&<p role="status">正在加载运行状态…</p>}
  {error&&<div role="alert"><p>{error}</p><button onClick={()=>void refresh()}>重试运行状态</button></div>}
  {data&&<><p>更新时间：{new Date(data.generatedAt).toLocaleString()} · 模型模式：<strong>{data.modelMode.toUpperCase()}</strong>{data.modelMode.toLowerCase()==="mock"?"（流程与故障测试，不代表真实模型效果）":""}</p>
  {data.kinds.every(k=>k.queued+k.retryWait+k.running+k.cancelRequested+k.terminal.succeeded+k.terminal.failed+k.terminal.cancelled===0)&&<p role="status">当前没有排队或运行任务，所选窗口没有终态任务。</p>}
  <div className="operations-grid">{data.kinds.map(k=><article className="operations-card" key={k.kind}><h2>{{INDEX:"文档索引",EVALUATION:"检索评测",AGENT:"Agent 执行"}[k.kind]??k.kind}</h2><p>排队 {k.queued} · 等待重试 {k.retryWait} · 运行中 {k.running} · 请求取消 {k.cancelRequested}</p><p>有效租约 {k.activeLeases} · 最老排队年龄（含等待重试） {duration(k.oldestQueuedAgeMs)}</p><p>窗口终态：成功 {k.terminal.succeeded} · 失败 {k.terminal.failed} · 取消 {k.terminal.cancelled}</p><p>排队耗时（首次开始时间窗口）：<Latencies value={k.queueLatency}/></p><p>端到端耗时：<Latencies value={k.endToEndLatency}/></p></article>)}</div>
  <h2>模型调用记录</h2><p>等待返回（STARTED） {data.calls.started} · 已返回 {data.calls.returned} · 结果未知 {data.calls.unknown}</p><p>用量可用 {data.calls.usageAvailable} · 用量不可用 {data.calls.usageUnavailable}。用量可用指至少一个实际 token 字段有值，并不代表字段完整；不可用不等于零 token。这里只统计窗口内开始的持久任务调用，同步问答不在此账本，调用记录不代表供应商 exactly-once 执行。</p>
  <h2>窗口失败原因</h2>{data.failures.length?<ul>{data.failures.map(f=><li key={f.code}>{f.code}：{f.count}</li>)}</ul>:<p>所选窗口暂无失败记录。</p>}
  <h2>任务事件</h2><p className="muted">按事件创建时间统计；从 V10 迁移后开始记录，旧事件没有回填。</p>{data.events.length?<ul>{data.events.map(e=><li key={e.event}>{e.event}：{e.count}</li>)}</ul>:<p>所选窗口暂无任务事件。</p>}</>}
 </section>
}
