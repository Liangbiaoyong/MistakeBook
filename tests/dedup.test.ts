import { describe, expect, it } from 'vitest'
import {
  findDuplicateGroups,
  findDuplicates,
  groupToHits,
  normalizeQuestion,
  similarity,
  type DedupCandidate
} from '../src/main/store/dedup'

function cand(id: string, question: string, subject = '408'): DedupCandidate {
  return {
    id,
    subject,
    created: `2026-09-${id.slice(-2)}T00:00:00.000Z`,
    question,
    status: 'new',
    reviewRound: 0,
    hasImage: false
  }
}

const TREE = '设一棵二叉树有n个结点，求叶结点的个数是多少？'
const TREE_OCR = '设一棵二又树有n个结点，求叶结点的个数是多少？' // 叉 → 又（典型 OCR 误识）

describe('normalizeQuestion —— 只留内容', () => {
  it('去掉空白、标点与 LaTeX 定界符', () => {
    expect(normalizeQuestion('  $n$ 个结点, （共 2 分） ')).toBe('n个结点共2分')
  })

  it('全角半角标点归一后落到同一个形状', () => {
    expect(normalizeQuestion('求 (A) 的值。')).toBe(normalizeQuestion('求（A）的值'))
  })

  it('无内容时返回空串（不能拿它去比相似度）', () => {
    expect(normalizeQuestion('  , 。 ')).toBe('')
  })
})

describe('similarity —— 同一道题的不同识别结果要认得出来', () => {
  it('完全相同 → 1', () => {
    expect(similarity(TREE, TREE)).toBe(1)
  })

  it('只差标点/空白 → 仍算完全相同', () => {
    expect(similarity('求 $n$ 的值。', '求n的值')).toBe(1)
  })

  it('OCR 错一个字 → 依然很高（这是最常见的情况，不能漏）', () => {
    const s = similarity(TREE, TREE_OCR)
    expect(s).toBeGreaterThan(0.75)
    expect(s).toBeLessThan(1)
  })

  it('不相干的题 → 很低', () => {
    expect(similarity(TREE, '简述 TCP 三次握手的过程并说明为什么需要第三次')).toBeLessThan(0.3)
  })

  it('短题干不做模糊匹配 —— 宁可漏报也不要把两道不同的题判成重复', () => {
    expect(similarity('求导', '求积')).toBe(0)
    expect(similarity('求导', '求导')).toBe(1)
  })

  it('空题干 → 0（不能靠空串匹配出一堆重复）', () => {
    expect(similarity('', TREE)).toBe(0)
    expect(similarity('', '')).toBe(0)
  })
})

describe('findDuplicates —— 保存前的提示', () => {
  const pool = [
    cand('2026-09-01', TREE),
    cand('2026-09-02', '简述 TCP 三次握手的过程并说明为什么需要第三次'),
    cand('2026-09-03', TREE_OCR)
  ]

  it('找出同一道题的既有记录，并带上相似度', () => {
    const hits = findDuplicates('设一棵二叉树有n个结点，求叶结点的个数？', pool)
    expect(hits.map((h) => h.id)).toContain('2026-09-01')
    expect(hits.every((h) => h.score >= 0.75)).toBe(true)
  })

  it('按相似度从高到低排', () => {
    const hits = findDuplicates(TREE, pool)
    expect(hits.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score)
    }
  })

  it('毫不相干的题不会被报出来', () => {
    const hits = findDuplicates('求定积分 ∫x dx 的值', pool)
    expect(hits).toHaveLength(0)
  })

  it('题干为空时不报任何重复', () => {
    expect(findDuplicates('   ', pool)).toHaveLength(0)
  })

  it('limit 生效', () => {
    const many = Array.from({ length: 10 }, (_, i) => cand(`2026-09-${String(i).padStart(2, '0')}`, TREE))
    expect(findDuplicates(TREE, many, 0.75, 3)).toHaveLength(3)
  })

  it('命中的题干预览是 Markdown 片段，不是空的', () => {
    const hits = findDuplicates(TREE, pool)
    expect(hits[0].questionHead.length).toBeGreaterThan(0)
  })
})

describe('findDuplicateGroups —— 整库查重', () => {
  it('A≈B、B≈C 时三道题应该在同一组（并查集，不是两组）', () => {
    const base = '设一棵二叉树有n个结点，求叶结点的个数是多少？'
    const b = '设一棵二叉树有n个结点，求叶结点的个数是多少'
    const c = '设一棵二叉树有n个结点，求叶结点的个数是几个？'
    const groups = findDuplicateGroups([cand('2026-09-01', base), cand('2026-09-02', b), cand('2026-09-03', c)])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(3)
  })

  it('只有一个成员的组不算重复，不返回', () => {
    const groups = findDuplicateGroups([
      cand('2026-09-01', TREE),
      cand('2026-09-02', '简述 TCP 三次握手的过程并说明为什么需要第三次')
    ])
    expect(groups).toHaveLength(0)
  })

  it('不跨科目比较 —— 不同科目不可能截的是同一道题', () => {
    const groups = findDuplicateGroups([
      cand('2026-09-01', TREE, '408'),
      cand('2026-09-02', TREE_OCR, '数学二')
    ])
    expect(groups).toHaveLength(0)
  })

  it('重复最多的组排在最前（用户最该先清掉）', () => {
    const three = [
      cand('2026-09-01', TREE),
      cand('2026-09-02', TREE_OCR),
      cand('2026-09-03', '设一棵二叉树有n个结点，求叶结点的个数是多少')
    ]
    const two = [
      cand('2026-09-04', '简述 TCP 三次握手的过程并说明为什么需要第三次', '网络'),
      cand('2026-09-05', '简述TCP三次握手的过程，并说明为什么需要第三次', '网络')
    ]
    const groups = findDuplicateGroups([...two, ...three])
    expect(groups[0]).toHaveLength(3)
    expect(groups[1]).toHaveLength(2)
  })

  it('空串题干不会互相判成重复', () => {
    const groups = findDuplicateGroups([cand('2026-09-01', '  '), cand('2026-09-02', '')])
    expect(groups).toHaveLength(0)
  })
})

describe('groupToHits', () => {
  it('第一项相似度记为 1，其余按与第一项的相似度算', () => {
    const hits = groupToHits([cand('2026-09-01', TREE), cand('2026-09-02', TREE_OCR)])
    expect(hits[0].score).toBe(1)
    expect(hits[1].score).toBeGreaterThan(0.75)
    expect(hits[1].score).toBeLessThan(1)
  })
})
