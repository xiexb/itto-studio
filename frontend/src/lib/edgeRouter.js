/**
 * 边路由：把「过程 → 过程 + 交付物」的原始关系，编译成可直接渲染的 SVG 路径。
 *
 * 设计要点：
 *  1. 卡片按名称实际长度显示（左对齐），同列卡片左缘一致 —— 用左缘判断同列；
 *  2. 同一对过程之间的多条交付物合并成一条线，线宽 / 箭头全局一致，虚线样式表达流转性质；
 *  3. 同列相邻 → 端口到端口的竖直连线；同列远距离 → 右侧通道，
 *     通道按「跨度最长在外侧」分配车道，多条线不再叠成一根粗线；
 *  4. 跨列 → 三次贝塞尔曲线，箭头角度对齐曲线末端切线；
 *  5. 同行跨列且中间隔着其它卡片 → 一律从行下方的水平通道绕行，
 *     两端都走卡片宽度中点（下边出线 → 下边进线），整条线呈对称的「U」形；
 *     车道按「跨度越长离卡片越远」嵌套展开，并整体压缩进行下方的可用空隙，
 *     既不会压穿中间卡片，也不会压到下一行。
 */

const GAP = 3
/* 绕行车道离行边缘的最小距离：再近就会和箭头（~9px）糊在一起 */
const LANE_MIN = 12

/* ---------------- 聚合 ---------------- */
export function aggregateEdges(edges) {
  const map = new Map()
  for (const e of edges) {
    if (!Array.isArray(e) || e.length < 3) continue
    const [from, to, art] = e
    const kind = e[3] || 'main'
    const key = from + '\u0001' + to
    let g = map.get(key)
    if (!g) {
      g = { key, from, to, arts: [], kinds: [] }
      map.set(key, g)
    }
    if (!g.arts.some((a) => a.name === art)) g.arts.push({ name: art, kind })
    if (!g.kinds.includes(kind)) g.kinds.push(kind)
  }
  return [...map.values()]
}

const PRIORITY = ['main', 'change', 'plan', 'perf', 'data']
export function styleKindOf(kinds) {
  for (const k of PRIORITY) if (kinds.includes(k)) return k
  return 'main'
}

/* ---------------- 几何 ---------------- */
function anchor(box, side, off = 0) {
  switch (side) {
    case 'top':    return { x: box.cx + off, y: box.y - GAP }
    case 'bottom': return { x: box.cx + off, y: box.y + box.h + GAP }
    case 'left':   return { x: box.x - GAP, y: box.cy + off }
    default:       return { x: box.x + box.w + GAP, y: box.cy + off }
  }
}

/** 卡片按名称长度自适应且左对齐：同列卡片左缘一致，用左缘判断同列 */
function sameColumn(A, B) {
  return Math.abs(A.x - B.x) < 26
}

/** 同列时，目标卡片上方 / 下方还剩多少空隙（决定通道入口的过渡长度） */
function roomOf(boxes, target, dir) {
  let best = dir > 0 ? Infinity : -Infinity
  for (const b of boxes) {
    if (b === target) continue
    if (!sameColumn(b, target)) continue
    if (dir > 0) {
      const bottom = b.y + b.h
      if (bottom <= target.y + 1) best = Math.min(best, target.y - bottom)
    } else {
      if (b.y >= target.y + target.h - 1) best = Math.min(best, b.y - (target.y + target.h))
    }
  }
  if (!Number.isFinite(best)) return 46
  return Math.max(0, best)
}

/** 两张同列卡片之间是否被别的卡片挡住：没有遮挡就走直线 */
function blockedBetween(boxes, A, B) {
  const lo = Math.min(A.y + A.h, B.y + B.h)
  const hi = Math.max(A.y, B.y)
  if (hi <= lo + 1) return true
  for (const c of boxes) {
    if (c === A || c === B) continue
    if (!sameColumn(c, A)) continue
    if (c.y < hi - 1 && c.y + c.h > lo + 1) return true
  }
  return false
}

/** A、B 是否在同一行（垂直方向重叠） */
function sameRow(A, B) {
  return Math.abs(A.cy - B.cy) < Math.max(A.h, B.h) * 0.45
}

/** 同行跨列时，A、B 之间的水平带上是否隔着其它卡片 */
function blockedInRow(boxes, A, B) {
  const lo = Math.min(A.x + A.w, B.x + B.w)
  const hi = Math.max(A.x, B.x)
  for (const c of boxes) {
    if (c === A || c === B) continue
    if (!sameRow(c, A)) continue
    if (c.x > lo + 1 && c.x + c.w < hi - 1) return true
  }
  return false
}

/** 行上方 / 下方各有多少空隙可用来绕行（只统计与 A、B 水平跨度重叠的行外卡片） */
function rowRoomOf(boxes, A, B, dir) {
  const rowTop = Math.min(A.y, B.y)
  const rowBottom = Math.max(A.y + A.h, B.y + B.h)
  const loX = Math.min(A.x, B.x)
  const hiX = Math.max(A.x + A.w, B.x + B.w)
  let best = Infinity
  for (const c of boxes) {
    if (c === A || c === B) continue
    /* 只关心与两端点水平跨度有重叠的卡片 */
    if (c.x + c.w < loX - 1 || c.x > hiX + 1) continue
    if (dir > 0) {
      /* 上方：卡片整体在 rowTop 之上，间隙 = rowTop - 卡片底 */
      if (c.y + c.h > rowTop - 1) continue
      best = Math.min(best, rowTop - (c.y + c.h))
    } else {
      /* 下方：卡片整体在 rowBottom 之下，间隙 = 卡片顶 - rowBottom */
      if (c.y < rowBottom + 1) continue
      best = Math.min(best, c.y - rowBottom)
    }
  }
  if (!Number.isFinite(best)) return 60
  return Math.max(0, best)
}

function planRoute(A, B, boxes) {
  if (sameColumn(A, B)) {
    const down = B.cy > A.cy
    if (!blockedBetween(boxes, A, B)) {
      return { mode: 'v', sides: [down ? 'bottom' : 'top', down ? 'top' : 'bottom'], down }
    }
    const room = roomOf(boxes, B, down ? 1 : -1)
    return { mode: 'chan', sides: ['right', down ? 'top' : 'bottom'], down, room }
  }
  const toRight = B.cx > A.cx
  if (sameRow(A, B) && blockedInRow(boxes, A, B)) {
    /* 同行被隔断：统一从行下方绕行 —— 上方往往撞 sticky 列头或上一行卡片
     * （首行上方根本没有卡片，roomUp 会拿到默认值 60，于是总是被判成「从上方绕」），
     * 下方是行间空隙，走线更干净。两端都走卡片宽度中点（下边出线 → 下边进线），
     * 与纵向通道的进出线方式一致；车道偏移由主入口按可用空隙统一分配 */
    return { mode: 'hrow', sides: ['bottom', 'bottom'], toRight, up: false, lane: 0 }
  }
  return { mode: 's', sides: [toRight ? 'right' : 'left', toRight ? 'left' : 'right'], toRight }
}

/**
 * 端口分配：
 *  - 右侧扇出 / 左侧扇入：按对端高度排序，在卡片高度范围内均匀散开；
 *  - 顶部 / 底部端口：按对端水平位置排序后散开；
 *  - 通道边（chan）：入口走卡片顶/底中点，不占侧边端口。
 */
function assignPorts(items) {
  const groups = new Map()
  const push = (key, entry) => {
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }
  for (const it of items) {
    push(it.pair.from + '\u0001' + it.route.sides[0], { it, which: 'a', box: it.A, peer: it.B })
    push(it.pair.to + '\u0001' + it.route.sides[1], { it, which: 'b', box: it.B, peer: it.A })
  }
  for (const [key, arr] of groups) {
    const side = key.split('\u0001')[1]
    const vertical = side === 'left' || side === 'right'
    arr.sort((p, q) => (vertical ? p.peer.cy - q.peer.cy : p.peer.cx - q.peer.cx))
    const n = arr.length
    const box = arr[0].box
    const span = Math.max(7, (vertical ? box.h : box.w) / 2 - 14)
    const step = Math.min(10, (span * 2) / Math.max(n, 1))
    arr.forEach((ent, i) => {
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * step
      if (ent.which === 'a') ent.it.offA = off
      else ent.it.offB = off
    })
  }
  for (const it of items) {
    if (it.offA === undefined) it.offA = 0
    if (it.offB === undefined) it.offB = 0
  }
}

/* ---------------- 三种路径 ---------------- */
function pathVertical(it) {
  const { A, B, route } = it
  const down = route.down
  const x = (A.cx + it.offA + B.cx + it.offB) / 2
  if (down) {
    const y1 = A.y + A.h + GAP
    const y2 = B.y - GAP
    if (y2 - y1 < 2) return null
    return { d: `M${r(x)},${r(y1)} L${r(x)},${r(y2)}`, end: { x, y: y2, deg: 90 } }
  }
  const y1 = A.y - GAP
  const y2 = B.y + B.h + GAP
  if (y1 - y2 < 2) return null
  return { d: `M${r(x)},${r(y1)} L${r(x)},${r(y2)}`, end: { x, y: y2, deg: -90 } }
}

function pathS(it) {
  const { A, B, route } = it
  const toRight = route.toRight
  const p1 = anchor(A, toRight ? 'right' : 'left', it.offA)
  const p2 = anchor(B, toRight ? 'left' : 'right', it.offB)
  const dx = toRight ? p2.x - p1.x : p1.x - p2.x
  if (dx < 4) return null
  const s = toRight ? 1 : -1
  /* 扇形展开：端口外扩越大，控制距离越大，曲线更舒展不易交叠 */
  const spread = Math.min(Math.abs(it.offA), 26) + Math.min(Math.abs(it.offB), 26)
  const c = Math.min(120, Math.max(18, dx * 0.52 + spread * 0.9))
  const vy = (p2.y - p1.y) * 0.12
  const d = `M${r(p1.x)},${r(p1.y)} C${r(p1.x + s * c)},${r(p1.y + vy)} ${r(p2.x - s * c)},${r(p2.y - vy)} ${r(p2.x)},${r(p2.y)}`
  /* 箭头角度对齐曲线末端切线 */
  const t = tangentOf(d)
  return { d, end: { x: p2.x, y: p2.y, deg: t } }
}

function pathChannel(it) {
  const { A, B, route } = it
  const down = route.down
  const dir = down ? 1 : -1
  const start = anchor(A, 'right', it.offA)
  const end = anchor(B, down ? 'top' : 'bottom', it.offB)

  const maxRight = Math.max(A.x + A.w, B.x + B.w)
  const chX = maxRight + 16 + (it.lane || 0) * 11

  const room = Math.max(9, Math.min(30, (route.room || 30) * 0.62))
  const yEntry = end.y - dir * room

  const dy = Math.abs(yEntry - start.y)
  if (dy < 8) return null

  const r1 = Math.max(4, Math.min(12, dy / 2 - 1, chX - start.x - 4))
  const r2 = Math.max(4, Math.min(9, room / 2))

  const d = [
    `M${r(start.x)},${r(start.y)}`,
    `H${r(chX - r1)}`,
    `Q${r(chX)},${r(start.y)} ${r(chX)},${r(start.y + dir * r1)}`,
    `V${r(yEntry - dir * r1)}`,
    `Q${r(chX)},${r(yEntry)} ${r(chX - r1)},${r(yEntry)}`,
    `H${r(end.x + r2)}`,
    `Q${r(end.x)},${r(yEntry)} ${r(end.x)},${r(yEntry + dir * r2)}`,
    `V${r(end.y)}`,
  ].join(' ')

  return { d, end: { x: end.x, y: end.y, deg: down ? 90 : -90 } }
}

const r = (n) => Math.round(n * 10) / 10

/**
 * 同行绕行通道：从出发卡片宽度中点竖直落到行下方车道 → 水平越过中间卡片 → 从目标卡片宽度中点竖直升入。
 * 车道偏移 laneOff 由主入口按「行下方可用空隙」分配，跨度长的边在外侧车道，嵌套展开互不交叠。
 */
function pathRowChannel(it) {
  const { A, B, route } = it
  const up = route.up
  const dir = up ? -1 : 1
  /* 出发点同样走卡片宽度中点：出线边与进线边一致，不再从侧边端口斜插出去 */
  const start = anchor(A, up ? 'top' : 'bottom', it.offA)
  const end = anchor(B, up ? 'top' : 'bottom', it.offB)

  const rowTop = Math.min(A.y, B.y)
  const rowBottom = Math.max(A.y + A.h, B.y + B.h)
  const edgeY = up ? rowTop : rowBottom
  const laneOff = it.laneOff !== undefined ? it.laneOff : 22 + (it.lane || 0) * 11
  const chY = edgeY + dir * laneOff

  const dyA = Math.abs(chY - start.y)
  const dyB = Math.abs(chY - end.y)
  if (dyA < 8 && dyB < 8) return null

  /* 起终点的水平行进方向：从 start 面向 end（两端都是宽度中点，直接比坐标最稳） */
  const sx = end.x >= start.x ? 1 : -1
  const rA = Math.max(4, Math.min(12, dyA / 2 - 1))
  const rB = Math.max(4, Math.min(12, dyB / 2 - 1))

  const d = [
    `M${r(start.x)},${r(start.y)}`,
    `V${r(chY - dir * rA)}`,
    `Q${r(start.x)},${r(chY)} ${r(start.x + sx * rA)},${r(chY)}`,
    `H${r(end.x - sx * rB)}`,
    `Q${r(end.x)},${r(chY)} ${r(end.x)},${r(chY - dir * rB)}`,
    `V${r(end.y)}`,
  ].join(' ')

  /* 箭头沿末端竖直段的真实运动方向：向上绕行时末端向下进卡片（+90），向下绕行时向上进卡片（-90） */
  return { d, end: { x: end.x, y: end.y, deg: up ? 90 : -90 } }
}

/** 从 path 的 d 属性里取末端切线角度：采样末段两点 */
function tangentOf(d) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)
  if (!nums || nums.length < 4) return 0
  const v = nums.map(Number)
  /* C 曲线：末两点 = 控制点2 → 终点 */
  const x2 = v[v.length - 4], y2 = v[v.length - 3]
  const x1 = v[v.length - 2], y1 = v[v.length - 1]
  const deg = (Math.atan2(y1 - y2, x1 - x2) * 180) / Math.PI
  return Math.round(deg * 10) / 10
}

/* ---------------- 颜色 ---------------- */
function colorKeyOf(pair, mode, active, kind) {
  if (mode === 'gold' || mode === 'golden') {
    /* 黄金链路模式下点选过程叠加的主要输入输出：沿用绿/蓝方向色，与紫色链路区分；
     * 方向以「当前点选的过程」为准，不属于当前点选的线参考它自己的点选过程 */
    if (pair.overlay) {
      const focus = pair.from === active || pair.to === active ? active : pair.peekOf
      return pair.from === focus ? 'out' : 'in'
    }
    return 'gold'
  }
  if (mode === 'change') {
    const art = pair.arts[0] ? pair.arts[0].name : ''
    return /^批准/.test(art) ? 'chga' : 'chg'
  }
  /* 纯净模式：颜色 = 连线类型 × 方向 双色（深=输入、亮=输出），与顶部图例 chip 同源；
   * 先前点选过程的关系以它自己的点选过程判断方向 */
  const focus = active && (pair.from === active || pair.to === active) ? active : pair.peekOf || active
  return pair.from === focus ? kind + '-out' : kind + '-in'
}

/* ---------------- 主入口 ---------------- */
export function layoutEdges(pairs, boxes, opts = {}) {
  const { mode = 'sel', active = null } = opts
  const boxArr = Object.values(boxes)
  const pairKeys = new Set(pairs.map((p) => p.key))

  const items = []
  for (const pair of pairs) {
    const A = boxes[pair.from]
    const B = boxes[pair.to]
    if (!A || !B) continue
    const route = planRoute(A, B, boxArr)
    items.push({
      pair,
      A,
      B,
      route,
      reverse: pairKeys.has(pair.to + '\u0001' + pair.from),
      lane: 0,
      offA: 0,
      offB: 0,
    })
  }

  /* 通道车道分配：同一条竖线上的边按跨度排序，跨度最长走最外侧车道 */
  const chans = items.filter((it) => it.route.mode === 'chan')
  const byX = new Map()
  for (const it of chans) {
    const x = Math.max(it.A.x + it.A.w, it.B.x + it.B.w)
    const key = Math.round(x / 30)
    if (!byX.has(key)) byX.set(key, [])
    byX.get(key).push(it)
  }
  for (const arr of byX.values()) {
    arr.sort((p, q) => {
      const sp = Math.abs(p.B.cy - p.A.cy)
      const sq = Math.abs(q.B.cy - q.A.cy)
      return sq - sp
    })
    arr.forEach((it, i) => {
      it.lane = i
    })
  }

  /* 同行绕行车道：同一行的绕行线共享行下方通道，跨度最长在外侧；
   * 车道带整体压缩进「行下边缘 → 下一张卡片」的可用空隙，避免压到下一行 */
  const hrows = items.filter((it) => it.route.mode === 'hrow')
  const byBand = new Map()
  for (const it of hrows) {
    const key = Math.round(Math.min(it.A.y, it.B.y) / 40)
    if (!byBand.has(key)) byBand.set(key, [])
    byBand.get(key).push(it)
  }
  for (const arr of byBand.values()) {
    arr.sort((p, q) => Math.abs(q.B.cx - q.A.cx) - Math.abs(p.B.cx - p.A.cx))
    const room = Math.min(...arr.map((it) => rowRoomOf(boxArr, it.A, it.B, -1)))
    const usable = Math.max(LANE_MIN, room - 6)
    const n = arr.length
    /* 期望车道 22 / 33 / 44…；空隙不够就整体下压并收窄间距，
     * 但始终保证各车道互不重合（否则多条线会叠成一根粗线） */
    const step = n > 1 ? Math.min(11, (usable - LANE_MIN) / (n - 1)) : 0
    const inner = Math.min(22, Math.max(LANE_MIN, usable - (n - 1) * step))
    arr.forEach((it, i) => {
      it.lane = i
      /* i = 0 是跨度最长的边 → 走最外侧车道 */
      it.laneOff = inner + (n - 1 - i) * step
    })
  }

  assignPorts(items)

  const out = []
  for (const it of items) {
    let geo = null
    if (it.route.mode === 'v') geo = pathVertical(it)
    else if (it.route.mode === 'chan') geo = pathChannel(it)
    else if (it.route.mode === 'hrow') geo = pathRowChannel(it)
    else geo = pathS(it)
    if (!geo) continue

    const pair = it.pair
    const kind = styleKindOf(pair.kinds)
    const touches = pair.from === active || pair.to === active
    out.push({
      key: pair.key,
      from: pair.from,
      to: pair.to,
      arts: pair.arts,
      kind,
      colorKey: colorKeyOf(pair, mode, active, kind),
      /* 变更闭环模式下选中过程：相关边高亮、无关边压暗 */
      dim: mode === 'change' && !!active && !touches,
      hi: mode === 'change' && !!active && touches,
      /* 黄金链路模式下先前点选过程叠加的线压淡 */
      faint: !!pair.faint,
      d: geo.d,
      end: geo.end,
      title: `${pair.from} → ${pair.to}\n${pair.arts.map((a) => a.name).join('、')}`,
    })
  }

  /* 主交付物画在最上层，细流压底 */
  const order = { main: 2, change: 2, plan: 1, perf: 0, data: 0 }
  out.sort((a, b) => (order[a.kind] ?? 0) - (order[b.kind] ?? 0))
  return out
}
