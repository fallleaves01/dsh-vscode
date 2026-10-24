import { describe, expect, it } from 'vitest'
import { subagentToolReferences } from '../src/subagent-tools.js'
import { ConversationProjector, type DshEvent } from '../src/conversation.js'
import { messageForWebview } from '../src/chat-state-patch.js'

describe('official subagent tool navigation metadata', () => {
  it('retains exact child ids through live, stored-view, history and compact transports', () => {
    const events: DshEvent[] = [
      {type:'tool/call',seq:1,time:1,data:{callId:'s',name:'subagent',arguments:JSON.stringify({description:'Review allocator',prompt:'Inspect the allocator'})}},
      {type:'tool/result',seq:2,time:2,data:{message:{source:{callId:'s'},content:[{type:'tool-result',toolCallId:'s',content:[{type:'text',text:'started subagent child-1'}]}]}}},
    ]
    const live=new ConversationProjector();events.forEach(event=>live.apply(event,{call:{card:'generic',title:'subagent'},result:{card:'generic',content:[{type:'text',text:'started subagent child-1'}]}}))
    const history=new ConversationProjector();history.reset(events)
    for(const message of [live.messages()[0]!,history.messages()[0]!]) {
      const wire=messageForWebview(message)
      expect(wire.deferredBody).toBe(true)
      expect(wire.resultView).toMatchObject({subagentLinks:[{id:'child-1',label:'Review allocator'}]})
      expect(wire.rawInput).toBeUndefined();expect(wire.rawResult).toBeUndefined()
    }
  })
  it('recognizes custom delegation tools and code-mode result lines without using labels as addresses', () => {
    expect(subagentToolReferences('custom_fork',{description:'Same label',prompt:'task'},'started subagent exact-id')).toEqual([{id:'exact-id',label:'Same label'}])
    expect(subagentToolReferences('run_code',{},'started subagent a\nstarted subagent b\nstarted subagent a')).toEqual([{id:'a'},{id:'b'}])
    expect(subagentToolReferences('run_code',{},'{"kind":"activation","subagentId":"structured-id"}')).toEqual([{id:'structured-id'}])
    expect(subagentToolReferences('run_code',{},'progress\n{"kind":"activation","subagentId":"stdout-id"}')).toEqual([{id:'stdout-id'}])
    expect(subagentToolReferences('subagent',{description:'child-id',prompt:'task'},'No child started')).toEqual([])
  })
  it('does not turn arbitrary read/shell output, quoted prose or failures into navigation', () => {
    expect(subagentToolReferences('read',{},'started subagent a')).toEqual([])
    expect(subagentToolReferences('bash',{},'started subagent a')).toEqual([])
    expect(subagentToolReferences('subagent',{},'Quoted: started subagent a')).toEqual([])
    expect(subagentToolReferences('subagent',{},'started subagent a',undefined,true)).toEqual([])
  })
  it('routes official control references by agent_id and caps code-mode result counts', () => {
    expect(subagentToolReferences('send_message',{agent_id:'parent',message:'hello'})).toEqual([{id:'parent'}])
    expect(subagentToolReferences('interrupt_agent',{agent_id:'child'})).toEqual([{id:'child'}])
    expect(subagentToolReferences('subagent',{},'',{kind:'activation',subagentId:'exact'})).toEqual([{id:'exact'}])
    expect(subagentToolReferences('run_code',{},Array.from({length:150},(_,i)=>`started subagent child-${i}`).join('\n'))).toHaveLength(100)
  })
  it('addresses rc.3 Team tools by member name for later projection resolution', () => {
    // `spawn_teammate` returns `{"member":{"target":"reviewer",...}}`; the target
    // is a name, and only the agentTeam projection knows its session id.
    expect(subagentToolReferences('spawn_teammate',
      { name: 'reviewer', description: 'Review the auth flow', prompt: 'Audit it' },
      '{"member":{"target":"reviewer","role":"teammate","status":"running","diagnostics":[]}}'))
      .toEqual([{ id: 'reviewer', memberName: 'reviewer', label: 'Review the auth flow' }])
    // A result that has not finished streaming still leaves the requested name.
    expect(subagentToolReferences('spawn_teammate',
      { name: 'reviewer', description: 'Review the auth flow', prompt: 'Audit it' }, '{"member":{"target":'))
      .toEqual([{ id: 'reviewer', memberName: 'reviewer', label: 'Review the auth flow' }])
    expect(subagentToolReferences('send_message', { target: 'reviewer', message: 'hello' }))
      .toEqual([{ id: 'reviewer', memberName: 'reviewer' }])
    expect(subagentToolReferences('interrupt_agent', { target: 'reviewer' }))
      .toEqual([{ id: 'reviewer', memberName: 'reviewer' }])
    expect(subagentToolReferences('list_agents', {},
      '[{"target":"lead","role":"lead","status":"running","diagnostics":[]},{"target":"reviewer","role":"teammate","status":"inactive","diagnostics":[]}]'))
      .toEqual([{ id: 'lead', memberName: 'lead' }, { id: 'reviewer', memberName: 'reviewer' }])
    // Tools that carry no addressable conversation fall back to a generic card.
    expect(subagentToolReferences('wait_agent', { timeout_ms: 30000 }, '{"timedOut":true}')).toEqual([])
    expect(subagentToolReferences('team_task_create', { subject: 'Audit', description: 'Details' }, '{"id":"task-1"}')).toEqual([])
    expect(subagentToolReferences('spawn_teammate', { name: 'reviewer', description: 'R', prompt: 'P' }, '', undefined, true)).toEqual([])
  })
})
