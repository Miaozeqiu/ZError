/** Read the encrypted text without changing the course page or its controls. */
export const CHAOXING_FONT_PROBE = `(() => {
  if (!/(^|\\.)(chaoxing\\.com|xuexitong\\.com)$/.test(location.hostname)) return null;
  const nodes = Array.from(document.querySelectorAll('.font-cxsecret'));
  if (!nodes.length) return null;
  const style = Array.from(document.querySelectorAll('head style')).find(s => s.textContent?.includes('font-cxsecret'));
  const font = style?.textContent?.match(/base64,([\\w\\W]+?)[\x27\")]/)?.[1] || '';
  const entries = nodes.slice(0, 40).map((node, index) => { const text = (node.querySelector('.after') || node).textContent || ''; return { index, text, length: text.length }; });
  return { font: font.match(/.{1,8000}/g) || [], entries, truncated: nodes.length > 40 };
})()`

type Entry = { index: number; text: string; length?: number }
type Probe = { font: string[]; entries: Entry[]; truncated: boolean }

export const decodeChaoxingProbe = async (probe: Probe) => {
  if (probe.truncated || !Array.isArray(probe.font) || !probe.font.length || !Array.isArray(probe.entries)) throw new Error('字体或文字不完整')
  if (probe.entries.some(row => typeof row.text !== 'string' || (row.length != null && row.length !== row.text.length))) throw new Error('文字被截断')
  const encoded = probe.font.join('')
  if (encoded.length > 300_000 || !/^[a-zA-Z0-9+/=]+$/.test(encoded)) throw new Error('字体数据无效')
  const text = probe.entries.map(row => String(row.text || '')).join('')
  if (!text || text.length > 20_000 || new Set(text).size > 500) throw new Error('文字过多或为空')
  const raw = atob(encoded)
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0))
  const { crackFont, decryptText } = await import('./bitmap')
  const result = await crackFont(bytes.buffer, text, { refTableUrl: `${import.meta.env.BASE_URL}font-data/ocs-font-ref-cx.bin` })
  // An empty match or an ambiguous glyph cannot be trusted for answering questions.
  if (!result.details.length || result.details.some(row => !Number.isFinite(row.margin) || row.margin < 0.3)) throw new Error('字形匹配置信度不足')
  return probe.entries.map(row => ({ index: row.index, text: decryptText(String(row.text || ''), result.map) }))
}
