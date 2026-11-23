import { expect, it } from 'vitest'
import { cliRunCheckpoint } from '../../src/services/cli/run'
import { createRunController } from '../../src/services/agent/core/controller'

it('retains a successful observation and action receipts across explicit CLI calls', async () => {
  let checkpoint = cliRunCheckpoint('read')
  const controller = createRunController({ run: checkpoint, changed: next => { checkpoint = next }, checkpoint: async () => {}, browserId: () => 'tab', signal: new AbortController().signal })
  controller.state('running')
  await controller.execute({ id: 'observation', name: 'browser_get_page', arguments: '{}' }, async () => JSON.stringify({ snapshot: 'button ref=e1' }))
  await controller.finish('completed'); controller.dispose()
  const next = cliRunCheckpoint('click', checkpoint)
  expect(next.needsObservation).toBe(false)
  expect(next.observation?.id).toBe('observation')
  const click = createRunController({ run: next, changed: () => {}, checkpoint: async () => {}, browserId: () => 'tab', signal: new AbortController().signal })
  click.state('running')
  let executed = false
  await click.execute({ id: 'action', name: 'browser_click', arguments: '{"ref":"e1"}' }, async () => { executed = true; return '{"ok":true}' })
  expect(executed).toBe(true)
  click.dispose()
  expect(checkpoint.id).toBe('read')
})

it('requires fresh evidence for interrupted work and preserves uncertain operations', () => {
  const previous = cliRunCheckpoint('old')
  previous.status = 'interrupted'
  previous.operations.push({ id: 'submit', tool: 'browser_click', browserId: 'tab', state: 'pending', at: Date.now(), sequence: 1 })
  const recovered = cliRunCheckpoint('new', previous)
  expect(recovered.needsObservation).toBe(true)
  expect(recovered.operations[0].state).toBe('uncertain')
})
