import { describe, it, expect } from 'vitest'
import { detectLanguageHint, detectScriptHint } from './gemini'

describe('detectLanguageHint', () => {
  it('detects Sinhala script', () => {
    expect(detectLanguageHint('මොනවද කරන්නේ?')).toBe('sinhala')
    expect(detectLanguageHint('ඔයාලා මොනවද හදන්නේ')).toBe('sinhala')
  })

  it('detects Singlish (romanized Sinhala)', () => {
    expect(detectLanguageHint('mokakda price eka?')).toBe('singlish')
    expect(detectLanguageHint('mata ekak one')).toBe('singlish')
    expect(detectLanguageHint('machan kohomada')).toBe('singlish')
    expect(detectLanguageHint('oyaata thiyenawada')).toBe('singlish')
    expect(detectLanguageHint('ow hari')).toBe('singlish')
  })

  it('defaults to English', () => {
    expect(detectLanguageHint('What is the price of the mug?')).toBe('english')
    expect(detectLanguageHint('I want to buy 2 machines')).toBe('english')
    expect(detectLanguageHint('hello, are you open?')).toBe('english')
  })
})

describe('detectScriptHint', () => {
  it('still distinguishes script for backward compatibility', () => {
    expect(detectScriptHint('අ')).toBe('sinhala-script')
    expect(detectScriptHint('hello')).toBe('latin')
  })
})
