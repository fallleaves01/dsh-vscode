// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, type Harness } from './webview-harness.js'
import { createSubagentLinks } from '../src/subagent-links.mjs'
const active: Harness[]=[]
afterEach(()=>{for(const h of active.splice(0))h.dispose();vi.useRealTimers()})
const card={id:'tool:s',role:'tool',text:'subagent',detail:'Completed',deferredBody:true,deferredBodyRevision:'r1',
  resultView:{card:'generic',subagentLinks:[{id:'child',label:'Review allocator'}]},callView:{card:'generic',subagentLabel:'Review allocator'}}
const sessions=[{id:'parent',title:'Parent',childCount:1},{id:'child',title:'Child',parentId:'parent',subagent:{mode:'continuable',label:'Review allocator'},running:true,activity:{status:'running',elapsedMs:1000,totalTokens:1200}}]
async function mount(extra:Record<string,unknown>={}){const h=harness();active.push(h);h.sendState({sessionId:'parent',sessions,messages:[card],...extra});await h.settle();return h}
describe('subagent navigation directly in tool cards',()=>{
  it('offers retry after a timeout without automatically sending the request again',()=>{
    vi.useFakeTimers();const posts:Record<string,unknown>[]=[],view=createSubagentLinks([{id:'child'}],'parent',post=>posts.push(post))
    document.body.append(view.root);const button=view.root.querySelector<HTMLButtonElement>('button')!
    button.click();expect(button.disabled).toBe(true);vi.advanceTimersByTime(45000)
    expect(button.disabled).toBe(false);expect(view.root.textContent).toContain('Opening timed out');expect(posts).toHaveLength(1)
    button.click();expect(posts).toHaveLength(2);view.dispose();view.root.remove()
  })
  it('opens the exact conversation without expanding the deferred request body',async()=>{
    const h=await mount();expect(h.document.querySelector('.subagent-tool-card details')?.hasAttribute('open')).toBe(false)
    expect(h.document.querySelector('.subagent-tool-meta')?.textContent).toContain('Running')
    h.click('.subagent-tool-main')
    expect(h.posts.at(-1)).toMatchObject({type:'open-subagent',parentSessionId:'parent',sessionId:'child',placement:'chat'})
    expect(h.posts.some(post=>post.type==='load-tool-output')).toBe(false)
    expect(h.document.querySelector('.subagent-tool-card summary')?.textContent).not.toContain('Completed')
  })
  it('opens alongside through a separate button and can retry a failed open',async()=>{
    const h=await mount();h.click('.subagent-tool-aside');const request=h.posts.at(-1)!
    expect(request).toMatchObject({type:'open-subagent',placement:'beside',sessionId:'child'})
    h.send({type:'open-subagent-result',requestId:'stale',parentSessionId:'parent',error:'wrong response'})
    expect((h.document.querySelector('.subagent-tool-main') as HTMLButtonElement).disabled).toBe(true)
    h.send({...request,type:'open-subagent-result',error:'The child is unavailable'})
    expect(h.document.querySelector('.subagent-tool-error')?.textContent).toBe('The child is unavailable')
    expect((h.document.querySelector('.subagent-tool-main') as HTMLButtonElement).disabled).toBe(false)
    h.click('.subagent-tool-main');expect(h.posts.at(-1)?.placement).toBe('chat')
  })
  it('updates child status from session state while the parent tool message remains unchanged',async()=>{
    const h=await mount();const button=h.document.querySelector('.subagent-tool-main')
    h.sendState({sessionId:'parent',messages:[card],sessions:[sessions[0],{...sessions[1],running:false,activity:{status:'completed',elapsedMs:65000,totalTokens:2100}}]});await h.settle()
    expect(h.document.querySelector('.subagent-tool-main')).toBe(button)
    expect(h.document.querySelector('.subagent-tool-meta')?.textContent).toContain('Completed')
    expect(h.document.querySelector('.subagent-tool-duration')?.textContent).toBe('1m 5s')
    expect(h.document.querySelector('.subagent-tool-usage')?.textContent).toBe('2.1K tok')
  })
  it('does not route an external execution or interpret a label as HTML',async()=>{
    const h=await mount({sessions:[sessions[0],{id:'external:parent:child',parentId:'parent',subagent:{mode:'external',executionId:'child',label:'<img src=x onerror=alert(1)>'}}]})
    expect(h.document.querySelector('.subagent-tool-links img')).toBeNull()
    expect(h.document.querySelector('.subagent-tool-meta')?.textContent).toBe('External task')
    h.click('.subagent-tool-main');expect(h.posts.some(post=>post.type==='open-subagent')).toBe(false)
  })
  it('keeps unknown catalog references clickable so the host can resolve cold history',async()=>{
    const h=await mount({sessions:[sessions[0]]});h.click('.subagent-tool-main')
    expect(h.posts.at(-1)).toMatchObject({type:'open-subagent',sessionId:'child'})
  })
})
