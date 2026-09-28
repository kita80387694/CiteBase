# 第二阶段阶段一：评测与人工评分契约

保留现有 POST /api/evaluations 外层 {kbId,name,dataset,topK}。严格拒绝任何层级未知字段、错误JSON类型、重复题号、无效标签；所有校验在创建run与模型调用前完成。

Dataset: {version,questions,seed?,split?}，seed为整数；dataset split为题目split的缺省值。Case兼容旧字段，新增可选字符串 category、split、group、topic（用于题型/数据划分/题组分析；split建议train/dev/test）。Evidence label兼容 {documentName,page,paragraph,quote}，新增 sourceHash（文件原始字节SHA-256，64小写hex）、startOffset/endOffset（同页规范化文本UTF-16半开区间）、groupId。page/paragraph从1开始；offset须成对提供且page必填。标签必须唯一解析到当前用户指定知识库的活动文档版本及原文位置；同名歧义、过期hash、不存在quote/位置、跨库标签全部400，禁止接受客户端versionId、documentId、userId绕过归属。历史四字段标签自动解析并补全hash/page/paragraph/offset，保存解析后的标签。

原文由DocumentParser重建每页文本位置（CRLF规范化），不依赖检索候选；同段落跨chunk的quote也可解析。相同非空groupId的标签为可替代证据，任一命中即命中该组；不同group必须各自命中。未给groupId的每个标签是一个独立必需组，兼容旧Recall。Recall@K=命中组数/全部组数；MRR=首个命中任一组的rank倒数（不是全部组完成排名）。evidenceHit表示至少一组命中，新增allEvidenceHit表示所有组命中。

结果行新增category/split/group/topic（缺失null）、evidenceGroupCount/hitEvidenceGroupCount/allEvidenceHit。自动结果的answerCorrect永远null。summary保持原vector/hybrid，新增顶层breakdowns按category/split/group/topic分组（形如 {category:{标签值:{vector:指标,hybrid:指标}},...}），每组每模式使用同一指标口径。

POST /api/evaluations/{id}/scores，body={caseId,mode,answerCorrect:boolean,source:"human",rationale:非空字符串,ruleVersion:非空字符串,citationSupported:boolean|null,errorCategories:枚举数组}。只能评分自己已结束的评测中存在的行。评分事件追加保存；不能覆写自动结果、供应商usage、引用或检索指标。返回评分 {id,caseId,mode,answerCorrect,source,rationale,ruleVersion,citationSupported,errorCategories,scoredAt,scoredBy}。无权访问404；未知case/mode、非法字段/类型400；RUNNING返回409。

GET /api/evaluations/{id} 与 /export 返回原payload并新增顶层manualScores（全部事件），每行manualScore为该行最新事件，无评分为null；每行answerCorrect保留原始null。前端以manualScore.answerCorrect呈现人工正确/错误，不能把referenceAnswerMatch显示为人工正确性。评分用户与时间由服务端设置，客户端不得传入。

评分是人工判断来源记录，不自动证明答案正确；规则版本与依据用于复核。此阶段不宣称新增真实模型评测完成。

errorCategories必填且可为[]，不允许重复，枚举：retrieval_miss、ranking_poor、unsupported_answer、contradiction、unsupported_citation、correct_abstention、incorrect_abstention。citationSupported缺省/null表示尚未人工判断引用是否支持陈述；此字段与answerCorrect独立，不由citationValid推断。

sourceHash来自授权知识库活动文件字节SHA-256。候选Evidence不增加hash字段：评测在共享读锁保护下捕获 versionId -> sourceHash 快照，指标匹配时以候选versionId查询该快照，验证标签hash一致后匹配页段与准确区间。如此不会把另一版相同quote误算命中。没有hash上下文的纯metrics调用不允许hashed标签命中。
