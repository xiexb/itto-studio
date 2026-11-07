import { KIND } from './constants'

const cache = new Map()

/** 依据交付物名称推断类型：组件 / 文件 / 交付 / 绩效 / 变更 / 环境 / 其他 */
export function classify(name) {
  const n = String(name)
  const c = n.replace(/[（(]更新[)）]/g, '') // 半/全角括号的“更新”后缀不影响类型
  if (cache.has(n)) return cache.get(n)
  let k = 'other'
  if (/^(事业环境因素|组织过程资产)$/.test(c)) k = 'env'
  else if (/^商业文件/.test(c)) k = 'other'
  else if (/变更请求/.test(c)) k = 'chg'
  else if (/^工作绩效(数据|信息|报告)$/.test(c)) k = 'perf'
  else if (/可交付成果|最终产品|移交/.test(c)) k = 'deliv'
  else if (/^项目管理计划$/.test(c) || /管理计划$/.test(c) || /基准$/.test(c) || /参与计划$/.test(c)) k = 'plan'
  else if (/登记册|日志|清单|文件|文档|属性|说明书|矩阵|报告|指标$|测量结果|日历|需求|章程|网络图|派工单|分配单|分解结构|估算|依据|评价|决策|建议书|卖方|关闭|数据|预测|审计|策略|供方选择标准|沟通记录|进度计划/.test(c)) k = 'pdoc'
  cache.set(n, k)
  return k
}

export const kindOf = (name) => KIND[classify(name)]

/** 统计一组交付物里各类型的数量 */
export function kindCounts(names) {
  const m = {}
  for (const n of names) {
    const k = classify(n)
    m[k] = (m[k] || 0) + 1
  }
  return m
}

export function coreName(name) {
  return String(name)
    .replace(/[（(]更新[)）]/g, '')
    .replace(/更新$/, '')
    .trim()
}