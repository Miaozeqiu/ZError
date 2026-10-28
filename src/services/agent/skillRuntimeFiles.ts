/** Builtin website resources are maintained product data, not a developer workspace. */
export const isBuiltinRuntimeSkillFile = (relativePath: string): boolean => {
  const path = String(relativePath || '').replace(/\\/g, '/')
  if (/(?:^|\/)(?:fixtures|parsers)(?:\/|$)/i.test(path)) return false
  if (/(?:^|\/)(?:see|schema|locators)(?:\.[\w-]+)?\.json$/i.test(path)) return false
  return /\.(?:md|markdown|json)$/i.test(path)
}

export const WEBSITE_RUNTIME_FILE_HINT = '网站只保存操作经验与导航配置。请直接在当前网页验证操作，再把已验证的方法写入本站 SKILL.md。'
