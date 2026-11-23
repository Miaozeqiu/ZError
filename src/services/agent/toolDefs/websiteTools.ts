export const INSTALL_WEBSITE_REPOSITORY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'install_website_repository',
    description: '从 Open 下载并安装网站经验仓库，支持重新安装已卸载的仓库。网站可填写域名或网址，省略时使用当前浏览器网站。成功回执含 installed、revision 和已注册工具；安装失败时报告具体错误。',
    parameters: { type: 'object', properties: {
      website: { type: 'string', description: '目标网站域名或网址，例如 academy.example' },
    }, additionalProperties: false },
  },
}

export const WEBSITE_ICON_TOOL = {
  type: 'function' as const,
  function: {
    name: 'set_website_icon',
    description: '为自建网站保存已确认的图标。先从真实网页的 link[rel~=icon]、apple-touch-icon 或品牌 logo 获取完整图片地址。宿主下载验证并缓存图片。在线网站使用仓库提供的图标，登录域名归属主网站。',
    parameters: {
      type: 'object', properties: {
        website: { type: 'string', description: '网站域名或网址；省略时使用当前浏览器网址' },
        icon_url: { type: 'string', description: '网页实际使用的完整 http(s) 图标地址，可来自网站 CDN' },
      }, required: ['icon_url'],
    },
  },
}
