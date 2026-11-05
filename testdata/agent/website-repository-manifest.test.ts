import { describe, expect, it } from 'vitest'
import { parseGitHubWebsiteUrl, repositoryIcon, websiteManifest } from '../../src/services/agent/websiteRepositoryManifest'
const manifest = { version: 1, id: 'example', host: 'example.com', name: '示例网站', icon: 'assets/icon.png' }
describe('website package manifest', () => {
  it('supports repository and explicit skill-directory URLs without accepting credentials or other hosts', () => {
    expect(parseGitHubWebsiteUrl('owner/repo.git')).toMatchObject({ owner: 'owner', name: 'repo', url: 'https://github.com/owner/repo' })
    expect(parseGitHubWebsiteUrl('https://github.com/owner/repo/tree/main/skills/example')).toMatchObject({ branch: 'main', root: 'skills/example' })
    for (const url of ['http://github.com/owner/repo', 'https://github.com.evil.test/owner/repo', 'https://token@github.com/owner/repo', 'https://github.com/owner/repo?token=x', 'https://github.com/owner/repo/tree/main/../../secrets']) {
      expect(() => parseGitHubWebsiteUrl(url)).toThrow()
    }
  })
  it('requires a package-local icon and prevents impersonating built-in websites', () => {
    expect(websiteManifest(manifest)).toEqual(manifest)
    for (const patch of [{ icon: 'https://example.com/icon.png' }, { icon: '../icon.png' }, { icon: 'assets/icon.svg' }, { host: 'example.com/path' }, { host: 'EXAMPLE.com' }, { id: 'zjooc' }, { host: 'chaoxing.com' }, { id: 'site-learn' }]) {
      expect(() => websiteManifest({ ...manifest, ...patch })).toThrow()
    }
  })
  it('checks actual icon bytes and rejects HTML or scripts posing as images', () => {
    expect(repositoryIcon('assets/icon.png', new Uint8Array([137,80,78,71,13,10,26,10])).dataUrl).toMatch(/^data:image\/png;base64,/)
    for (const text of ['<html>error</html>', '<svg onload="alert(1)"></svg>', 'not an icon']) {
      expect(() => repositoryIcon('assets/icon.png', new TextEncoder().encode(text))).toThrow('图片')
    }
    expect(() => repositoryIcon('assets/icon.png', new Uint8Array(300000))).toThrow('256 KB')
  })
})
