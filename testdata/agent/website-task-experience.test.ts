import { beforeEach, expect, it, vi } from 'vitest'
import { prepareWebsiteTaskExperience } from '../../src/services/agent/websiteTaskExperience'
import { WebsiteExperienceNotFoundError } from '../../src/services/agent/websiteRepository'

const mocks = vi.hoisted(() => ({ install: vi.fn() }))
vi.mock('../../src/services/agent/websiteRepository', () => ({
  installWebsiteExperience: mocks.install,
  WebsiteExperienceNotFoundError: class extends Error {},
}))
beforeEach(() => vi.resetAllMocks())

it('安装故障与 Open 没有收录明确区分，不要求重新导航', async () => {
  const signal = new AbortController().signal
  mocks.install.mockRejectedValueOnce(new Error('HTTP 503'))
  expect(await prepareWebsiteTaskExperience('https://academy.example/login', signal))
    .toMatchObject({ status: 'error', error: 'HTTP 503', hint: expect.stringContaining('install_website_repository') })
  mocks.install.mockRejectedValueOnce(new WebsiteExperienceNotFoundError())
  expect(await prepareWebsiteTaskExperience('https://other.example/', signal)).toEqual({ status: 'unavailable' })
})

it('停止后不返回迟到的可用回执，内部首页不触发 Open 安装', async () => {
  const controller = new AbortController()
  expect(await prepareWebsiteTaskExperience('zerror://home', controller.signal)).toBeUndefined()
  expect(mocks.install).not.toHaveBeenCalled()
  mocks.install.mockImplementation(async () => { controller.abort(); throw new Error('late failure') })
  await expect(prepareWebsiteTaskExperience('https://academy.example/', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
