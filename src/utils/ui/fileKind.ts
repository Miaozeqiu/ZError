export type FileKind = 'pdf' | 'word' | 'excel' | 'csv' | 'md' | 'text' | 'file'

export const fileExtOf = (fileName: string) => fileName.split('.').pop()?.toLowerCase() || ''

export const fileTypeOf = (fileName: string): FileKind => {
  const ext = fileExtOf(fileName)
  if (ext === 'pdf') return 'pdf'
  if (ext === 'doc' || ext === 'docx') return 'word'
  if (ext === 'xls' || ext === 'xlsx') return 'excel'
  if (ext === 'csv') return 'csv'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'txt') return 'text'
  return 'file'
}

export const fileTypeLabel = (fileName: string) => {
  const kind = fileTypeOf(fileName)
  if (kind === 'pdf') return 'PDF'
  if (kind === 'word') return 'W'
  if (kind === 'excel') return 'X'
  if (kind === 'csv') return 'CSV'
  if (kind === 'md') return 'MD'
  if (kind === 'text') return 'TXT'
  return fileExtOf(fileName).slice(0, 3).toUpperCase() || 'FILE'
}
