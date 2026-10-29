import { asObject, evalBrowserViewMainIdle } from '../../browser/eval'
import { isWisdomMoocStudyUrl, WISDOM_MOOC_STUDY_SCRIPT, type WisdomStudyCard } from './study'

/** 按需读取当前播放页；不创建后台时钟，不修改网页。 */
export const readWisdomStudyCard = async (browserId: string, url: string): Promise<WisdomStudyCard | null> => {
  if (!isWisdomMoocStudyUrl(url)) return null
  const raw = asObject(await evalBrowserViewMainIdle(browserId, WISDOM_MOOC_STUDY_SCRIPT))
  return raw.ok === true && raw.url === url ? raw as WisdomStudyCard : null
}
