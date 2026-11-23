import { prepareD2Assets } from 'virtual:zerror-d2-assets'

export const loadD2Runtime = async () => {
  await prepareD2Assets()
  return import('@terrastruct/d2')
}
