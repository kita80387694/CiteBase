# 辅助评分协议 v1（端到端口径澄清）

来源恒为ASSISTED，不进入HUMAN评分表。用户2026-10-01授权辅助评审继续开发，不等于用户亲自逐题评分，也不是两位真人。不同AI评审会共享模型偏差，一致率和bootstrap都不能代替人类效度。

## 材料与隔离

采集结束后按固定种子匿名重排，答案哈希绑定评分。评审仅获得分配的匿名问题、参考答案、稳定gold证据、实际检索证据及回答；不给策略、配置、运行ID、映射或其他评审结果。主评覆盖每份答案，固定20%向上取整双评。独立测试160份对应192次评分，两位AI各96次。分批只是控制上下文，不改变分配或样本范围。

## 五个维度

- correctness：CORRECT/PARTIAL/INCORRECT/NA。衡量端到端问题是否正确处理。正常完成、确实不可回答且正确拒答算CORRECT；可回答却拒答为INCORRECT。执行失败无论文本如何，汇总正确率始终计0。确实无法判断的正常完成项可NA，但阻止质量选择，不当作正确或静默剔除。
- completeness：CORRECT/PARTIAL/INCORRECT/NA。问题要求是否覆盖；正确拒答可完整，执行失败或不存在实质内容须具体解释NA。
- citationSupport：SUPPORTED/PARTIAL/UNSUPPORTED/NA。核对实际引用原文能否支持回答结论；格式有效或gold命中不能自动判SUPPORTED。无需要引用的正常拒答可NA。
- unsupportedContent：NONE/PRESENT/NA。回答是否添加证据外事实；不能将证据明确支持的否定结论误判为缺证据。纯拒答未添加事实可NONE。
- refusal：CORRECT_REFUSAL/INCORRECT_REFUSAL/NOT_REFUSED/NA。否定性事实回答不等于拒答。可回答却拒答为INCORRECT_REFUSAL，执行失败要另外保留状态，不能靠拒答字样计作成功。

每项有具体中文评分理由、实际时间、规则版本citebase-assisted-quality-v1、答案SHA；所有NA有逐维理由。禁止批量按关键词、引用存在或运行成功自动填语义分数。原始评分不覆盖，修订使用新版本并保留变更原因。

## 分歧与汇总

只有完整双评存在实际维度分歧时进入独立AI裁决，绑定两份评分规范化哈希；不得由原A/B自行裁决，也不得改变已一致维度。评分变更使原裁决哈希失效，必须重新核验。未评分/分歧保持null，不排除样本。

统计单位为唯一回答与配对问题，不把复评当额外样本。报告失败率、原始各维度及配对端到端正确差；运行失败计0，正常完成的NA保持未知。2000次固定种子配对bootstrap报告不确定性，样本小、AI相关性及单次生成随机性明确披露。独立test只验证已冻结候选，不据test重新挑策略或调参。

开发集初始评分有口径歧义，已保留scores-B原版及v2；拒绝的过期裁决文件保留但不进入有效报告。最终开发报告comparison-v2-final.json使用scores-A、scores-B-v2和adjudications-v3，详情见ASSISTED_EXPERIMENTS.md。
