import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireBrowser,
  browserOwnerOf,
  clearBrowserOwners,
  releaseBrowser,
} from '../../src/services/agent/subagent/owner'

describe('browser owner', () => {
  afterEach(() => clearBrowserOwners())

  it('不可重入', () => {
    expect(acquireBrowser('b1', 'job-a').ok).toBe(true)
    const second = acquireBrowser('b1', 'job-b')
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.owner).toBe('job-a')
    expect(browserOwnerOf('b1')).toBe('job-a')
    releaseBrowser('b1', 'job-b')
    expect(browserOwnerOf('b1')).toBe('job-a')
    releaseBrowser('b1', 'job-a')
    expect(browserOwnerOf('b1')).toBeNull()
    expect(acquireBrowser('b1', 'job-b').ok).toBe(true)
  })
})
