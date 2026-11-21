import { createHash } from 'node:crypto'
import type { InstalledWebsiteTool, WebsiteRuntimePackage } from '../../../src/services/agent/websiteRuntime/protocol'

export const objectSchema = (properties: Record<string, unknown> = {}, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
})
export function runtimeFixture(code = `var ZErrorSitePackage = { *create({args}) {
  const page = yield {op:'browser.observe',args:{}};
  return {title: page.title};
} };`): WebsiteRuntimePackage {
  return { apiVersion: 2, bundle: { code, sha256: createHash('sha256').update(code).digest('hex') }, tools: [{
    name: 'read_catalog', description: '读取本站课程', parameters: objectSchema(), result: objectSchema({title:{type:'string'}}),
    commands: ['browser.observe'],
  }] }
}
export function runtimeBinding(runtime = runtimeFixture()): InstalledWebsiteTool {
  return {host:'academy.example',siteId:'academy',revision:'a'.repeat(40),authority:'test-install',runtime,tool:runtime.tools[0]}
}
