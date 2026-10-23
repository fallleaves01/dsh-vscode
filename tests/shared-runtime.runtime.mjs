// True multi-process lifecycle tests. All state is temporary; no model requests.
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const home = await mkdtemp(join(tmpdir(), 'dsh-shared-runtime-'))
const workers = [], runtimePids = new Set(), helperPids = new Set(), report = {}
const live = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await check()) return; await delay(75) }
  throw new Error('Isolated shared runtime condition timed out.')
}
const vscodeSource = `
const { EventEmitter: Emitter } = require('node:events');
exports.EventEmitter = class { events = new Emitter(); event = listener => { this.events.on('change', listener); return {dispose:()=>this.events.off('change',listener)} }; fire(value){this.events.emit('change',value)} dispose(){this.events.removeAllListeners()} };
exports.Uri = { file:fsPath=>({fsPath}), parse:value=>({toString:()=>value,fsPath:value}) };
exports.workspace = { workspaceFolders:[], getConfiguration:()=>({get:(key,fallback)=>({
 executable:process.env.DSH_TEST_EXECUTABLE || 'dsh', reuseExistingRuntime:false, startupTimeout:25000,
 enableHistorySearch:process.env.DSH_TEST_TASKS !== 'false', enableSchedule:process.env.DSH_TEST_TASKS !== 'false'
 }[key] ?? fallback),inspect:()=>undefined}) };
`
try {
  await mkdir(join(home, 'project-a')); await mkdir(join(home, 'project-b'))
  const workerScript = join(home, 'worker.cjs')
  await build({ entryPoints: [join(root, 'tests/shared-runtime.worker.ts')], outfile: workerScript,
    bundle: true, platform: 'node', format: 'cjs', plugins: [{name:'isolated-vscode',setup(builder){
      builder.onResolve({filter:/^vscode$/},()=>({path:'vscode',namespace:'fixture'}))
      builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:vscodeSource,loader:'js'}))
    }}] })
  function worker(profile, project = 'project-a', tasks = true, version = '0.1.11') {
    const child = spawn(process.execPath, [workerScript], { cwd: home,
      env: { PATH: process.env.PATH, HOME: home, DSH_HOME: join(home, 'dsh'), LANG: 'en_US.UTF-8',
        DSH_TEST_EXTENSION: root, DSH_TEST_PROJECT: join(home, project), DSH_TEST_PROFILE: profile,
        DSH_TEST_TASKS: String(tasks), DSH_TEST_VERSION: version,
        ...(process.env.DSH_TEST_EXECUTABLE ? {DSH_TEST_EXECUTABLE:process.env.DSH_TEST_EXECUTABLE} : {}) },
      stdio: ['ignore','pipe','pipe','ipc'] })
    const exited = once(child, 'exit'), pending = new Map(); let id = 0
    child.stdout.resume(); child.stderr.resume()
    child.on('message', response => {
      const operation = pending.get(response.id); if (!operation) return
      pending.delete(response.id); clearTimeout(operation.timer)
      if (response.error) operation.reject(new Error(profile+' '+operation.command+': '+response.error)); else operation.resolve(response.result)
    })
    child.on('exit', () => { for (const op of pending.values()) { clearTimeout(op.timer); op.reject(new Error('Worker exited')) }; pending.clear() })
    const call = (command, extra = {}) => new Promise((resolve,reject) => {
      const request = ++id, timer = setTimeout(()=>{pending.delete(request);reject(new Error('Worker command timed out: '+command))},45000)
      pending.set(request,{resolve,reject,timer,command}); child.send({id:request,command,...extra})
    })
    const result = {child,exited,call}; workers.push(result); return result
  }
  function track(pid) {
    runtimePids.add(pid)
    const parent = Number(execFileSync('ps',['-o','ppid=','-p',String(pid)],{encoding:'utf8'}).trim())
    assert.ok(parent > 0); helperPids.add(parent); return parent
  }
  const a = worker('profile-a','project-a',true,'0.1.10'), b = worker('profile-b','project-b')
  const starts = await Promise.all([a.call('start'), b.call('start')])
  assert.equal(starts[0].pid, starts[1].pid); assert.ok(starts[0].pid > 0)
  const pid = starts[0].pid, helperPid = track(pid)
  assert.deepEqual(starts.map(x=>x.ownership).sort(), ['adopted','managed'])
  report.concurrentStartOneRuntime = true; report.differentUiVersionsCompatible = true; report.differentProfilesShare = true
  assert.deepEqual(await b.call('services'), {historySearch:true,schedule:true}); report.historyAndSchedule = true
  const session = await a.call('create'), other = await b.call('create')
  const read = await b.call('read',session)
  assert.equal(read.commands,true)
  assert.equal(read.sessions.find(x=>x.sessionId===session.sessionId).cwd,join(home,'project-a'))
  assert.equal(read.sessions.find(x=>x.sessionId===other.sessionId).cwd,join(home,'project-b'))
  report.sameSessionTwoClients = true; report.projectCwdPreserved = true
  await assert.rejects(a.call('restart'),/another VS Code window/); report.sharedRestartPreservesOtherWindow = true
  const incompatible = worker('profile-incompatible','project-a',false)
  await assert.rejects(incompatible.call('start'),/incompatible settings/)
  assert.ok(live(pid)); report.incompatibleSettingsNoCompetingRuntime = true
  await a.call('stop'); a.child.send({id:0,command:'exit'}); await a.exited
  assert.ok(live(pid)); await b.call('read',session)
  report.spawningWindowExitPreservesBorrower = true
  const reconnected = worker('profile-reconnect')
  const resumed = await reconnected.call('start'); assert.equal(resumed.pid,pid)
  report.reconnectReusesRuntime = true
  // Simulate an extension-host crash, with the other live client still attached.
  b.child.kill('SIGKILL'); await b.exited; await reconnected.call('read',session)
  report.borrowerCrashPreservesOtherWindow = true
  await reconnected.call('stop')
  await until(()=>!live(pid)&&!live(helperPid)); report.lastWindowStopsRuntimeAndHost = true

  // The creator has closed. Both remaining windows must detect a killed helper,
  // without reporting a healthy runtime or automatically spawning another DSH.
  const hostOwner = worker('profile-host-owner'), observer = worker('profile-host-observer'), observer2 = worker('profile-host-observer-2')
  const hosted = await hostOwner.call('start'), watchedHelper = track(hosted.pid)
  await observer.call('start'); await observer2.call('start')
  await hostOwner.call('stop'); hostOwner.child.send({id:0,command:'exit'}); await hostOwner.exited
  process.kill(watchedHelper,'SIGKILL')
  await until(()=>!live(hosted.pid)&&!live(watchedHelper))
  await until(async()=> (await observer.call('state')).kind==='failed' && (await observer2.call('state')).kind==='failed')
  report.borrowersRecoverKilledHelperAfterCreatorExit = true
  await observer.call('stop'); await observer2.call('stop')

  // No cleanup code survives: kill both the extension host and its helper.
  // Stop DSH first to make the orphan deterministic, including escalation when
  // SIGTERM cannot be handled. New windows must serialize recovery before use.
  const lostOwner = worker('profile-all-managers-lost')
  const lost = await lostOwner.call('start'), lostHelper = track(lost.pid)
  const saved = await lostOwner.call('create')
  // DSH batches live events for 200 ms; an unmaterialized empty conversation
  // cannot survive SIGKILL. Assert an actual log exists before testing recovery
  // of saved history. Inspect only this isolated fixture's session directories.
  await until(async()=>{
    const sessions=join(home,'dsh','sessions')
    const projects=await readdir(sessions).catch(()=>[])
    for(const project of projects) {
      const directory=join(sessions,project,saved.sessionId)
      for(const file of await readdir(directory).catch(()=>[])) {
        if(file.includes('.jsonl')&&!file.endsWith('.tmp')&&(await stat(join(directory,file))).size>0)return true
      }
    }
    return false
  })
  process.kill(lost.pid,'SIGSTOP'); lostOwner.child.kill('SIGSTOP')
  process.kill(lostHelper,'SIGKILL'); lostOwner.child.kill('SIGKILL'); await lostOwner.exited
  await until(()=>!live(lostHelper)); assert.ok(live(lost.pid))
  const nextA = worker('profile-next-a'), nextB = worker('profile-next-b')
  const next = await Promise.all([nextA.call('start'),nextB.call('start')])
  const nextHelper = track(next[0].pid)
  assert.equal(next[0].pid,next[1].pid); assert.notEqual(next[0].pid,lost.pid)
  assert.deepEqual(next.map(x=>x.ownership).sort(),['adopted','managed'])
  assert.ok(!live(lost.pid))
  await nextA.call('read',saved); await nextB.call('read',saved)
  assert.deepEqual(await nextA.call('services'),{historySearch:true,schedule:true})
  report.nextStartRecoversAfterAllManagersKilled = true
  report.concurrentRecoveryStartsOneRuntime = true
  report.savedHistoryAndTaskServicesAfterOrphanRecovery = true
  await nextA.call('stop'); await nextB.call('stop')
  await until(()=>!live(next[0].pid)&&!live(nextHelper))

  // A failed window has no runtime handle or lease. Its explicit, reviewed
  // restart must still replace the incompatible recorded runtime, not repeat
  // the same startup rejection. The old owner's later shutdown cannot kill it.
  const oldOwner = worker('profile-restart-owner', 'project-a', false)
  const old = await oldOwner.call('start'), oldHelper = track(old.pid)
  const durable = await oldOwner.call('create')
  const rescue = worker('profile-restart-rescue')
  await assert.rejects(rescue.call('start'), /incompatible settings/)
  assert.deepEqual(await rescue.call('prepare-restart'), {pid:old.pid, otherWindows:1})
  const replacement = await rescue.call('confirm-restart'), replacementHelper = track(replacement.pid)
  assert.notEqual(replacement.pid, old.pid); assert.equal(replacement.ownership, 'managed')
  await until(()=>!live(old.pid)&&!live(oldHelper))
  await rescue.call('services'); await rescue.call('read',durable)
  report.incompatibleFailedWindowCanRestart = true
  report.confirmedRestartPreservesHistoryAndTaskServices = true
  await oldOwner.call('stop')
  assert.ok(live(replacement.pid)); await rescue.call('read',durable)
  report.oldWindowShutdownPreservesReplacement = true
  await rescue.call('stop')
  await until(()=>!live(replacement.pid)&&!live(replacementHelper))
  report.restartedRuntimeAndHostCleaned = true

  const crash = worker('profile-start-crash')
  await assert.rejects(crash.call('start-and-crash'),/Worker exited/)
  const recovery = worker('profile-start-recovery')
  const recovered = await recovery.call('start'), recoveredHelper = track(recovered.pid)
  assert.equal(recovered.ownership,'adopted'); await recovery.call('services')
  report.startupOwnerCrashRecoverable = true
  recovery.child.kill('SIGKILL'); await recovery.exited
  await until(()=>!live(recovered.pid)&&!live(recoveredHelper)); report.allHostsCrashCleaned = true
  const ledgers = await readdir(join(home,'.dsh-vscode','runtimes'))
  for (const ledger of ledgers) {
    const directory = join(home,'.dsh-vscode','runtimes',ledger)
    assert.ok(!(await readdir(directory)).includes('runtime.json'))
    assert.ok(!(await readdir(directory)).includes('starting.json'))
  }
  report.modelRequests = 0; report.homeIsolated = true
  const output = process.env.DSH_TEST_REPORT_DIR || join(root,'artifacts/ui-review/shared-runtime-fix'); await mkdir(output,{recursive:true})
  await writeFile(join(output,'runtime-results.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report))
} finally {
  for (const {child} of workers) if (child.exitCode===null&&child.signalCode===null) child.kill('SIGKILL')
  await Promise.allSettled(workers.map(x=>x.exited))
  for (const pid of [...runtimePids,...helperPids]) if(live(pid)) try{process.kill(pid,'SIGTERM')}catch{}
  await until(()=>[...runtimePids,...helperPids].every(pid=>!live(pid)),7000).catch(()=>{})
  for (const pid of [...runtimePids,...helperPids]) if(live(pid)) try{process.kill(pid,'SIGKILL')}catch{}
  await rm(home,{recursive:true,force:true})
}
