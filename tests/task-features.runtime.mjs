// Isolated official-runtime smoke test. No prompts, goals, or model requests are dispatched.
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root=fileURLToPath(new URL('../',import.meta.url))
const {outputFiles}=await build({stdin:{contents:"export {DshClient} from './src/dsh-client.ts'; export {DshConnection} from './src/dsh-connection.ts'", resolveDir:root},bundle:true,platform:'node',format:'cjs',write:false})
const mod={exports:{}};new Function('module','exports','require',outputFiles[0].text)(mod,mod.exports,createRequire(root+'/package.json'))
const {DshClient,DshConnection}=mod.exports
const home=await mkdtemp(join(tmpdir(),'dsh-task-smoke-'));await mkdir(home+'/project')
const child=spawn(process.env.DSH_TEST_EXECUTABLE || 'dsh',['web','--patch',root+'/docs/dsh-task-services.patch.yml','--port','0','--no-open'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,DSH_HOME:home,LANG:'en_US.UTF-8'},stdio:['ignore','pipe','pipe']})
const exited=once(child,'exit');let client,connection
try{
 const launch=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error('Isolated DSH startup timed out')),45000)
  const output=chunk=>{log+=chunk.toString();const match=log.match(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/??\?token=[A-Za-z0-9_-]+)/);if(match){clearTimeout(timer);resolve(new URL(match[1]))}}
  child.stdout.on('data',output);child.stderr.on('data',output);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Isolated DSH exited: '+code+' '+log.replace(/token=[A-Za-z0-9_-]+/g,'token=[redacted]').slice(-4000)))})
 })
 connection=new DshConnection(new URL(launch.origin));await connection.authenticate(launch);client=new DshClient(connection);await client.startStreams()
 const {sessionId}=await client.createSession(home+'/project');const main=await client.openSession(sessionId);main.activate()
 const reads=await Promise.allSettled([client.goal(sessionId),client.schedules(),client.searchHistory('isolated-no-matches')]); const describe=(read)=>read.status==='fulfilled'?'ok':read.reason.code+':'+read.reason.status
 const observer=client.observeSession(sessionId,undefined,()=>{},error=>{throw error});const snapshot=await observer.opening;snapshot.activate();observer.dispose()
 assert.deepEqual(reads.map(describe),['ok','ok','ok']); assert.equal(main.isCurrent(),true); assert.equal(snapshot.isCurrent(),false)
 const checks=[
  ['sessions',()=>client.listSessions()],['workspace',()=>client.listWorkspaces()],
  ['history',()=>client.history(sessionId,Number.MAX_SAFE_INTEGER)],['models',()=>client.models(sessionId)],
  ['commands',()=>client.listCommands(sessionId)],['skills',()=>client.listSkills(sessionId)],
  ['agentPresets',()=>client.listAgentPresets()],['settings',()=>client.settings()],
  ['pluginInventory',()=>client.pluginInventory()],['accountState',()=>client.accountState()],
 ]
 const compatibility=await Promise.allSettled(checks.map(([,read])=>read()))
 for(let i=0;i<checks.length;i++)assert.equal(describe(compatibility[i]),'ok',checks[i][0]+' compatibility')
 const upload=await client.uploadFile(sessionId,Buffer.from('isolated runtime audit').toString('base64'),'audit.txt')
 assert.equal(typeof upload.receiptId,'string')
 await client.renameSession(sessionId,'Isolated UI compatibility check')
 await client.archiveSession(sessionId);await client.unarchiveSession(sessionId)
 console.log(JSON.stringify({goalGet:describe(reads[0]),scheduleCatalog:describe(reads[1]),historySearch:describe(reads[2]),independentFollow:true,
  protocolChecks:Object.fromEntries(checks.map(([name],i)=>[name,describe(compatibility[i])])),fileUpload:true,renameArchiveUnarchive:true,modelRequests:0,homeIsolated:true}))
}finally{
 client?.dispose();connection?.dispose();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await exited;clearTimeout(timer);await rm(home,{recursive:true,force:true})
}
