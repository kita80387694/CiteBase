import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const SEED=20260930, VERSION='citebase-phase3-quality-v1';
export const hash=x=>createHash('sha256').update(x).digest('hex');
// Original fictional procedures. All questions and answer keys are authored, not model responses.
// Each source record is a paragraph. References A/B name distinct documents; arrays denote alternatives.
export const topics=[
{id:'aster',name:'Aster 种子样本库',a:[
'Aster 种子样本库的接收编号采用 AST 前缀。每份样本必须有采集地点和采集日期；缺任一项时登记为待补录，不能进入可分发库存。',
'Aster 的活力检测每批取 30 粒，萌发不少于 24 粒标记 V-PASS；检测只说明本批检测条件下的萌发表现，不承诺田间产量。',
'Aster 保存表\n| 类别 | 温度 | 复检周期 |\n| 干燥种子 | 4 摄氏度 | 180 天 |\n| 短期湿样 | 12 摄氏度 | 7 天 |',
'Aster 分发必须同时满足资料完整、V-PASS 和库存不少于 80 粒。仅具有接收编号不代表允许分发。',
'Aster 同名品种可能来自不同地点，合并记录必须同时匹配采集地点、日期和批次；不能仅按品种名合并。',
'Aster 中的保留量是每批至少留下 50 粒。分发批准不能覆盖保留量约束；从 80 粒库存最多取出 30 粒。'],b:[
'Aster 复检失败时暂停该批后续分发，已发出的样本由库管通知接收者；通知不是自动判定收获损失。',
'Aster 补录由采集人提交原始记录，库管审核后更新资料状态；检测员只能填写检测结果。',
'Aster 标签丢失的容器进入隔离架 Q，不因与已知批次相邻就恢复编号。',
'Aster 同一分发单的补发沿用原单号并新增补发序号；不能新开一单来绕过保留量检查。',
'Aster 旧演练库允许留下 40 粒；AST 正式库仍要求至少保留 50 粒。',
'Aster 正式库最低保留数量为每批 50 粒；该数字不随分发单的数量变化。'],q:[
['事实','接收一份 Aster 样本至少要登记哪两项采集信息？','地点、日期',['A0']],
['表格','Aster 干燥种子多久复检一次，保存温度是多少？','180天；4摄氏度',['A2']],
['表格','Aster 湿样和干样的复检间隔差多少天？','173天',['A2']],
['跨段落','Aster 30粒中萌发24粒但缺采集日期，能分发吗？','不能；检测达标但资料不完整',['A0','A1','A3']],
['跨段落','Aster 库存79粒、资料完整且检测通过，可以先发1粒吗？','不能；库存不足80粒',['A3']],
['跨文档','Aster 缺地点记录应找谁提交、谁审核，检测员能代批吗？','采集人提交、库管审核；检测员不能代批',['A0','B1']],
['跨文档','Aster 补发后只剩49粒，沿用原单号就可以放行吗？','不能；补发也须保留至少50粒',['A5','B3']],
['歧义','两个 Aster 容器的品种名一样，是否表示同一批？','不表示；还须地点、日期、批次匹配',['A4']],
['证据充分','Aster 正式库每批至少留下几粒？只需要这个数。','50粒',[['A5','B5']]],
['近事实干扰','Aster 老演练规则写40粒，本次AST分发能用它吗？','不能；正式库50粒',['B4']],
['计算','Aster 30粒中萌发23粒可以标记V-PASS吗？','不可以；至少24粒',['A1']],
['跨文档','Aster 无标签容器放在已知样本旁，能按邻居编号补登记并分发吗？','不能；进入隔离架，不凭相邻恢复编号',['B2','A3']],
['拒绝过度推断','Aster 得到V-PASS能承诺来年田间产量吗？','不能；仅说明检测条件下萌发表现',['A1']],
['事实','Aster 复检失败后，由谁通知已经领过样本的人？','库管',['B0']],
['跨段落','Aster 80粒库存且其他条件都合格，一次最多分发多少粒？','30粒，保留50粒',['A3','A5']],
['同义','Aster 同一张领用单再次补寄时，编号如何处理？','原单号加新的补发序号',['B3']]],u:['Aster 种子在南方每亩能增产多少公斤？','Aster 库管的个人手机号码是什么？','Aster 保存柜应买哪家公司的产品？','Aster 当前真实库存总共多少粒？']},
{id:'brass',name:'Brass 乐器维修室',a:[
'Brass 乐器维修室收到乐器后先拍外观照片，再生成 BR 工单。工单中的估价不是客户授权；必须取得书面授权才可拆卸。',
'Brass 将 NFF 定义为未复现故障。NFF 不代表客户描述虚假，也不授权更换零件。',
'Brass 工时表\n| 作业 | 标准工时 |\n| 清洁 | 40 分钟 |\n| 键垫更换 | 90 分钟 |\n| 全面调校 | 150 分钟 |',
'Brass 更换零件后必须做气密测试和演奏测试，两项均通过才能进入待取件；清洁完成不能代替测试。',
'Brass 维修授权上限为客户批准的金额，增加费用须重新书面确认；口头表示尽快修不等于增加预算。',
'Brass 旧件装入标有原工单号的袋子，保留到客户取件后14天；客户明确选择领回旧件时随乐器返还。'],b:[
'Brass 返修在原工单下创建子单，保留原验收结果；返修不意味着原记录可以删除。',
'Brass 待取件通知由接待员发出，技师只提交测试记录。取件人需提供工单号和客户授权的取件码。',
'Brass 调校后第二天出现相同症状时先复现故障并核对原测试，不直接认定为同一零件损坏。',
'Brass 排班表\n| 岗位 | 可批准事项 |\n| 接待员 | 改约取件时间 |\n| 主管 | 内部作业排期 |\n| 客户 | 增加费用与拆卸授权 |',
'Brass 保存测试录音30天；录音保留期限独立于旧件保留期限。',
'Brass 不接受用其他客户的演奏测试替代本工单测试，即使型号相同。'],q:[
['事实','Brass 开工单之前先做什么？','拍外观照片',['A0']],
['缩写','Brass 的NFF是什么，能据此说客户撒谎吗？','未复现故障；不能',['A1']],
['表格','Brass 键垫更换比清洁的标准工时多多久？','50分钟',['A2']],
['表格','Brass 清洁加全面调校的标准工时合计多少？','190分钟',['A2']],
['跨段落','Brass 已给估价且客户说尽快修，可以直接拆卸并增加费用吗？','不能；拆卸及加费均需书面授权',['A0','A4']],
['跨文档','Brass 技师完成两项测试后能自行通知取件吗？','不能；技师提交记录，接待员通知',['A3','B1']],
['跨文档','Brass 有工单号但没取件码，可以取回已通过测试的乐器吗？','不能；两项凭据都需要',['A3','B1']],
['歧义','Brass 第二天又有同样症状，是不是已确认原零件再次损坏？','不是；先复现并核对测试',['B2']],
['证据充分','Brass 测试录音保留多少天？','30天',['B4']],
['近事实干扰','Brass 录音留30天，所以旧件也留30天吗？','不是；旧件取件后14天或随取件返还',['A5','B4']],
['跨段落','Brass 返修时可以抹掉原验收、借同型号其他客户测试通过吗？','不可以；保留原结果且每工单独立测试',['B0','B5']],
['事实','Brass 客户明确要领回旧件时怎么处理？','随乐器返还',['A5']],
['拒绝过度推断','Brass 标记NFF之后是否自动允许换件？','不允许',['A1']],
['表格','Brass 主管批准排期能代替客户批准额外费用吗？','不能；加费由客户批准',['B3']],
['跨段落','Brass 已完成清洁和气密测试，缺演奏测试能标待取件吗？','不能；两项测试都通过才可',['A3']],
['同义','Brass 再次送修要建全新独立记录还是关联老单？','原工单下建子单',['B0']]],u:['Brass 对这把萨克斯应收多少人民币？','Brass 使用哪个品牌的键垫最好？','Brass 客户李先生的取件码是多少？','Brass 修好后乐器音色会提高多少分？']},
{id:'cobalt',name:'Cobalt 海图档案',a:[
'Cobalt 海图档案用 CBL 编号标识图幅。工作副本可作研究标注，不得用于实际航行；正式发行状态由档案管理员登记。',
'Cobalt 修订日期和测绘日期是不同字段。修订日期较新不表示海底重新测量过。',
'Cobalt 扫描参数表\n| 资料 | 分辨率 | 色彩 |\n| 线图 | 600 dpi | 灰度 |\n| 彩色潮汐图 | 400 dpi | RGB |',
'Cobalt 缺页图幅仍可建立目录，但完整性必须标记INCOMPLETE，不能在对外列表显示为完整。',
'Cobalt OCR 文字只能帮助搜索，不取代原图中的坐标。坐标模糊时标记待核验，禁止自动补成推测数字。',
'Cobalt 同一图幅不同版次分别保留，最新修订副本不得覆盖旧版原图。'],b:[
'Cobalt 发布前需校验文件哈希、页序和发行标记。校验人和发布人必须是不同账号。',
'Cobalt 撤回后公开目录只显示撤回编号和原因，不提供原图下载；已有工作副本访问链接也要失效。',
'Cobalt 研究引用格式需包含图幅号、版次和页码；只写文件名不能区分多版资料。',
'Cobalt 修复表\n| 异常 | 动作 |\n| 页序颠倒 | 重新排序并复核 |\n| 文件哈希不符 | 隔离待核验 |\n| OCR错字 | 修正搜索文本并保留原图 |',
'Cobalt 出版目录的发行标记是ISSUED；只有管理员登记ISSUED的版本才能作为正式发行副本展示。',
'Cobalt 对历史测绘精度没有新增保证，扫描分辨率不等于测绘准确度。'],q:[
['事实','Cobalt 工作副本能用来实际航行吗？','不能',['A0']],
['歧义','Cobalt 修订日期更新，是否说明又测了一遍海底？','不说明；修订与测绘日期不同',['A1']],
['表格','Cobalt 彩色潮汐图用什么分辨率和色彩？','400dpi，RGB',['A2']],
['表格','Cobalt 线图扫描比潮汐图高多少dpi？','200dpi',['A2']],
['跨段落','Cobalt 图幅缺页但OCR能搜索到，能公开标完整吗？','不能；缺页必须INCOMPLETE，OCR不改变完整性',['A3','A4']],
['跨文档','Cobalt 新版发布是否只要管理员登记发行就够？','不够；还须哈希、页序、发行标记校验且校验发布账号分离',['A0','B0']],
['跨文档','Cobalt 论文引用多版同名图，需哪些标识才能辨别？','图幅号、版次、页码',['A5','B2']],
['拒绝过度推断','Cobalt 原图坐标看不清，可以根据OCR直接确认吗？','不可以；待核验，OCR不取代原图',['A4']],
['证据充分','Cobalt 正式发行标记是哪一个？','ISSUED',['B4']],
['近事实干扰','Cobalt 600dpi扫描代表测绘精度更高吗？','不能这样推断',['A2','B5']],
['事实','Cobalt 某版撤回后旧工作副本链接还可下载吗？','不可；链接失效，仅留撤回编号和原因',['B1']],
['事实','Cobalt 最新修订能覆盖旧版原图吗？','不能，分别保留',['A5']],
['表格','Cobalt 哈希不符合时应重排页序还是隔离？','隔离待核验',['B3']],
['跨文档','Cobalt OCR错字修复时可以直接修改原图坐标吗？','不能；修搜索文本保留原图，模糊坐标待核验',['A4','B3']],
['跨段落','Cobalt 缺页资料是否完全禁止建立目录？','不是；可建目录但标INCOMPLETE',['A3']],
['同义','Cobalt 检查材料和最后发布可以由同一个账号完成吗？','不可以',['B0']]],u:['Cobalt 某海峡今天实际水深多少米？','Cobalt 图幅CBL-999的坐标是多少？','Cobalt 下一版海图何时上市？','Cobalt 扫描仪具体采购价格是多少？']},
{id:'dahlia',name:'Dahlia 社区工具借用',a:[
'Dahlia 工具站每人同时可借3件，附件随主工具计为1件；独立借出的附件单独计数。',
'Dahlia 借用必须记录工具序列号和借用人。归还预约不是已归还，现场验收后才释放借用额度。',
'Dahlia 借期表\n| 工具 | 标准借期 | 可续期次数 |\n| 手钻 | 3天 | 1次 |\n| 梯子 | 2天 | 0次 |\n| 手推车 | 5天 | 1次 |',
'Dahlia 工具若已被下一位预约，不允许续期；允许续期的工具每次延长原标准借期。',
'Dahlia 检查发现裂纹时贴STOP标签并隔离，管理员确认安全之前禁止再次借出；擦掉标签不能恢复状态。',
'Dahlia 丢失附件与工具损坏分别记录，不能因主工具可运转而忽略附件缺失。'],b:[
'Dahlia 归还验收由值班员执行，损坏争议由管理员复核。借用人可以提交说明，不能自行批准正常归还。',
'Dahlia 预约保留到约定取件时刻后45分钟，过期只释放预约，不删除该人的历史借用记录。',
'Dahlia 借用收据保留180天，工具安全检查记录保留730天，两类记录独立管理。',
'Dahlia 雨天操作要求表\n| 场景 | 要求 |\n| 电动手钻室外作业 | 禁止 |\n| 手推车室外作业 | 归还后擦干检查 |',
'Dahlia 人工改期必须注明原时间、新时间、操作者和原因；改期不自动授予续借资格。',
'Dahlia 旧活动日曾开放每人5件，常设工具站仍执行同时3件。'],q:[
['事实','Dahlia 常设站一个人同时最多借几件？','3件',['A0']],
['表格','Dahlia 梯子能借多久，能续吗？','2天，不能续',['A2']],
['表格','Dahlia 手推车续一次后总借期是多少？','10天，前提符合续期条件',['A2','A3']],
['跨段落','Dahlia 手钻还在首个借期且别人已预约，可以续一次吗？','不能；已有下一预约禁止续期',['A2','A3']],
['跨段落','Dahlia 已借3件并预约今晚归还一件，现在能再借吗？','不能；现场验收才释放额度',['A0','A1']],
['跨文档','Dahlia 借用人自行声明损坏工具已修好能恢复借出吗？','不能；管理员确认安全且争议由管理员复核',['A4','B0']],
['跨文档','Dahlia 工具能转动但少附件，值班员可以忽略缺失吗？','不能，分别记录并验收',['A5','B0']],
['歧义','Dahlia 手钻连附件借走，这算两件吗？','随主工具算1件；附件独立借出才单计',['A0']],
['证据充分','Dahlia 预约超过取件时刻几分钟失效？','45分钟',['B1']],
['近事实干扰','Dahlia 活动日能借5件，平常也照办吗？','不能，常设站3件',['B5']],
['表格','Dahlia 下雨时手钻和手推车都禁止室外用吗？','不是；手钻禁止，手推车可用但归还擦干检查',['B3']],
['计算','Dahlia 安全检查记录比借用收据多留多少天？','550天',['B2']],
['跨文档','Dahlia 管理员改了还梯子的日期，是不是有一次续期权了？','不是；改期不自动授予续借，梯子0次',['A2','B4']],
['事实','Dahlia 过期预约会抹掉历史借用吗？','不会，只释放预约',['B1']],
['拒绝过度推断','Dahlia 把STOP标签擦掉就表示安全复核通过吗？','不是，管理员确认才可',['A4']],
['同义','Dahlia 修改约定日期需要留下哪些审计信息？','原时间、新时间、操作者、原因',['B4']]],u:['Dahlia 丢失一把手钻罚多少钱？','Dahlia 当前有几台闲置手推车？','Dahlia 推荐哪一型号电钻？','Dahlia 值班员家庭地址是什么？']},
{id:'elm',name:'Elm 天文观测排程',a:[
'Elm 观测台只处理虚构教学观测。每个申请最长90分钟，其中前15分钟用于设备校准，不能计为有效曝光。',
'Elm 将 SNR 定义为信噪比，教学目标为SNR不少于12。达到该值不表示发现新天体。',
'Elm 滤镜表\n| 滤镜 | 单次曝光 | 最大连续张数 |\n| R | 40秒 | 8 |\n| B | 60秒 | 5 |',
'Elm 云量大于六成时暂停曝光；云量恢复后重新校准，再继续未完成序列，不能把暂停时间记为曝光。',
'Elm 同一目标的不同滤镜结果分别保存。不能把R滤镜信噪比作为B滤镜达标证明。',
'Elm 预约确认仅说明获得时段，实际开机需要值班员确认设备状态；研究者不能远程绕过设备锁。'],b:[
'Elm 原始图像保留365天，处理后缩略图保留30天；删除缩略图不表示原始图像被删除。',
'Elm 中途设备故障时记录最后完成的帧号，恢复后从下一帧继续，已完成帧不得以补拍名义覆盖。',
'Elm 设备校准失败时由维护员处理，值班员负责暂停排程；研究者只可提交故障说明。',
'Elm 夜班交接必须记录申请号、滤镜、完成帧号与暂停原因；只有目标名称不足以恢复任务。',
'Elm 提前结束的剩余时段回到排程池，不自动转给同一申请人的另一个目标。',
'Elm 教学台不发布天体发现结论，也不提供天气预报；观测记录不能被当作未来晴天保证。'],q:[
['事实','Elm 最长申请含校准共多少分钟？','90分钟',['A0']],
['计算','Elm 90分钟申请扣除首次校准最多还剩多少分钟？','75分钟',['A0']],
['缩写','Elm SNR代表什么，教学阈值是多少？','信噪比；不少于12',['A1']],
['表格','Elm B滤镜最多连续曝光几张，每张多久？','5张，每张60秒',['A2']],
['表格','Elm R滤镜8张的曝光累计是多少秒？','320秒',['A2']],
['跨段落','Elm R达到SNR12但B未达标，能宣布两种滤镜都完成目标吗？','不能；分别保存与判断',['A1','A4']],
['跨文档','Elm 云散后设备校准仍失败，可以先曝光再补校准吗？','不能；重新校准，维护员处理失败，值班员暂停',['A3','B2']],
['跨段落','Elm 故障前完成第3帧，交班要提供哪些信息，从哪帧恢复？','申请号、滤镜、完成帧号、暂停原因；第4帧',['B1','B3']],
['歧义','Elm 收到预约确认是不是可以远程解锁开机？','不是；值班员确认设备状态',['A5']],
['证据充分','Elm 原始图像留多久？','365天',['B0']],
['近事实干扰','Elm 缩略图30天后删掉，原始图像也同时消失吗？','不是；原图保留365天',['B0']],
['拒绝过度推断','Elm 达到教学SNR阈值，可以宣布发现新天体吗？','不可以',['A1','B5']],
['跨段落','Elm 云量七成仍在预约时段内，能继续曝光吗？','不能；大于六成暂停',['A3','A5']],
['事实','Elm 提前结束后剩余时间自动给申请人的下一目标吗？','不会，回排程池',['B4']],
['事实','Elm 恢复故障时可以覆盖前三张完成图来保持连续吗？','不能；从下一帧继续且保留完成帧',['B1']],
['同义','Elm 交班只留目标名字，足够接班恢复吗？','不够；还需申请号、滤镜、帧号、暂停原因',['B3']]],u:['Elm 明晚具体有多少云量？','Elm 这张图中的天体叫什么？','Elm 望远镜的购买价格是多少？','Elm 下一次发现新天体会在哪天？']},
{id:'flint',name:'Flint 口述历史工作室',a:[
'Flint 口述历史工作室在录音前取得受访者授权。授权分别勾选内部整理和公开发布，允许内部整理不等于允许公开。',
'Flint 将匿名化定义为替换公开文本中的身份标识；原始授权记录仍由档案员保管，不随匿名文本公开。',
'Flint 文件保留表\n| 资料 | 期限 |\n| 临时转写草稿 | 14天 |\n| 经确认文字稿 | 5年 |\n| 授权记录 | 7年 |',
'Flint 转写不清的语句标记听辨不清并附时间码，不得为了行文流畅补写受访者未说的话。',
'Flint 修改文字稿需保留原句、修改后文本及确认人，事实订正与语言整理分开记录。',
'Flint 访谈者陈述属于个人回忆；同一细节获得两次重复讲述也不自动成为已证实历史事实。'],b:[
'Flint 公开发布前由编辑检查授权范围，档案员核对匿名化结果；两项通过后才可发布。',
'Flint 撤回公开授权后停止公开文本与音频访问，内部资料是否保留依原授权范围处理，不自动全部删除。',
'Flint 引用访谈必须包含访谈编号、录音时间码和文字稿版本；不以受访者姓名作为唯一定位。',
'Flint 审核表\n| 问题 | 处理 |\n| 第三人身份暴露 | 遮蔽后重新审核 |\n| 时间码缺失 | 补定位后审核 |\n| 不同版本句子冲突 | 保留版本并核验 |',
'Flint 受访者确认文字稿不自动扩大先前授权范围；新增公开渠道须重新取得明确同意。',
'Flint 音频仅供授权用途，不允许根据声线推断未记录的疾病、民族或政治立场。'],q:[
['事实','Flint 录音开始前必须取得什么？','受访者授权',['A0']],
['歧义','Flint 允许内部整理是否包含公开发布？','不包含，分别授权',['A0']],
['表格','Flint 临时转写草稿保存多久？','14天',['A2']],
['表格','Flint 授权记录比确认文字稿多保存几年？','2年',['A2']],
['跨段落','Flint 为匿名发布替换姓名后，原授权能一起公开吗？','不能；原授权由档案员保管',['A1']],
['跨文档','Flint 受访者确认稿件就能上新的公开平台吗？','不能；确认不扩大授权，新增渠道需同意',['A0','B4']],
['跨文档','Flint 一段话听不清但已有时间码，可以编顺句子通过审核吗？','不能；标听辨不清，不补写未说内容',['A3','B3']],
['跨文档','Flint 撤回公开授权之后，内部档案必须全部销毁吗？','不一定；停止公开，内部按原授权处理',['A0','B1']],
['证据充分','Flint 引用访谈需哪三个定位字段？','访谈编号、时间码、文字稿版本',['B2']],
['近事实干扰','Flint 两次录音重复同一细节，是否足以称为已证实事实？','不足；仍属于个人回忆',['A5']],
['跨段落','Flint 改错字与订正史实可以只留最终一句话吗？','不能；保留原句、修改文本、确认人且分开记录',['A4']],
['表格','Flint 两版句子冲突时直接删旧版是否符合审核表？','不符合；保留版本并核验',['B3']],
['事实','Flint 谁检查授权范围，谁核对匿名化？','编辑检查授权；档案员核对匿名化',['B0']],
['跨文档','Flint 公开稿暴露第三人姓名，已有发布授权可直接上网吗？','不能；遮蔽重新审核，授权和匿名化均需通过',['B0','B3']],
['拒绝过度推断','Flint 可以从受访者声线推断疾病并写进档案吗？','不允许',['B5']],
['同义','Flint 查找一句话只提供受访者名字够吗？','不够；需访谈编号、时间码、版本',['B2']]],u:['Flint 这位受访者患有什么疾病？','Flint 受访者未公开的真实身份证号是多少？','Flint 某场历史事件究竟发生在哪个日期？','Flint 下一次访谈受访者的具体姓名是什么？']}
];
export function shuffledIds(){let state=SEED>>>0;const ids=topics.map(t=>t.id);for(let i=ids.length-1;i>0;i--){state=(Math.imul(state,1664525)+1013904223)>>>0;const j=state%(i+1);[ids[i],ids[j]]=[ids[j],ids[i]];}return ids;}
export function build(){const order=shuffledIds(),splitOf=id=>['dev','validation','test'][Math.floor(order.indexOf(id)/2)],documents=[],questions=[];
for(const t of topics){const sources={};for(const kind of ['a','b']){const text=t[kind].join('\n\n')+'\n',documentName=t.id+'-'+kind+'.md';let offset=0;const paragraphs=t[kind].map((quote,i)=>{const p={paragraph:i+1,startOffset:offset,endOffset:offset+quote.length,quote};offset+=quote.length+2;return p;});sources[kind]={documentName,text,sourceHash:hash(Buffer.from(text)),paragraphs};documents.push({...sources[kind],topic:t.id,split:splitOf(t.id),license:'CC0-1.0'});}
const qs=[...t.q,...t.u.map(q=>['不可回答',q,null,[]])];qs.forEach(([category,question,expectedAnswer,refs],i)=>questions.push({id:`${t.id}-${String(i+1).padStart(3,'0')}`,question,answerable:expectedAnswer!==null,expectedAnswer,category,topic:t.id,group:t.id,split:splitOf(t.id),evidence:refs.flatMap((group,n)=>(Array.isArray(group)?group:[group]).map(ref=>{const d=sources[ref[0].toLowerCase()],p=d.paragraphs[+ref.slice(1)];return{documentName:d.documentName,sourceHash:d.sourceHash,page:1,...p,groupId:'g'+(n+1)};}))}));}
return{documents,dataset:{version:VERSION,seed:SEED,split:'all',questions},splitOrder:order};}
export function nearDuplicates(questions,threshold=.65){const grams=s=>new Set([...s.toLowerCase().replace(/[a-z0-9\s\p{P}]/gu,'')].map((_,i,a)=>a.slice(i,i+3).join('')).filter(x=>x.length===3));const pairs=[];for(let i=0;i<questions.length;i++)for(let j=i+1;j<questions.length;j++){const a=questions[i],b=questions[j];if(a.split===b.split)continue;const x=grams(a.question),y=grams(b.question),intersection=[...x].filter(g=>y.has(g)).length,score=intersection/(x.size+y.size-intersection||1);if(score>=threshold)pairs.push({left:a.id,right:b.id,jaccard:score});}return pairs;}
export function validate({documents,dataset}){const docs=new Map(documents.map(d=>[d.documentName,d])),ids=new Set(),texts=new Set();for(const q of dataset.questions){if(ids.has(q.id)||texts.has(q.question))throw Error('duplicate question');ids.add(q.id);texts.add(q.question);if(q.answerable!==!!q.evidence.length)throw Error('answerability evidence mismatch');for(const e of q.evidence){const d=docs.get(e.documentName);if(!d||d.topic!==q.topic||d.split!==q.split)throw Error('cross split evidence');if(hash(Buffer.from(d.text))!==e.sourceHash||d.text.slice(e.startOffset,e.endOffset)!==e.quote)throw Error('invalid evidence location/hash');if(d.paragraphs[e.paragraph-1]?.quote!==e.quote||e.page!==1||!e.groupId)throw Error('invalid paragraph/group');}}const pairs=nearDuplicates(dataset.questions);if(pairs.length)throw Error('cross-split near duplicate: '+JSON.stringify(pairs));return true;}
export function generate(root=resolve('samples/phase3-quality')){const result=build();validate(result);mkdirSync(join(root,'documents'),{recursive:true});const write=(p,x)=>writeFileSync(join(root,p),typeof x==='string'?x:JSON.stringify(x,null,2)+'\n');for(const d of result.documents)write('documents/'+d.documentName,d.text);write('evaluation.json',result.dataset);for(const split of ['dev','validation','test'])write(split+'.json',{...result.dataset,split,questions:result.dataset.questions.filter(q=>q.split===split)});write('LICENSE','CC0 1.0 Universal\nThese original fictional documents, questions and answer keys are dedicated to the public domain under CC0 1.0.\nhttps://creativecommons.org/publicdomain/zero/1.0/legalcode\nNo real persons, operational policies, or externally sourced texts are represented.\n');write('near-duplicate-audit.json',{algorithm:'Chinese character trigram Jaccard; remove ASCII letters/digits, whitespace and punctuation; cross-split pairs only',threshold:.65,pairs:nearDuplicates(result.dataset.questions),limitation:'Lexical screen only, not proof of semantic independence. Authored whole-topic grouping is the primary isolation rule.'});const files=[...result.documents.map(d=>'documents/'+d.documentName),'evaluation.json','dev.json','validation.json','test.json','LICENSE','near-duplicate-audit.json'];write('manifest.json',{version:VERSION,seed:SEED,splitPolicy:'LCG Fisher-Yates on six authored topics; first two dev, next two validation, last two test. Both documents and all questions remain in their topic split.',splitOrder:result.splitOrder,createdBeforeTuning:true,humanReviewed:false,counts:{documents:result.documents.length,questions:result.dataset.questions.length,answerable:96,unanswerable:24,dev:40,validation:40,test:40},documents:result.documents.map(({text,paragraphs,...d})=>({...d,bytes:Buffer.byteLength(text),paragraphs:paragraphs.length})),evidenceSemantics:'Every distinct groupId required; any label within a group is an acceptable alternative. UTF-16 offsets on LF-normalized complete Markdown text, end exclusive. Hash is exact UTF-8 source bytes.',generator:{path:'scripts/generate-phase3-quality.mjs',sha256:hash(readFileSync(fileURLToPath(import.meta.url)))},files:files.map(path=>({path,sha256:hash(readFileSync(join(root,path)))}))});write('manifest.sha256',hash(readFileSync(join(root,'manifest.json')))+'  manifest.json\n');return result;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=generate();console.log(JSON.stringify({questions:r.dataset.questions.length,documents:r.documents.length,splitOrder:r.splitOrder,humanReviews:0}));}
