// Real official-runtime settings writes use an isolated HOME and an HTTP model-list fixture.
// No user profile, inference call, or installed extension is changed.
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { once } from 'node:events'
import { createServer } from 'node:http'
const root=process.cwd()
const {outputFiles}=await build({stdin:{contents:"export {DshConnection} from './src/dsh-connection.ts'; export {DshClient} from './src/dsh-client.ts'; export {providerMutations,reasoningLevels,searchSelectionMutations,fieldMutations,searchSettings} from './src/settings-page-state.ts'",resolveDir:root},bundle:true,platform:'node',format:'cjs',write:false})
const mod={exports:{}};new Function('module','exports','require',outputFiles[0].text)(mod,mod.exports,createRequire(root+'/package.json'))
const {DshClient,DshConnection,providerMutations,reasoningLevels,searchSelectionMutations,fieldMutations,searchSettings}=mod.exports
const home=await mkdtemp(join(tmpdir(),'dsh-settings-smoke-'))
let modelRequests=0, modelLists=0, connection, client
const endpoint=createServer((request,response)=>{
 if(request.method==='GET'&&request.url==='/v1/models') {
  modelLists++
  if(request.headers.authorization!=='Bearer fixture-key'){response.writeHead(401);response.end('Fixture authentication rejected');return}
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify({object:'list',data:[{id:'fixture-model',object:'model',owned_by:'fixture'}]}))
 } else {modelRequests++;response.writeHead(400);response.end('Unexpected inference request')}
})
endpoint.listen(0,'127.0.0.1');await once(endpoint,'listening')
const baseURL='http://127.0.0.1:'+endpoint.address().port+'/v1'
const child=spawn(process.env.DSH_TEST_EXECUTABLE||'dsh',['web','--port','0','--no-open'],{env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,LANG:'en_US.UTF-8'},stdio:['ignore','pipe','pipe']})
const exited=once(child,'exit')
try {
 const launch=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error('Isolated runtime startup timed out')),45000)
 const output=chunk=>{log+=String(chunk);const match=log.match(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/?\?token=[A-Za-z0-9_-]+)/);if(match){clearTimeout(timer);resolve(new URL(match[1]))}}
 child.stdout.on('data',output);child.stderr.on('data',output);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(new Error('Isolated runtime exited'))})})
 connection=new DshConnection(new URL(launch.origin));await connection.authenticate(launch)
 client=new DshClient(connection);await client.startStreams()
 const settings=await client.settings(), shell=settings.namespaces.find(ns=>ns.ns==='bash-sandbox'||ns.ns==='pwsh-sandbox')
 assert.ok(shell);const old=shell.value.timeoutMs
 await client.mutateSettings(shell.ns,[{op:'set',path:['timeoutMs'],value:90000}],shell.revision)
 await assert.rejects(client.mutateSettings(shell.ns,[{op:'set',path:['timeoutMs'],value:100000}],shell.revision),error=>error.code==='settings/conflict')
 let latest=(await client.settings()).namespaces.find(ns=>ns.ns===shell.ns)
 assert.equal(latest.value.timeoutMs,90000)
 await client.mutateSettings(latest.ns,[{op:'unset',path:['timeoutMs']}],latest.revision)
 latest=(await client.settings()).namespaces.find(ns=>ns.ns===shell.ns);assert.equal(latest.value.timeoutMs,old)
 const providers=await client.listConfigurableProviders();assert.ok(providers.length>0);await client.listLlmProviders()
 const pi=(await client.settings()).namespaces.find(ns=>ns.ns==='llm-pi-ai')
 await client.mutateSettings(pi.ns,[{op:'set',path:['providers','fixture-settings'],value:{baseURL,api:'openai-completions',apiKeyEnv:'FIXTURE_SETTINGS_API_KEY',defaultMaxTokens:1500,models:[{id:'fixture-model',name:'Original',contextWindow:10000,maxTokens:1000,input:['text']}]}}],pi.revision)
 await client.setCredential('FIXTURE_SETTINGS_API_KEY','fixture-key')
 const credential=await client.describeCredentials(['FIXTURE_SETTINGS_API_KEY'])
 assert.equal(credential.FIXTURE_SETTINGS_API_KEY.configured,true)
 assert.equal(JSON.stringify(credential).includes('fixture-key'),false)
 const discovered=await client.discoverModels(pi.ns,{baseURL,api:'openai-completions',apiKey:'fixture-key'})
 assert.ok(discovered.some(model=>model.id==='fixture-model'));assert.equal(modelLists,1)
 const next=(await client.settings()).namespaces.find(ns=>ns.ns===pi.ns)
 const entry=(await client.listConfigurableProviders()).find(row=>row.provider==='fixture-settings');assert.ok(entry)
 assert.ok(reasoningLevels(next).includes('high'),'Runtime reasoning schema was not recognized')
 await client.mutateSettings(pi.ns,providerMutations(next,entry,{models:[{id:'fixture-model',originalId:'fixture-model',name:'Edited',contextWindow:12000,maxTokens:1200,input:['text'],reasoningEfforts:{off:null,low:'minimal',high:'adaptive'}}]}),next.revision)
 const stored=(await client.settings()).namespaces.find(ns=>ns.ns===pi.ns)
 assert.equal(stored.value.providers['fixture-settings'].models[0].name,'Edited')
 assert.deepEqual(stored.value.providers['fixture-settings'].models[0].reasoningEfforts,{off:null,low:'minimal',high:'adaptive'})
 assert.equal(stored.value.providers['fixture-settings'].defaultMaxTokens,1500)
 const searchDescription=await client.settings(), web=searchDescription.namespaces.find(ns=>ns.ns==='web'), searchApi=searchDescription.namespaces.find(ns=>ns.ns==='web-deepseek-api')
 assert.equal(searchSettings(searchDescription,{}).selection.available,true)
 await client.mutateSettings(searchApi.ns,fieldMutations(searchApi,{baseURL:baseURL+'/tools',count:25}),searchApi.revision)
 assert.throws(()=>fieldMutations(searchApi,{count:51}))
 await client.mutateSettings(web.ns,searchSelectionMutations(web,true),web.revision)
 const searchSelected=(await client.settings()).namespaces.find(ns=>ns.ns===web.ns)
 assert.equal(searchSelected.value.searchProvider,'deepseek-search-api');assert.equal(searchSelected.value.fetchProvider,'deepseek-fetch-api')
 await client.mutateSettings(web.ns,searchSelectionMutations(searchSelected,false),searchSelected.revision)
 const searchReset=(await client.settings()).namespaces.find(ns=>ns.ns===web.ns)
 assert.equal(searchReset.value.searchProvider,'deepseek-official');assert.equal(searchReset.value.fetchProvider,'http')
 async function yamlFiles(directory){const found=[];for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())found.push(...await yamlFiles(path));else if(/\.ya?ml$/.test(entry.name))found.push(path)}return found}
 for(const path of await yamlFiles(home)) {
  if(basename(path)==='.credentials.yaml') { if(process.platform!=='win32')assert.equal((await stat(path)).mode&0o077,0,'Credential file is readable by another user') }
  else assert.equal((await readFile(path,'utf8')).includes('fixture-key'),false,'Credential literal in a profile YAML file')
 }
 await client.unsetCredential('FIXTURE_SETTINGS_API_KEY');assert.equal((await client.describeCredentials(['FIXTURE_SETTINGS_API_KEY'])).FIXTURE_SETTINGS_API_KEY.configured,false)
 await client.mutateSettings(pi.ns,[{op:'unset',path:['providers','fixture-settings']}],stored.revision)
 assert.equal(modelRequests,0)
 console.log(JSON.stringify({settingsReadWriteReset:true,staleRevisionRejected:true,providerCreateEditRemove:true,credentialWriteDescribeClear:true,credentialsAbsentFromProfileYaml:true,privateCredentialFilePermissions:process.platform==='win32'?'OS-managed':true,endpointModelDiscovery:true,unshownProviderFieldsPreserved:true,reasoningSchemaAndMapping:true,searchFetchSwitchAndLimits:true,modelRequests,homeIsolated:true}))
} finally {
 client?.dispose();connection?.dispose();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await exited;clearTimeout(timer)
 await new Promise(resolve=>endpoint.close(resolve));await rm(home,{recursive:true,force:true})
}
