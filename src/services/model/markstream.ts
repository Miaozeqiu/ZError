import {
  enableD2,
  enableInfographic,
  enableKatex,
  enableMermaid,
} from 'markstream-vue'

enableKatex()
enableMermaid()
enableD2(() => import('./d2Loader').then(module => module.loadD2Runtime()))
enableInfographic(() => import('@antv/infographic'))
