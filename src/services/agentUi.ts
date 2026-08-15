import { ref } from 'vue'

export type AgentSection = 'import' | 'chat'

export const agentSection = ref<AgentSection>('import')

export const openAgentSection = (section: AgentSection) => {
  agentSection.value = section
}
