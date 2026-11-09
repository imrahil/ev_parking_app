// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { readStringArray } from './storage'

describe('readStringArray', () => {
  beforeEach(() => localStorage.clear())

  it('reads a stored array and drops non-string items', () => {
    localStorage.setItem('k', JSON.stringify(['a', 1, null, 'b']))
    expect(readStringArray('k')).toEqual(['a', 'b'])
  })

  it('keeps a stored empty array rather than falling back', () => {
    localStorage.setItem('k', '[]')
    expect(readStringArray('k', ['default'])).toEqual([])
  })

  it('falls back when the entry is missing, broken or not an array', () => {
    expect(readStringArray('k', ['default'])).toEqual(['default'])
    localStorage.setItem('k', '{not json')
    expect(readStringArray('k', ['default'])).toEqual(['default'])
    localStorage.setItem('k', '{"a":1}')
    expect(readStringArray('k', ['default'])).toEqual(['default'])
    expect(readStringArray('missing')).toEqual([])
  })
})
