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

describe('rc.2 named subagent tools', () => {
  it('addresses send_message and interrupt_agent by the rc.2 agent name', () => {
    expect(subagentToolReferences('send_message', { agent: 'reviewer', message: 'hello' }))
      .toEqual([{ id: 'reviewer', memberName: 'reviewer' }])
    expect(subagentToolReferences('interrupt_agent', { agent: 'reviewer/checker' }))
      .toEqual([{ id: 'reviewer/checker', memberName: 'reviewer/checker' }])
    // The rc.1 Session id stays the stronger address when both are present.
    expect(subagentToolReferences('send_message', { agent_id: 'session-1', agent: 'reviewer', message: 'hi' }))
      .toEqual([{ id: 'session-1' }])
    // The earlier Team spelling keeps working.
    expect(subagentToolReferences('send_message', { target: 'reviewer', message: 'hi' }))
      .toEqual([{ id: 'reviewer', memberName: 'reviewer' }])
  })

  it('reads the rc.2 list_agents rows and the old target/members shapes', () => {
    expect(subagentToolReferences('list_agents', {},
      '[{"name":"lead","status":"running","description":"root agent"},{"name":"reviewer","status":"inactive","description":"Audit"}]'))
      .toEqual([{ id: 'lead', memberName: 'lead' }, { id: 'reviewer', memberName: 'reviewer' }])
    // The rendered row text is also accepted when the raw JSON is unavailable.
    expect(subagentToolReferences('list_agents', {}, 'lead [running] — root agent\nreviewer/checker [inactive] — Audit'))
      .toEqual([{ id: 'lead', memberName: 'lead' }, { id: 'reviewer/checker', memberName: 'reviewer/checker' }])
    // Old shapes stay readable.
    expect(subagentToolReferences('list_agents', {}, '[{"target":"lead"},{"target":"reviewer"}]'))
      .toEqual([{ id: 'lead', memberName: 'lead' }, { id: 'reviewer', memberName: 'reviewer' }])
    expect(subagentToolReferences('list_agents', {}, '{"members":[{"target":"lead"}]}'))
      .toEqual([{ id: 'lead', memberName: 'lead' }])
    expect(subagentToolReferences('list_agents', {}, 'not a roster')).toEqual([])
  })

  it('links a named rc.2 activation through the catalog instead of using the name as a session id', () => {
    expect(subagentToolReferences('subagent',
      { name: 'reviewer', description: 'Review the auth flow', prompt: 'Audit it' },
      '{"kind":"activation","name":"reviewer"}', { kind: 'activation', name: 'reviewer' }))
      .toEqual([{ id: 'reviewer', memberName: 'reviewer', label: 'Review the auth flow' }])
    // The rendered line repeats the name; it must not become a second raw id.
    expect(subagentToolReferences('subagent',
      { name: 'reviewer', description: 'Review the auth flow', prompt: 'Audit it' },
      'started subagent reviewer', { kind: 'activation', name: 'reviewer' }))
      .toEqual([{ id: 'reviewer', memberName: 'reviewer', label: 'Review the auth flow' }])
    // rc.1 activation ids still become direct links.
    expect(subagentToolReferences('subagent',
      { description: 'Review the allocator', prompt: 'Inspect it' },
      '{"kind":"activation","subagentId":"child-1"}', { kind: 'activation', subagentId: 'child-1' }))
      .toEqual([{ id: 'child-1', label: 'Review the allocator' }])
  })

  it('never turns the new rc.2 tools into subagent links', () => {
    expect(subagentToolReferences('wait_agent', { timeout_ms: 30000, agent: 'reviewer' }, '{"timedOut":true}')).toEqual([])
    for (const name of ['team_task_create', 'team_task_get', 'team_task_update', 'team_task_list']) {
      expect(subagentToolReferences(name,
        { subject: 'Audit', description: 'Details', agent: 'reviewer', prompt: 'p' },
        '{"id":"task-1","tasks":[]}')).toEqual([])
    }
  })
})
