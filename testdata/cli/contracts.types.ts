import type { CliHandlers, CliParams } from '../../src/services/cli/contracts'
// 由 vue-tsc -p testdata/cli/tsconfig.json 编译检查，不参与运行。
export function checkCliTypes(handlers: CliHandlers) {
  const context = { assertActive: async () => {} }
  handlers['questions.list']({ page: 1, pageSize: 10 }, context)
  handlers['models.select']({ id: null, role: 'agent' }, context)
  // @ts-expect-error 空参数定义不接受额外属性
  handlers.status({ unexpected: true }, context)
  // @ts-expect-error 分页参数必须是数字
  handlers['questions.list']({ pageSize: '10' }, context)
  // @ts-expect-error 参数定义要求提供 model 对象
  const missing: CliParams<'models.add'> = { name: 'platform' }
  // @ts-expect-error 不接受未支持的角色
  handlers['models.select']({ id: null, role: 'anything' }, context)
  // @ts-expect-error 每个参数定义都必须有处理函数
  const incomplete: CliHandlers = { status: async () => ({}) }
  return { missing, incomplete }
}
