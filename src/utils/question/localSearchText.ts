const punctuation: Record<string, string> = {
  '（': '(', '）': ')', '？': '?', '！': '!', '，': ',', '：': ':', '；': ';',
}

export const normalizeLocalSearchCharacter = (char: string) => {
  if (/[\s\u200b\ufeff]/u.test(char)) return ''
  return (punctuation[char] ?? char).toLowerCase()
}

export const normalizeLocalSearchText = (text: string) =>
  Array.from(text, normalizeLocalSearchCharacter).join('')
