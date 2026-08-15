import {
  enableD2,
  enableInfographic,
  enableKatex,
  enableMermaid,
} from 'markstream-vue'

enableKatex()
enableMermaid()
enableD2(() => import('@terrastruct/d2'))
enableInfographic(() => import('@antv/infographic'))
