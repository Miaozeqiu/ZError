import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const normalize = path => path.replaceAll('\\', '/')
export function featureResults(manifest, results, root) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.features) || !manifest.features.length) throw new Error('无效的功能测试清单')
  const suites = results.testResults || []
  if (!suites.length || !results.success || results.numFailedTests || results.numPendingTests || results.numTodoTests || !results.numTotalTests) throw new Error('前端回归存在失败、跳过、待办或没有执行测试')
  const ids = new Set()
  return manifest.features.map(feature => {
    if (!feature.id || ids.has(feature.id) || !feature.tests?.length) throw new Error('功能测试清单有重复或空项')
    ids.add(feature.id)
    const evidence = new Set()
    for (const selector of feature.tests) {
      const absolute = normalize(resolve(root, selector))
      if (!existsSync(resolve(root, selector))) throw new Error(`功能 ${feature.id} 的测试不存在：${selector}`)
      const matches = suites.filter(suite => selector.endsWith('/') ? normalize(suite.name).startsWith(absolute + '/') : normalize(suite.name) === absolute)
      if (!matches.length) throw new Error(`功能 ${feature.id} 的测试未执行：${selector}`)
      for (const suite of matches) {
        if (suite.status !== 'passed' || !suite.assertionResults?.length || suite.assertionResults.some(test => test.status !== 'passed')) throw new Error(`功能 ${feature.id} 未通过：${suite.name}`)
        evidence.add(normalize(suite.name).slice(normalize(root).length + 1))
      }
    }
    return { id: feature.id, name: feature.name, status: 'passed', suites: [...evidence] }
  })
}

export function markdownReport(report) {
  const steps=report.steps.map(row=>`| ${row.id} | ${row.status} |`).join('\n')
  const features=report.features.map(row=>`| ${row.name} | ${row.status} | ${row.suites.length} |`).join('\n')
  return `# 上线前回归：${report.phase}\n\n平台：${report.platform} / ${report.architecture}，结果：${report.status}\n\n提交：${report.revision}${report.dirty ? '（工作区含改动）' : ''}\n\n| 检查 | 结果 |\n| --- | --- |\n${steps}\n\n${features ? '| 功能 | 结果 | 测试文件数 |\n| --- | --- | --- |\n'+features+'\n' : '本阶段未执行前端功能矩阵，不能据此判断其他阶段通过。\n'}\n## 仍需实机验收\n\n${report.manualChecks.map(item=>'- [ ] '+item).join('\n')}\n`
}
