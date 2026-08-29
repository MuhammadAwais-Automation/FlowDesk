import type { NotebookJobQueue } from './notebooklmJobs'

/** Main-process composition root for NotebookLM's durable work queue.
 * Agent tools load before `main.ts` finishes constructing Electron's store.
 * This injection boundary avoids importing main (and an Electron cycle), while
 * keeping Studio and Agent on exactly the same queue instance. */
let queue: NotebookJobQueue | undefined

export function configureNotebookJobRuntime(value: NotebookJobQueue): void {
  queue = value
}

export function getNotebookJobQueue(): NotebookJobQueue {
  if (!queue) throw new Error('NotebookLM jobs are not ready yet. Please wait for FlowDesk to finish starting.')
  return queue
}
