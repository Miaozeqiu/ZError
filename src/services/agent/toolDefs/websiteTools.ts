export const WEBSITE_ICON_TOOL = {
  type: 'function' as const,
  function: {
    name: 'set_website_icon',
    description: '为网站保存已确认的图标。先从真实网页的 link[rel~=icon]、apple-touch-icon 或品牌 logo 获取完整图片地址，再调用本工具；不要猜 favicon 路径。宿主下载验证并缓存图片，离线也能显示。登录域名自动归属主网站。只保存图标，不修改账号、经验或图谱。',
    parameters: {
      type: 'object', properties: {
        website: { type: 'string', description: '网站域名或网址；省略时使用当前浏览器网址' },
        icon_url: { type: 'string', description: '网页实际使用的完整 http(s) 图标地址，可来自网站 CDN' },
      }, required: ['icon_url'],
    },
  },
}
