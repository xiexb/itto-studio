/**
 * 轻量 Markdown 渲染器（零依赖）
 *
 * 支持：
 *   - 标题 # ~ ######
 *   - 段落、软换行（保留笔记里的换行）
 *   - 粗体 **、斜体 *、删除线 ~~、行内代码 `
 *   - 代码块 ``` / ~~~
 *   - 有序 / 无序列表（含缩进嵌套）
 *   - 引用 >、分割线 ---
 *   - 链接 [text](url)（仅允许 http(s) / mailto / 站内相对路径）
 *   - GFM 表格
 *
 * 安全：所有原文都经过 HTML 转义，任何 HTML 标签都不会被当成标签执行。
 * @ 交付物提及通过 options.mentions / options.renderMention 交给调用方生成 chip。
 */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c])
}

const RE_HEAD = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const RE_HR = /^\s{0,3}(?:(?:\*\s*){3,}|(?:\-\s*){3,}|(?:_\s*){3,})$/
const RE_FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/
const RE_QUOTE = /^\s{0,3}>\s?(.*)$/
const RE_UL = /^(\s{0,16})([-*+])\s+(.*)$/
const RE_OL = /^(\s{0,16})(\d{1,9})[.)]\s+(.*)$/

function indentOf(line) {
  const m = line.match(/^(\s*)/)
  return m ? m[1].replace(/\t/g, '    ').length : 0
}

function isBlank(line) {
  return !String(line ?? '').trim()
}

function splitRow(line) {
  let s = String(line).trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

function isTableDelim(line) {
  if (!line || !line.includes('|') || !line.includes('-')) return false
  const cells = splitRow(line)
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c))
}

function isBlockStart(line, nextLine) {
  return (
    RE_FENCE.test(line) ||
    RE_HEAD.test(line) ||
    RE_HR.test(line) ||
    RE_QUOTE.test(line) ||
    RE_UL.test(line) ||
    RE_OL.test(line) ||
    (line.includes('|') && nextLine !== undefined && isTableDelim(nextLine))
  )
}

function safeUrl(url) {
  const u = String(url ?? '').trim()
  if (!u) return ''
  return /^(https?:\/\/|mailto:|#|\/|\.{1,2}\/)/i.test(u) ? u : ''
}

function buildMentions(opts) {
  const names = Array.isArray(opts.mentions) ? opts.mentions.filter(Boolean) : []
  const render = typeof opts.renderMention === 'function' ? opts.renderMention : null
  return names
    .slice()
    .sort((a, b) => String(b).length - String(a).length)
    .map((name) => ({
      esc: escapeHtml(name),
      html: render ? render(name) : '@' + escapeHtml(name),
    }))
}

/* ------------------------------------------------------------------ */
/* 行内                                                                 */
/* ------------------------------------------------------------------ */
function renderInline(raw, ctx, alreadyEscaped = false) {
  const s = alreadyEscaped ? String(raw ?? '') : escapeHtml(raw)
  let out = ''
  let i = 0

  while (i < s.length) {
    const ch = s[i]

    /* 行内代码 */
    if (ch === '`') {
      const end = s.indexOf('`', i + 1)
      if (end !== -1) {
        out += `<code>${s.slice(i + 1, end)}</code>`
        i = end + 1
        continue
      }
    }

    /* @交付物提及 */
    if (ch === '@' && ctx.mentions.length) {
      const hit = ctx.mentions.find((m) => s.startsWith(m.esc, i + 1))
      if (hit) {
        out += hit.html
        i += 1 + hit.esc.length
        continue
      }
    }

    /* 图片：按普通链接降级处理，避免加载外部资源 */
    if (ch === '!' && s[i + 1] === '[') {
      const close = s.indexOf('](', i + 2)
      if (close !== -1) {
        const end = s.indexOf(')', close + 2)
        if (end !== -1) {
          const alt = s.slice(i + 2, close)
          const url = safeUrl(s.slice(close + 2, end).trim())
          if (url) {
            out += `<a href="${url}" target="_blank" rel="noopener noreferrer">${renderInline(alt, ctx, true)}</a>`
            i = end + 1
            continue
          }
        }
      }
    }

    /* 链接 */
    if (ch === '[') {
      const close = s.indexOf('](', i + 1)
      if (close !== -1) {
        const end = s.indexOf(')', close + 2)
        if (end !== -1) {
          const text = s.slice(i + 1, close)
          const url = safeUrl(s.slice(close + 2, end).trim())
          if (url) {
            out += `<a href="${url}" target="_blank" rel="noopener noreferrer">${renderInline(text, ctx, true)}</a>`
            i = end + 1
            continue
          }
        }
      }
    }

    /* 强调 / 删除线 */
    if (ch === '*' || ch === '_' || ch === '~') {
      /* 单个 ~ 不是语法 */
      if (ch === '~' && s[i + 1] !== '~') {
        out += ch
        i++
        continue
      }
      /* 下划线强调需左右有边界，避免 snake_case 被误伤 */
      if (ch === '_') {
        const prev = i > 0 ? s[i - 1] : ''
        if (/[A-Za-z0-9一-鿿]/.test(prev)) {
          out += ch
          i++
          continue
        }
      }
      const dbl = s[i + 1] === ch
      const marker = dbl ? ch + ch : ch
      const end = s.indexOf(marker, i + marker.length)
      if (end !== -1) {
        const afterIdx = end + marker.length
        const after = afterIdx < s.length ? s[afterIdx] : ''
        const boundaryOk =
          ch !== '_' || !after || !/[A-Za-z0-9一-鿿]/.test(after)
        const inner = s.slice(i + marker.length, end)
        if (inner && boundaryOk) {
          const tag = dbl ? (ch === '~' ? 'del' : 'strong') : 'em'
          out += `<${tag}>${renderInline(inner, ctx, true)}</${tag}>`
          i = afterIdx
          continue
        }
      }
    }

    out += ch
    i++
  }

  return out
}

/* ------------------------------------------------------------------ */
/* 列表                                                                 */
/* ------------------------------------------------------------------ */
function renderList(lines, ctx) {
  const firstLine = lines.find((l) => !isBlank(l)) || ''
  const baseIndent = indentOf(firstLine)

  const parts = []
  let current = null
  let listTag = null
  let open = false

  const flushItem = () => {
    if (current) {
      parts.push(current)
      current = null
    }
  }
  const closeTag = () => {
    if (open) {
      parts.push(listTag === 'ol' ? '</ol>' : '</ul>')
      open = false
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }
    const indent = indentOf(line)
    if (indent < baseIndent) break

    const ol = line.match(RE_OL)
    const ul = line.match(RE_UL)
    const m = ol || ul
    if (!m) {
      i++
      continue
    }

    /* 嵌套列表：挂到当前 li 内部 */
    if (indent > baseIndent) {
      const nested = []
      while (i < lines.length) {
        const l = lines[i]
        if (isBlank(l)) {
          let j = i + 1
          while (j < lines.length && isBlank(lines[j])) j++
          if (j < lines.length && indentOf(lines[j]) > baseIndent) {
            nested.push('')
            i++
            continue
          }
          break
        }
        if (indentOf(l) > baseIndent) {
          nested.push(l)
          i++
        } else {
          break
        }
      }
      const html = renderList(nested, ctx)
      if (current) current = current.replace(/<\/li>$/, html + '</li>')
      else parts.push(html)
      continue
    }

    /* 同级新条目 */
    flushItem()
    const orderedNow = !!ol
    const tag = orderedNow ? 'ol' : 'ul'
    if (!open || listTag !== tag) {
      closeTag()
      listTag = tag
      if (orderedNow) {
        const start = parseInt(ol[2], 10) || 1
        parts.push(start === 1 ? '<ol>' : `<ol start="${start}">`)
      } else {
        parts.push('<ul>')
      }
      open = true
    }

    let text = m[3]
    i++
    while (i < lines.length) {
      const l = lines[i]
      if (isBlank(l)) break
      if (indentOf(l) <= baseIndent) break
      if (RE_UL.test(l) || RE_OL.test(l)) break /* 留给嵌套分支 */
      text += '\n' + l.trim()
      i++
    }
    const body = text
      .split('\n')
      .map((t) => renderInline(t, ctx))
      .join('<br>')
    current = `<li>${body}</li>`
  }

  flushItem()
  closeTag()
  return parts.join('')
}

/* ------------------------------------------------------------------ */
/* 表格                                                                 */
/* ------------------------------------------------------------------ */
function cellAlign(cell) {
  const c = cell.trim()
  const left = c.startsWith(':')
  const right = c.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return 'left'
}

function renderTable(header, aligns, rows, ctx) {
  const th = header
    .map(
      (cell, idx) =>
        `<th style="text-align:${aligns[idx] || 'left'}">${renderInline(cell, ctx)}</th>`,
    )
    .join('')
  const body = rows
    .map(
      (cells) =>
        '<tr>' +
        header
          .map(
            (_, idx) =>
              `<td style="text-align:${aligns[idx] || 'left'}">${renderInline(cells[idx] || '', ctx)}</td>`,
          )
          .join('') +
        '</tr>',
    )
    .join('')
  return `<div class="md-table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`
}

/* ------------------------------------------------------------------ */
/* 块                                                                   */
/* ------------------------------------------------------------------ */
function renderBlocks(lines, ctx) {
  let out = ''
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }

    /* 代码块 */
    let m = line.match(RE_FENCE)
    if (m) {
      const fence = m[1]
      const closeRe = new RegExp(
        '^\\s{0,3}' + fence[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '{' + fence.length + ',}\\s*$',
      )
      const lang = m[2].trim().split(/\s+/)[0]
      const code = []
      i++
      while (i < lines.length && !closeRe.test(lines[i])) {
        code.push(lines[i])
        i++
      }
      if (i < lines.length) i++ /* 跳过结束围栏 */
      out +=
        `<pre class="md-pre">` +
        (lang ? `<span class="md-lang">${escapeHtml(lang)}</span>` : '') +
        `<code>${escapeHtml(code.join('\n'))}</code></pre>`
      continue
    }

    /* 标题 */
    m = line.match(RE_HEAD)
    if (m) {
      const lv = m[1].length
      out += `<h${lv}>${renderInline(m[2], ctx)}</h${lv}>`
      i++
      continue
    }

    /* 分割线 */
    if (RE_HR.test(line)) {
      out += '<hr>'
      i++
      continue
    }

    /* 引用（可嵌套块） */
    if (RE_QUOTE.test(line)) {
      const inner = []
      while (i < lines.length) {
        const q = lines[i].match(RE_QUOTE)
        if (q) {
          inner.push(q[1])
          i++
        } else {
          break
        }
      }
      out += `<blockquote>${renderBlocks(inner, ctx)}</blockquote>`
      continue
    }

    /* 表格 */
    if (line.includes('|') && i + 1 < lines.length && isTableDelim(lines[i + 1])) {
      const header = splitRow(line)
      const aligns = splitRow(lines[i + 1]).map(cellAlign)
      i += 2
      const rows = []
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]))
        i++
      }
      out += renderTable(header, aligns, rows, ctx)
      continue
    }

    /* 列表 */
    if (RE_UL.test(line) || RE_OL.test(line)) {
      const block = []
      while (i < lines.length) {
        const l = lines[i]
        if (isBlank(l)) {
          let j = i + 1
          while (j < lines.length && isBlank(lines[j])) j++
          if (
            j < lines.length &&
            (RE_UL.test(lines[j]) || RE_OL.test(lines[j]) || indentOf(lines[j]) > 0)
          ) {
            block.push('')
            i++
            continue
          }
          break
        }
        if (RE_UL.test(l) || RE_OL.test(l) || indentOf(l) > 0) {
          block.push(l)
          i++
          continue
        }
        break
      }
      out += renderList(block, ctx)
      continue
    }

    /* 段落：保留原文换行 */
    const para = [line]
    i++
    while (i < lines.length) {
      const l = lines[i]
      if (isBlank(l)) break
      if (isBlockStart(l, lines[i + 1])) break
      para.push(l)
      i++
    }
    out += `<p>${para.map((l) => renderInline(l, ctx)).join('<br>')}</p>`
  }

  return out
}

/**
 * 渲染 Markdown
 * @param {string} src 原文
 * @param {object} [opts]
 * @param {string[]} [opts.mentions] 可识别的 @ 名字（自动按长度降序匹配）
 * @param {(name: string) => string} [opts.renderMention] 名字 → HTML
 */
export function renderMarkdown(src, opts = {}) {
  const ctx = { mentions: buildMentions(opts) }
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
  return renderBlocks(lines, ctx)
}

/**
 * 把 Markdown 压成单行纯文本，用于列表一行预览
 */
export function markdownToText(src) {
  return String(src ?? '')
    .replace(/\r\n?/g, '\n')
    /* 代码块：保留代码内容，去掉围栏与语言标记 */
    .replace(/(?:^|\n)\s*(?:`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\s*(?:`{3,}|~{3,})\s*(?=\n|$)/g, ' $1 ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    /* 标题、引用、列表标记、分割线 */
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+/gm, '')
    .replace(/^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/gm, '')
    /* 表格分隔行与竖线 */
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/gm, '')
    .replace(/\s*\|\s*/g, ' ')
    /* 强调与删除线 */
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    /* 折叠空白 */
    .replace(/\s+/g, ' ')
    .trim()
}
