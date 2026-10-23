// Real process fault injection, isolated state and no network/model requests.
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const home = await mkdtemp(join(tmpdir(), 'dsh-host-lifetime-'))
const children = [], pids = new Set(), report = {}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, ms = 9000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await check()) return; await delay(50) }
  throw new Error('Runtime host cleanup deadline exceeded')
}
try {
  const support = join(home, 'support.mjs')
  await build({ stdin: { contents: "export * from './src/runtime-broker.ts'; export * from './src/runtime-process.ts';", resolveDir: root },
    outfile: support, bundle: true, format: 'esm', platform: 'node' })
  const { RuntimeBroker, nodeProcessProbe, spawnHostedRuntime } = await import(pathToFileURL(support).href)
  const probe = nodeProcessProbe(), live = pid => probe.isAlive(pid)
  const fixture = join(home, 'runtime.cjs')
  await writeFile(fixture, `
const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs');
const mode=process.env.MODE;
writeFileSync(process.env.STATE+'/runtime-pid',String(process.pid));
if(mode==='ignore')process.on('SIGTERM',()=>{});
if(mode==='blocked') { console.log('dsh web: http://127.0.0.1:39001/?token=lifetime_fixture'); while(true){} }
if(mode==='pipes') {
 const tool=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready\\n');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','inherit']});
 writeFileSync(process.env.STATE+'/tool-pid',String(tool.pid));
 tool.stdout.once('data',()=>process.exit(0));
} else {
 if(mode!=='silent')console.log('dsh web: http://127.0.0.1:39001/?token=lifetime_fixture');
 setInterval(()=>{},1000);
}
`)
  let serial = 0
  async function launch(mode = 'normal', lease = true) {
    const state = join(home, String(++serial)); await mkdir(state, {mode:0o700})
    const broker = new RuntimeBroker({stateDir:state}), instanceId = 'fixture'
    const abort = new AbortController()
    const runtime = await spawnHostedRuntime({launch:{command:process.execPath,args:[fixture],sourceCheckout:false},
      options:{cwd:home,env:{PATH:process.env.PATH,HOME:home,MODE:mode,STATE:state}},
      host:{script:join(root,'dist/runtime-host.js'),orphanGraceMs:200,leasePollMs:50}, broker,instanceId,
      fingerprint:{dshHome:state,executable:process.execPath,arguments:[fixture],extensionVersion:'fixture',hostProtocol:'ipc-2'},
      timeoutMs:1000,signal:abort.signal})
    runtime.stdout.resume(); runtime.stderr.resume()
    const errors=[];runtime.on('error',error=>errors.push(error.message))
    pids.add(runtime.pid)
    // The reservation exists until URL publication; identify the host without ps scans.
    let hostPid
    try {hostPid=JSON.parse(await readFile(join(state,'starting.json'),'utf8')).hostPid} catch {hostPid=broker.readDescriptor()?.host?.pid}
    assert.ok(hostPid>0);pids.add(hostPid)
    if(lease)await broker.takeLease(instanceId,runtime.pid)
    if(!['pipes','silent'].includes(mode))await until(()=>broker.readDescriptor()!==undefined)
    return {runtime,broker,hostPid,state,errors}
  }

  const shared = await launch()
  shared.runtime.detach()
  await delay(600)
  assert.ok(live(shared.runtime.pid)); assert.ok(live(shared.hostPid))
  report.ipcDisconnectPreservesLiveLease=true
  shared.broker.clearLease('fixture')
  await until(()=>!live(shared.runtime.pid)&&!live(shared.hostPid))
  report.lastLeaseRemovalStopsBoth=true

  for(const mode of ['ignore','blocked']) {
    const item=await launch(mode), start=Date.now()
    item.broker.clearLease('fixture')
    await until(()=>!live(item.runtime.pid)&&!live(item.hostPid))
    assert.ok(Date.now()-start<7000)
    report[mode==='ignore'?'ignoringSigtermForcedCleanup':'blockedDshEventLoopForcedCleanup']=true
  }

  const pipe = await launch('pipes',false)
  await until(async()=>{try {return Number(await readFile(join(pipe.state,'tool-pid'),'utf8'))>0}catch{return false}})
  const toolPid=Number(await readFile(join(pipe.state,'tool-pid'),'utf8'));pids.add(toolPid)
  await until(()=>!live(pipe.runtime.pid)&&!live(pipe.hostPid)&&!live(toolPid))
  report.descendantCannotKeepHostAlive=true

  const victim=await launch()
  process.kill(victim.hostPid,'SIGKILL')
  await until(()=>!live(victim.runtime.pid)&&!live(victim.hostPid))
  report.creatorRecoversKilledHelper=true

  const unpublished=await launch('silent')
  process.kill(unpublished.hostPid,'SIGKILL')
  await until(()=>!live(unpublished.runtime.pid)&&!live(unpublished.hostPid))
  await unpublished.broker.waitForStartup(undefined,1000)
  report.killedHelperBeforeUrlDoesNotOrphanDsh=true

  // A separate extension host is essential here: this test process must not
  // retain the relay's exit handler that would otherwise clean up immediately.
  const orphanState=join(home,'unpublished-orphan');await mkdir(orphanState,{mode:0o700})
  const ownerScript=join(home,'unpublished-owner.cjs')
  await build({stdin:{resolveDir:root,contents:`
import {RuntimeBroker} from './src/runtime-broker.ts';
import {spawnHostedRuntime} from './src/runtime-process.ts';
void (async()=>{
 const state=process.env.STATE,broker=new RuntimeBroker({stateDir:state});
 const runtime=await spawnHostedRuntime({launch:{command:process.execPath,args:[process.env.FIXTURE],sourceCheckout:false},
  options:{cwd:process.env.HOME,env:{PATH:process.env.PATH,HOME:process.env.HOME,MODE:'silent',STATE:state}},
  host:{script:process.env.HOST_SCRIPT},broker,instanceId:'fixture',
  fingerprint:{dshHome:state,executable:process.execPath,arguments:[process.env.FIXTURE],extensionVersion:'fixture',hostProtocol:'ipc-2'},
  timeoutMs:10000,signal:new AbortController().signal});
 runtime.on('error',()=>{});runtime.stdout.resume();runtime.stderr.resume();
 await broker.takeLease('fixture',runtime.pid);
 process.send({pid:runtime.pid});setInterval(()=>{},1000);
})();`},outfile:ownerScript,bundle:true,platform:'node',format:'cjs'})
  const owner=spawn(process.execPath,[ownerScript],{cwd:home,
    env:{PATH:process.env.PATH,HOME:home,STATE:orphanState,FIXTURE:fixture,HOST_SCRIPT:join(root,'dist/runtime-host.js')},
    stdio:['ignore','ignore','ignore','ipc']})
  children.push(owner);pids.add(owner.pid)
  const ownerExit=once(owner,'exit');let orphanPid
  owner.on('message',message=>{orphanPid=message.pid;pids.add(orphanPid)})
  await until(()=>orphanPid!==undefined)
  let reservation
  await until(async()=>{
    reservation=JSON.parse(await readFile(join(orphanState,'starting.json'),'utf8'))
    return typeof reservation.runtimeStartTime==='string'&&reservation.hostProtocol==='ipc-2'
  })
  pids.add(reservation.hostPid)
  owner.kill('SIGSTOP');process.kill(reservation.hostPid,'SIGKILL');owner.kill('SIGKILL');await ownerExit
  await until(()=>!live(reservation.hostPid));assert.ok(live(orphanPid))
  const nextBroker=new RuntimeBroker({stateDir:orphanState})
  const transition=await nextBroker.acquireTransition()
  try {await nextBroker.waitForStartup(undefined,1000,true)} finally {transition.release()}
  assert.ok(!live(orphanPid))
  await assert.rejects(readFile(join(orphanState,'starting.json'),'utf8'),{code:'ENOENT'})
  report.nextStartRecoversUnpublishedOrphanAfterAllManagersKilled=true

  const cancelled=await launch('silent')
  cancelled.runtime.kill('SIGTERM')
  await until(()=>!live(cancelled.runtime.pid)&&!live(cancelled.hostPid))
  await cancelled.broker.waitForStartup(undefined,1000)
  report.startupCancellationCleansBoth=true

  // A server can die while an extension host is still present in the ledger.
  const server=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})
  const serverExit=once(server,'exit');children.push(server);pids.add(server.pid)
  const serverStart=await probe.startTime(server.pid);assert.ok(serverStart)
  const bound=await launch()
  const lease=bound.broker.readLeases()[0]
  bound.broker.writeLease({...lease,server:{pid:server.pid,startTime:serverStart}})
  server.kill('SIGKILL');await serverExit
  await until(()=>!live(bound.runtime.pid)&&!live(bound.hostPid))
  report.serverDeathOverridesResidualExtensionHost=true

  // No launch payload after IPC is lost: the helper must exit by itself.
  const abandoned=spawn(process.execPath,[join(root,'dist/runtime-host.js')],{stdio:['ignore','ignore','ignore','ipc']})
  children.push(abandoned);pids.add(abandoned.pid)
  abandoned.disconnect()
  await until(()=>!live(abandoned.pid))
  report.abandonedHelperBeforeLaunchExits=true
  report.modelRequests=0;report.isolatedHome=true
  const output=process.env.DSH_TEST_REPORT_DIR || join(root,'artifacts/ui-review/runtime-lifetime')
  await mkdir(output,{recursive:true})
  await writeFile(join(output,'host-lifetime-results.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report))
} finally {
  for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
  for(const pid of pids)try{process.kill(pid,'SIGKILL')}catch{}
  await delay(200);await rm(home,{recursive:true,force:true})
}
