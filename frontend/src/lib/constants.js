/* 领域、过程组、交付物类型、黄金链路、变更闭环等静态元数据 */

export const GROUPS = ['启动', '规划', '执行', '监控', '收尾']

export const GROUP_COLOR = {
  启动: '#2563EB',
  规划: '#7C3AED',
  执行: '#059669',
  监控: '#EA580C',
  收尾: '#475569',
}

export const GROUP_BG = {
  启动: 'linear-gradient(135deg,#3B82F6,#1D4ED8)',
  规划: 'linear-gradient(135deg,#8B5CF6,#6D28D9)',
  执行: 'linear-gradient(135deg,#10B981,#047857)',
  监控: 'linear-gradient(135deg,#F97316,#C2410C)',
  收尾: 'linear-gradient(135deg,#64748B,#334155)',
}

/* 行顺序 = 教程第十~十七章的领域顺序 */
export const DOMAIN_META = [
  { name: '整合管理', en: 'Integration', color: '#2563EB' },
  { name: '范围管理', en: 'Scope', color: '#0891B2' },
  { name: '进度管理', en: 'Schedule', color: '#7C3AED' },
  { name: '成本管理', en: 'Cost', color: '#CA8A04' },
  { name: '质量管理', en: 'Quality', color: '#DB2777' },
  { name: '资源管理', en: 'Resource', color: '#059669' },
  { name: '沟通管理', en: 'Communication', color: '#C026D3' },
  { name: '风险管理', en: 'Risk', color: '#DC2626' },
  { name: '采购管理', en: 'Procurement', color: '#EA580C' },
  { name: '干系人管理', en: 'Stakeholder', color: '#4F46E5' },
]

export const DOMAIN_ORDER = DOMAIN_META.map(d => d.name)
export const DOMAIN_COLOR = Object.fromEntries(DOMAIN_META.map(d => [d.name, d.color]))
export const DOMAIN_EN = Object.fromEntries(DOMAIN_META.map(d => [d.name, d.en]))

/* ---------------- 交付物类型 ---------------- */
export const KIND = {
  plan:  { label: '项目管理计划组件（子计划 / 基准）', short: '组件', color: '#4338CA', bg: '#EEF0FF', bd: '#C7CBFA' },
  pdoc:  { label: '项目文件',                       short: '文件', color: '#0E7490', bg: '#E7F6F9', bd: '#B8E2EA' },
  deliv: { label: '可交付成果',                     short: '交付', color: '#C2410C', bg: '#FEF1E7', bd: '#F8D2B4' },
  perf:  { label: '工作绩效数据 / 信息 / 报告',      short: '绩效', color: '#A16207', bg: '#FDF7E3', bd: '#F0DFA8' },
  chg:   { label: '变更请求',                       short: '变更', color: '#B91C1C', bg: '#FDECEC', bd: '#F6C5C5' },
  env:   { label: '事业环境因素 / 组织过程资产',      short: '环境', color: '#475569', bg: '#F1F5F9', bd: '#D8E1EC' },
  other: { label: '其他依据（商业文件 / 协议等）',     short: '其他', color: '#64748B', bg: '#F6F8FB', bd: '#E2E9F2' },
}
export const KIND_ORDER = ['plan', 'pdoc', 'deliv', 'perf', 'chg', 'env', 'other']

/* ---------------- 线型：宽度分层 + 虚线节奏差异，一眼可辨 ----------------
 * main   实线 2.6px —— 主交付物，最重
 * change 长虚线 2.3px —— 变更流转，节奏最疏
 * plan   中虚线 1.7px —— 计划组件 / 基准，中等密度
 * perf   点线 1.4px —— 绩效与数据，最细最密
 * data   短虚线 1.4px —— 项目文件细流，比点线稍长、密度略低
 */
export const EDGE_STYLE = {
  main:   { width: 2.6, dash: '',        opacity: 0.95, label: '主交付物', bg: 'rgba(30,41,59,.09)' },
  change: { width: 2.3, dash: '11 6',    opacity: 0.95, label: '变更流转', bg: 'rgba(220,38,38,.09)' },
  plan:   { width: 1.7, dash: '5 4',     opacity: 0.8,  label: '计划组件 / 基准', bg: 'rgba(124,58,237,.09)' },
  perf:   { width: 1.4, dash: '1.5 4',   opacity: 0.75, label: '绩效与数据', bg: 'rgba(161,98,7,.1)' },
  data:   { width: 1.4, dash: '3 4.5',   opacity: 0.75, label: '项目文件细流', bg: 'rgba(100,116,139,.1)' },
}

export const EDGE_PALETTE = {
  out:  { stroke: '#2563EB', flow: '#93C5FD', name: '输出' },
  in:   { stroke: '#059669', flow: '#6EE7B7', name: '输入' },
  gold: { stroke: '#7C3AED', flow: '#C4B5FD', name: '黄金链路' },
  chg:  { stroke: '#DC2626', flow: '#FCA5A5', name: '变更请求' },
  chga: { stroke: '#B91C1C', flow: '#FCA5A5', name: '批准的变更' },
}

/* 黄金链路：案例题主干 */
export const GOLDEN = [
  ['制定项目章程', '识别干系人'],
  ['制定项目章程', '制订项目管理计划'],
  ['制订项目管理计划', '收集需求'],
  ['收集需求', '定义范围'],
  ['定义范围', '创建WBS'],
  ['创建WBS', '定义活动'],
  ['定义活动', '排列活动顺序'],
  ['排列活动顺序', '制订进度计划'],
  ['制订进度计划', '指导与管理项目工作'],
  ['指导与管理项目工作', '控制质量'],
  ['控制质量', '确认范围'],
  ['确认范围', '结束项目或阶段'],
  ['指导与管理项目工作', '监控项目工作'],
  ['监控项目工作', '实施整体变更控制'],
  ['实施整体变更控制', '指导与管理项目工作'],
  ['管理项目知识', '结束项目或阶段'],
]

/* ---------------- 变更闭环 ---------------- */
export const CHG_STEPS = [
  { n: '①', t: '提出变更请求', d: '发现偏差 / 缺陷 / 新需求',
    procs: ['指导与管理项目工作', '控制质量', '监控项目工作'], objs: ['变更请求'] },
  { n: '②', t: '记录与评估影响', d: '登记变更日志，分析对基准的影响',
    procs: ['实施整体变更控制'], objs: ['变更请求', '工作绩效报告', '项目管理计划', '项目文件'] },
  { n: '③', t: 'CCB 审批', d: '批准或拒绝，形成决议',
    procs: ['实施整体变更控制'], objs: ['批准的变更请求'] },
  { n: '④', t: '更新组件与项目文件', d: '修订受影响的基准 / 子计划 / 文件',
    procs: ['实施整体变更控制'], objs: ['项目管理计划（更新）', '项目文件（更新）', '变更日志'] },
  { n: '⑤', t: '实施已批准变更', d: '按新基准执行，产出新交付物',
    procs: ['指导与管理项目工作'], objs: ['可交付成果', '工作绩效数据'] },
  { n: '⑥', t: '验证与确认', d: '控制质量核实 → 确认范围验收 → 收尾',
    procs: ['控制质量', '确认范围', '结束项目或阶段'], objs: ['核实的可交付成果', '验收的可交付成果', '最终产品移交'] },
]

export const CHG_EDGES = [
  ['指导与管理项目工作', '实施整体变更控制', '变更请求', 'change'],
  ['控制质量', '实施整体变更控制', '变更请求', 'change'],
  ['监控项目工作', '实施整体变更控制', '工作绩效报告', 'change'],
  ['实施整体变更控制', '指导与管理项目工作', '批准的变更请求', 'change'],
  ['实施整体变更控制', '控制质量', '批准的变更请求', 'change'],
  ['控制质量', '确认范围', '核实的可交付成果', 'main'],
  ['确认范围', '结束项目或阶段', '验收的可交付成果', 'main'],
]

export const CHG_MARK = {
  实施整体变更控制: '②③④',
  指导与管理项目工作: '①⑤',
  控制质量: '⑥',
  确认范围: '⑥',
}

export const CHG_DOMAINS = [
  { name: '范围', color: '#2563EB', plan: ['范围管理计划', '需求管理计划', '范围基准'],
    doc: ['需求文件', '需求跟踪矩阵', '项目范围说明书'] },
  { name: '进度', color: '#7C3AED', plan: ['进度管理计划', '进度基准'],
    doc: ['活动清单', '活动属性', '里程碑清单', '项目进度计划', '项目进度网络图', '持续时间估算'] },
  { name: '成本', color: '#0D9488', plan: ['成本管理计划', '成本基准'],
    doc: ['成本估算', '成本预测', '项目资金需求'] },
  { name: '质量', color: '#EA580C', plan: ['质量管理计划'],
    doc: ['质量测量指标', '质量报告', '质量控制测量结果', '测试与评估文件'] },
  { name: '资源', color: '#0891B2', plan: ['资源管理计划'],
    doc: ['资源需求', '资源分解结构', '资源日历', '项目团队派工单', '团队章程'] },
  { name: '沟通', color: '#4F46E5', plan: ['沟通管理计划'],
    doc: ['项目沟通记录'] },
  { name: '风险', color: '#B45309', plan: ['风险管理计划'],
    doc: ['风险登记册', '风险报告'] },
  { name: '采购', color: '#475569', plan: ['采购管理计划'],
    doc: ['采购策略', '采购工作说明书', '采购文档', '供方选择标准', '选定的卖方', '协议'] },
  { name: '干系人', color: '#DB2777', plan: ['干系人参与计划'],
    doc: ['干系人登记册'] },
]