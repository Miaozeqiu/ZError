import { defineComponent, h } from 'vue'
import MarkdownRender, { InfographicBlockNode, MermaidBlockNode, setCustomComponents } from 'markstream-vue'
import AgentD2Block from '../../components/agent/AgentD2Block.vue'
import AgentHtmlBlock from '../../components/agent/AgentHtmlBlock.vue'
import AgentCodeBlock from '../../components/agent/AgentCodeBlock.vue'
import '../../services/model/markstream'
import 'markstream-vue/index.css'
import 'katex/dist/katex.min.css'

const ThematicBreak = defineComponent({
  name: 'AgentThematicBreak',
  inheritAttrs: false,
  setup() {
    return () => h('hr', { class: 'agent-hr' })
  },
})

setCustomComponents('agent-chat', {
  thematic_break: ThematicBreak,
  mermaid: MermaidBlockNode,
  d2: AgentD2Block,
  d2lang: AgentD2Block,
  infographic: InfographicBlockNode,
  html_block: AgentHtmlBlock,
  code_block: AgentCodeBlock,
})

export default MarkdownRender
