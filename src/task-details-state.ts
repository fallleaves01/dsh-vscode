import type { ConversationMessage } from './conversation.js'
import type { JobItem } from './jobs.js'
import type { JobChunk } from './task-features.js'
import type { SessionItem } from './session-center.js'

export interface TaskDetailState {
  subagents?: SessionItem[]
  kind: 'subagent' | 'job'; title: string; sessionId: string; parentSessionId?: string
  status: string; running: boolean; readOnlyReason: string | null; meta: string
  messages: ConversationMessage[]; requests: Array<{ rpcId: string; event: string; request: Record<string, unknown> }>
  hasMore: boolean; loadingHistory: boolean; chunks: JobChunk[]; gap: boolean; job?: JobItem; error?: string | null
}
