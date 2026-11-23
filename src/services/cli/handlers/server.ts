import { invoke } from '@tauri-apps/api/core'
import type { CliHandlerGroup } from '../contracts'

export const serverHandlers = {
  'server.status': async () => invoke('get_server_status'),
  'server.start': async (_p, context) => {
    const [{ settingsManager }, session] = await Promise.all([import('../../app/settings'), import('../../questionServer/session')])
    await settingsManager.ready; await context.assertActive()
    const network = settingsManager.get('network')
    await invoke('start_server', { port: network.serverPort, bindAddress: network.enableLanAccess ? '0.0.0.0' : '127.0.0.1' })
    await session.checkTauriEnvironment(); await session.getServerStatus(); session.startSSEConnection()
    return invoke('get_server_status')
  },
  'server.stop': async (_p, context) => {
    const [session, refs, { cancelAllInFlightModelRequests }] = await Promise.all([import('../../questionServer/session'), import('../../questionServer/serverRefs'), import('../../questionServer/runtime')])
    await context.assertActive()
    await invoke('stop_server'); session.stopSSEConnection(); session.stopLogPolling(); cancelAllInFlightModelRequests()
    refs.serverRunning.value = false; refs.serverUrl.value = ''; refs.serverPort.value = null
    return invoke('get_server_status')
  },
} satisfies CliHandlerGroup<'server'>
