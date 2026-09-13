import { describe, expect, it } from 'vitest'
import {
  FrontmatterError,
  markdownToMistake,
  mistakeRelPath,
  mistakeToMarkdown,
  newId,
  pickUniqueId,
  questionPreview,
  sanitizeSegment
} from '../src/main/store/frontmatter'
import type { Mistake } from '../src/shared/types'

const full: Mistake = {
  id: '2026-09-13-a3f2',
  created: '2026-09-13T14:23:21+08:00',
  source: '王道《数据结构》p.42 第08题',
  subject: '408',
  chapter: ['数据结构', '树'],
  points: ['树的度', '叶结点数'],
  type: '单选',
  level: 3,
  myAnswer: 'C',
  rightAnswer: 'B',
  errorType: '概念混淆',
  status: 'reviewing',
  confidence: 0.9,
  review: { last: '2026-09-13', next: '2026-09-15', round: 2 },
  llm: { model: 'deepseek-flash', at: '2026-09-13T14:23:30+08:00' },
  imagePath: 'assets/2026-09-13-a3f2.png',
  body: {
    question: '设一棵 $m$ 叉树中有 $N_1$ 个度数为 1 的结点……则该树中共有（ ）个叶结点。',
    myThought: '直接用 $N_0+N_1=n$ 列式，忽略了边数关系。',
    solution: '由 $n-1=\\sum i N_i$ 解得 $N_0=1+\\sum_{i\\ge2}(i-1)N_i$。',
    cause: '把「结点数」和「边数」两个不变量混用了。',
    variant: '若改为问分支结点数，结论会怎样变化？'
  }
}

describe('frontmatter 往返', () => {
  it('完整记录往返后完全相等', () => {
    expect(markdownToMistake(mistakeToMarkdown(full))).toEqual(full)
  })

  it('空数组不会退化成 [""]', () => {
    const m: Mistake = { ...full, chapter: [], points: [] }
    const back = markdownToMistake(mistakeToMarkdown(m))
    expect(back.chapter).toEqual([])
    expect(back.points).toEqual([])
  })

  it('可选字段缺失时不臆造', () => {
    const minimal: Mistake = {
      id: '2026-01-01-0001',
      created: '2026-01-01T00:00:00+08:00',
      subject: '数学二',
      chapter: [],
      points: [],
      type: '计算',
      status: 'new',
      confidence: 0.5,
      review: { round: 0 },
      body: { question: '求极限' }
    }
    const back = markdownToMistake(mistakeToMarkdown(minimal))
    expect(back).toEqual(minimal)
    expect(back.level).toBeUndefined()
    expect(back.errorType).toBeUndefined()
    expect(back.imagePath).toBeUndefined()
    expect(back.llm).toBeUndefined()
  })

  it('review 的 null 能被识别为「未安排」', () => {
    const m: Mistake = { ...full, review: { round: 0 } }
    const back = markdownToMistake(mistakeToMarkdown(m))
    expect(back.review.last).toBeUndefined()
    expect(back.review.next).toBeUndefined()
  })

  it('YAML 特殊字符不破坏结构', () => {
    const nasty: Mistake = {
      ...full,
      source: '书名: 带冒号 [还有方括号] #井号 "引号" 单引号\'x\'',
      points: ['a, b 逗号', '含: 冒号'],
      body: { question: '题干里有 --- 三个横线\n\n还有 ## 二级标题\n\n和 $\\frac{a}{b}$ 公式' }
    }
    const back = markdownToMistake(mistakeToMarkdown(nasty))
    expect(back.source).toBe(nasty.source)
    expect(back.points).toEqual(nasty.points)
    expect(back.body.question).toContain('--- 三个横线')
    expect(back.body.question).toContain('## 二级标题')
    expect(back.body.question).toContain('$\\frac{a}{b}$')
  })

  it('正文里的二级标题不会被误当成小节', () => {
    const m: Mistake = {
      ...full,
      body: { question: '先看 ## 这个\n再看这个\n\n## 正确解法\n\n这是正式解法' }
    }
    const back = markdownToMistake(mistakeToMarkdown(m))
    expect(back.body.solution).toBe('这是正式解法')
    expect(back.body.question).toContain('## 这个')
  })

  it('数字型答案被还原成字符串', () => {
    const m: Mistake = { ...full, myAnswer: '12', rightAnswer: '13' }
    const back = markdownToMistake(mistakeToMarkdown(m))
    expect(back.myAnswer).toBe('12')
    expect(back.rightAnswer).toBe('13')
  })

  it('缺 id / 缺 frontmatter 时抛 FrontmatterError', () => {
    expect(() => markdownToMistake('# 只是一段普通 Markdown')).toThrow(FrontmatterError)
    expect(() => markdownToMistake('---\nsubject: 408\n---\n正文')).toThrow(FrontmatterError)
  })

  it('字段越界时回落到合法值而不是崩', () => {
    const raw = '---\nid: x\nsubject: 408\ntype: 不存在的题型\nlevel: 99\nconfidence: 3\nstatus: 乱写\n---\n\n## 题目\n\nq\n'
    const m = markdownToMistake(raw)
    expect(m.type).toBe('其他')
    expect(m.level).toBe(5)
    expect(m.confidence).toBe(1)
    expect(m.status).toBe('new')
  })
})

describe('newId', () => {
  it('形如 YYYY-MM-DD-xxxxxx', () => {
    expect(newId()).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/)
  })

  it('可取指定日期', () => {
    expect(newId(new Date(2026, 8, 13))).toMatch(/^2026-09-13-/)
  })
})

describe('pickUniqueId —— 查重（防止覆盖已有错题）', () => {
  it('遇到已占用的 id 会继续找下一个', () => {
    const seq = ['a', 'b', 'c']
    let i = 0
    const id = pickUniqueId((x) => x === 'a' || x === 'b', () => seq[i++])
    expect(id).toBe('c')
  })

  it('全都没被占用时直接用第一个', () => {
    let calls = 0
    const id = pickUniqueId(
      () => false,
      () => {
        calls++
        return 'only'
      }
    )
    expect(id).toBe('only')
    expect(calls).toBe(1)
  })

  it('尝试次数用尽时仍返回一个未被占用的 id，绝不返回冲突值', () => {
    const taken = new Set(['x'])
    const id = pickUniqueId((v) => taken.has(v), () => 'x', 3)
    expect(id).not.toBe('x')
    expect(id.startsWith('x-')).toBe(true)
  })

  it('默认用 newId 生成，结果符合格式', () => {
    expect(pickUniqueId(() => false)).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/)
  })
})

describe('sanitizeSegment', () => {
  it('剥掉 Windows 非法字符', () => {
    expect(sanitizeSegment('数据结构/树:*?"<>|')).toBe('数据结构树')
  })

  it('保留中文与空格', () => {
    expect(sanitizeSegment('计算机 组成原理')).toBe('计算机 组成原理')
  })

  it('空值回落到「未分类」', () => {
    expect(sanitizeSegment('')).toBe('未分类')
    expect(sanitizeSegment('///')).toBe('未分类')
  })

  it('不以点开头（避免 . / .. 目录）', () => {
    expect(sanitizeSegment('..hidden')).toBe('hidden')
  })
})

describe('mistakeRelPath', () => {
  it('按 科目/章节 分目录', () => {
    expect(mistakeRelPath(full)).toBe('mistakes/408/数据结构/树/2026-09-13-a3f2.md')
  })

  it('没有章节时少一层目录', () => {
    expect(mistakeRelPath({ ...full, chapter: [] })).toBe('mistakes/408/2026-09-13-a3f2.md')
  })
})

describe('questionPreview —— 预览不能把公式截断', () => {
  const countDollars = (s: string): number => (s.match(/\$/g) ?? []).length

  it('短文本原样返回', () => {
    expect(questionPreview('求 $x^2$ 的导数')).toBe('求 $x^2$ 的导数')
  })

  it('长文本会被截断并加省略号', () => {
    const long = '这是一道很长的题目'.repeat(12)
    const out = questionPreview(long, 20)
    expect(out.length).toBeLessThanOrEqual(21)
    expect(out.endsWith('…')).toBe(true)
  })

  it('绝不会留下落单的 $（这正是「公式变成字面文字」的根因）', () => {
    // 截断点正好落在 $N_1$ 中间 —— 未修复时会留下奇数个 $
    const q = '设一棵 $m$ 叉树中有 $N_1$ 个度数为 1 的结点，$N_2$ 个度数为 2 的结点，则该树中共有（ ）个叶结点。'
    for (let max = 6; max <= 60; max++) {
      expect(countDollars(questionPreview(q, max)) % 2).toBe(0)
    }
  })

  it('宁可少显示，也不露出半截公式', () => {
    const out = questionPreview('前缀 $abcdefghij$ 后缀', 10)
    expect(out).not.toContain('$abc')
    expect(out).toBe('前缀…')
  })

  it('折叠空白，换行不会打断预览', () => {
    expect(questionPreview('第一行\n第二行', 40)).toBe('第一行 第二行')
  })

  it('空值不炸', () => {
    expect(questionPreview('')).toBe('')
  })
})
