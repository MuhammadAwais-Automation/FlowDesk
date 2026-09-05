import { utilityProcess } from 'electron'
import { join } from 'node:path'
import { BrainClient, type BrainUtilityChild } from './client'

export function createElectronBrainClient(userDataPath: string, utilityEntryPath: string) {
  const databasePath = join(userDataPath, 'brain', 'brain.sqlite')
  return new BrainClient(() => utilityProcess.fork(utilityEntryPath, [databasePath], {
    serviceName: 'FlowDesk Brain',
  }) as BrainUtilityChild)
}
