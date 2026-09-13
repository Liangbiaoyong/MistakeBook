import { describe, expect, it } from 'vitest'
import { ExtractionSchema, cleanOptional } from '../src/main/llm/schema'

/** 模型返回的最小合法载荷 */
const base = {
  subject: '数据结构',
  confidence: 0.9,
  body: { question: '求 $x^2$ 的导数' }
}

describe('cleanOptional —— 清掉模型写的「哨兵值」', () => {
  it('把 undefined / null / N/A 之类的字符串当成空', () => {
    for (const v of ['undefined', 'NULL', 'N/A', 'n/a', '无', '未知', '-', '  ', '']) {
      expect(cleanOptional(v)).toBeUndefined()
    }
  })

  it('正常文本原样返回并去空白', () => {
    expect(cleanOptional('  王道《数据结构》p.42  ')).toBe('王道《数据结构》p.42')
  })

  it('非字符串类型不强转', () => {
    expect(cleanOptional(null)).toBeUndefined()
    expect(cleanOptional(undefined)).toBeUndefined()
    expect(cleanOptional({ a: 1 })).toBeUndefined()
  })

  it('0 与 false 是合法内容，不该被当成空', () => {
    expect(cleanOptional(0)).toBe('0')
    expect(cleanOptional(false)).toBe('false')
  })
})

describe('ExtractionSchema —— 模型输出不干净也得能落库', () => {
  it('实测踩过的坑：source 与我的思路被写成字符串 "undefined"', () => {
    const out = ExtractionSchema.parse({
      ...base,
      source: 'undefined',
      myAnswer: 'null',
      body: { question: '题干', myThought: 'undefined', solution: 'N/A', cause: '无' }
    })
    expect(out.source).toBeUndefined()
    expect(out.myAnswer).toBeUndefined()
    expect(out.body.myThought).toBeUndefined()
    expect(out.body.solution).toBeUndefined()
    expect(out.body.cause).toBeUndefined()
  })

  it('chapter / points 里的哨兵值与空串会被剔除', () => {
    const out = ExtractionSchema.parse({
      ...base,
      chapter: ['树与二叉树', 'undefined', '', '  ', 'null'],
      points: ['树的性质', 'N/A']
    })
    expect(out.chapter).toEqual(['树与二叉树'])
    expect(out.points).toEqual(['树的性质'])
  })

  it('chapter / points 缺失时返回空数组，不炸', () => {
    const out = ExtractionSchema.parse(base)
    expect(out.chapter).toEqual([])
    expect(out.points).toEqual([])
  })

  it('题干被清空时给占位，而不是让整次识别失败（截图不能丢）', () => {
    const out = ExtractionSchema.parse({ ...base, body: { question: 'undefined' } })
    expect(out.body.question).toContain('未能识别题干')
  })

  it('subject 缺失或为哨兵值时落到「未分类」', () => {
    expect(ExtractionSchema.parse({ ...base, subject: 'undefined' }).subject).toBe('未分类')
    expect(ExtractionSchema.parse({ ...base, subject: undefined }).subject).toBe('未分类')
  })

  it('题型落在词表外时回落到「其他」', () => {
    expect(ExtractionSchema.parse({ ...base, type: '选择题（单选）' }).type).toBe('其他')
  })

  it('chapter 是逗号分隔字符串时也能吃下', () => {
    const out = ExtractionSchema.parse({ ...base, chapter: '数据结构, 树' })
    expect(out.chapter).toEqual(['数据结构', '树'])
  })
})
