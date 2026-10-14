// Real Docker proofs: controlled providers, never the owner's data or external model quota.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { createRequire } from 'node:module'
const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(new URL('../../services/channel-library/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const project = `docker-proof-${process.pid}`
let temp, env, url, launcher, logs = '', composeFiles, occupied = []
const secret = 'fixture-container-private-token'
const id = 'abcdefghijk'
function command(exe, args, options = {}) {
  const p = spawnSync(exe, args, { cwd: root, env: env || process.env, encoding: 'utf8', timeout: 1200000, maxBuffer: 20 * 1024 * 1024, ...options })
  assert.equal(p.status, 0, `${exe} ${args.join(' ')} failed: ${p.error?.message || ''}\n${p.stderr || ''}`)
  return p.stdout.trim()
}
const docker = (...args) => command('docker', args)
const compose = (...args) => docker('compose', '--project-name', project, '--env-file', env.TRANSCRIPT_ENV_FILE, ...composeFiles, ...args)
async function until(fn, timeout = 30000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { const result = await fn(); if (result) return result; await sleep(250) }
  throw new Error('Condition did not become true before timeout')
}
async function api(path, method = 'GET', body, authorized = true) {
  const r = await fetch(url + '/api/v1' + path, { method, headers: { ...(authorized ? { authorization: `Bearer ${secret}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, body: await r.json() }
}
function inspect() { return JSON.parse(docker('inspect', ...compose('ps', '-a', '-q').split('\n').filter(Boolean))) }
async function startAttached() {
  logs = ''
  launcher = spawn('make', ['docker-up'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  launcher.stdout.on('data', x => { logs += x }); launcher.stderr.on('data', x => { logs += x })
  await until(() => { if (launcher.exitCode !== null || launcher.signalCode !== null) throw new Error(logs); return /URL: (http:\/\/127\.0\.0\.1:\d+)/.exec(logs) }, 180000)
  url = /URL: (http:\/\/127\.0\.0\.1:\d+)/.exec(logs)[1]
}
async function stopAttached() {
  if (!launcher || launcher.exitCode !== null || launcher.signalCode !== null) return
  const ended = once(launcher, 'close'); process.kill(-launcher.pid, 'SIGINT'); await ended
  // GNU Make preserves SIGINT as its exit signal even when the recipe exits cleanly.
  assert.equal(launcher.exitCode ?? launcher.signalCode, 'SIGINT', logs)
  assert.match(logs, /Containers stopped\. Persistent volumes retained\./)
  launcher = null
}
async function startFixture(model = 'fixture') {
  await writeFile(env.LIBRARY_ENV_FILE, `LIBRARY_ACCESS_KEY=${secret}\nOPENCODE_API_KEY=${secret}\nYOUTUBE_DISCOVERY_MODE=rss\nLLM_BASE_URL=http://provider:8090\nLLM_MODEL=${model}\n`)
  composeFiles = ['-f', join(root, 'compose.yaml'), '-f', join(temp, 'fixture.yaml')]
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '180')
  url = 'http://' + compose('port', 'web', '8080')
}
before(async () => {
  const available = spawnSync('docker', ['info'], { encoding: 'utf8' })
  assert.equal(available.status, 0, 'Docker runtime proof unavailable: install Docker/Compose and grant this shell engine access; this is a failure, not a skipped pass.')
  temp = await mkdtemp(join(tmpdir(), project + '-'))
  env = { ...process.env, DOCKER_PROJECT_NAME: project, COMPOSE_PROJECT_NAME: project,
    TRANSCRIPT_ENV_FILE: join(temp, 'transcript.env'), LIBRARY_ENV_FILE: join(temp, 'library.env') }
  delete env.DOCKER_WEB_PORT
  await writeFile(env.TRANSCRIPT_ENV_FILE, `API_ACCESS_KEY=fixture-transcript\nOPENCODE_API_KEY=${secret}\n`)
  await writeFile(env.LIBRARY_ENV_FILE, `LIBRARY_ACCESS_KEY=${secret}\nOPENCODE_API_KEY=${secret}\nYOUTUBE_DISCOVERY_MODE=rss\n`)
  composeFiles = ['-f', join(root, 'compose.yaml')]
  const context = join(temp, 'context')
  await cp(root, context, { recursive: true, filter: p => !p.split('/').some(x => ['node_modules', '.git', '.data', '.models', 'dist', 'test-results', '.specs'].includes(x)) && !p.endsWith('/.env') })
  for (const base of [context, join(context, 'services/channel-library')]) {
    await writeFile(join(base, '.env'), `IMAGE_SECRET=${secret}\n`)
    await writeFile(join(base, '.env.private'), `IMAGE_SECRET=${secret}\n`)
    await writeFile(join(base, 'local.sqlite'), 'local-data-sentinel')
  }
  for (const [name, dir, file] of [['transcript', context, 'Dockerfile'], ['library', join(context, 'services/channel-library'), 'Dockerfile'], ['web', join(context, 'services/channel-library'), 'web/Dockerfile']]) {
    console.log(`Building ${name} image from context without node_modules or dist`)
    command('docker', ['build', '-t', `${project}-${name}`, '-f', join(dir, file), dir])
  }
  await writeFile(join(temp, 'fixture.yaml'), `services:\n  provider:\n    image: ${project}-library\n    command: [node, /fixture/provider.mjs]\n    volumes:\n      - ${join(root, 'test/docker/provider.mjs')}:/fixture/provider.mjs:ro\n    healthcheck:\n      test: [CMD, node, -e, "fetch('http://127.0.0.1:8090/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]\n      interval: 1s\n      timeout: 3s\n      retries: 20\n  library:\n    environment:\n      TRANSCRIPT_API_URL: http://provider:8090\n    depends_on:\n      provider:\n        condition: service_healthy\n`)
}, { timeout: 1200000 })
after(async () => {
  if (launcher && launcher.exitCode === null && launcher.signalCode === null) { process.kill(-launcher.pid, 'SIGINT'); await once(launcher, 'close') }
  for (const s of occupied) await new Promise(r => s.close(r))
  if (temp) {
    try { compose('down', '--volumes', '--remove-orphans') } finally { await rm(temp, { recursive: true, force: true }) }
  }
})
test('C1 all three images built from clean dependency-free contexts', { timeout: 240000 }, () => {
  for (const name of ['transcript', 'library', 'web']) assert.equal(JSON.parse(docker('image', 'inspect', `${project}-${name}`))[0].Architecture, 'amd64')
})
test('C2 three healthy services print URL and combined logs', async () => {
  await startAttached()
  assert.equal(inspect().filter(c => c.State.Health.Status === 'healthy').length, 3)
  await fetch(url + '/api/v1/videos', { headers: { authorization: `Bearer ${secret}` } })
  await until(() => /library.*Library listening/.test(logs) && /transcript.*ready/.test(logs) && /web.*GET/.test(logs))
})
test('C4 loopback dynamic port with usual ports occupied', { timeout: 240000 }, async () => {
  if (!launcher) await startAttached()
  await stopAttached()
  for (const port of [3000, 3100, 5173, 8080]) {
    const server = createServer()
    try { await new Promise((r, j) => { server.once('error', j); server.listen(port, '127.0.0.1', r) }); occupied.push(server) }
    catch (e) { assert.equal(e.code, 'EADDRINUSE') }
  }
  await startAttached()
  const containers = inspect()
  for (const c of containers) {
    const published = Object.values(c.NetworkSettings.Ports).flatMap(p => p || [])
    if (c.Config.Labels['com.docker.compose.service'] === 'web') {
      assert.equal(published.length, 1); assert.equal(published[0].HostIp, '127.0.0.1')
      assert.ok(![3000,3100,5173,8080].includes(Number(published[0].HostPort)))
    } else assert.equal(published.length, 0)
  }
})
test('C5 occupied explicit port preserves listener and env files', { timeout: 240000 }, async () => {
  const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r))
  try {
    const files = await Promise.all([readFile(env.TRANSCRIPT_ENV_FILE), readFile(env.LIBRARY_ENV_FILE)])
    const p = spawnSync('python3', ['scripts/docker.py','up'], { cwd: root, env: { ...env, DOCKER_PROJECT_NAME: project + '-occupied', DOCKER_WEB_PORT: String(server.address().port) }, encoding: 'utf8' })
    assert.notEqual(p.status, 0); assert.match(p.stderr, /DOCKER_WEB_PORT/); assert.ok(server.listening)
    assert.deepEqual(await Promise.all([readFile(env.TRANSCRIPT_ENV_FILE), readFile(env.LIBRARY_ENV_FILE)]), files)
  } finally { await new Promise(r => server.close(r)) }
})
test('C6 proxy preserves methods bodies auth and status codes', async () => {
  if (!launcher) await startAttached()
  assert.equal((await api('/videos','GET',undefined,false)).status,401)
  assert.equal((await api('/videos')).status,200)
  assert.equal((await api('/videos','POST',{url:'invalid'})).status,400)
  assert.equal((await api('/videos/zzzzzzzzzzz')).status,404)
  const added=await api('/videos','POST',{url:`https://youtu.be/${id}`});assert.equal(added.status,202)
  const patched=await api(`/videos/${id}/reading`,'PATCH',{favorite:true,notes:'Container note',read:true});assert.equal(patched.status,200)
  const detail=await api(`/videos/${id}`);assert.equal(detail.body.video.reading.notes,'Container note')
})
test('C7 library reaches authenticated real transcript service', async () => {
  if (!launcher) await startAttached()
  const result = compose('exec','-T','library','node','--input-type=module','-e', `const u=process.env.TRANSCRIPT_API_URL+'/v1/jobs';for(const authenticated of [false,true]){const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json',...(authenticated?{authorization:'Bearer '+process.env.TRANSCRIPT_API_KEY}:{})},body:'{}'});console.log(r.status)}`)
  assert.equal(result,'401\n400')
})
test('C8 interrupt retains volumes and leaves unrelated containers alone', async () => {
  if (!launcher) await startAttached()
  const other = docker('run','-d','--name',project+'-unrelated',`${project}-library`,'node','-e','setInterval(()=>{},1000)')
  try {
    await stopAttached();assert.equal(compose('ps','-a','-q'),'')
    assert.equal(docker('inspect','--format','{{.State.Running}}',other),'true')
    for(const name of ['transcript-data','library-data'])assert.ok(docker('volume','inspect',`${project}_${name}`))
  } finally { docker('rm','-f',other) }
})
test('C9 status logs down never start a project and retain its volumes', async () => {
  if (!launcher) await startAttached()
  const containers = compose('ps','-a','-q')
  assert.ok(containers)
  command('make',['docker-status']);command('make',['docker-logs'])
  assert.equal(compose('ps','-a','-q'), containers)
  const ended = once(launcher, 'close')
  command('make',['docker-down'])
  await ended
  assert.equal(launcher.exitCode, 0, logs)
  launcher = null
  assert.equal(compose('ps','-a','-q'),'')
  for(const name of ['transcript-data','library-data'])assert.ok(docker('volume','inspect',`${project}_${name}`))
})
test('C10 persisted content and reading state survive recreation', async () => {
  await stopAttached();compose('down');await startFixture()
  await api('/videos','POST',{url:'https://youtu.be/persist1234'})
  const saved = await until(async()=>{const d=await api('/videos/persist1234');return d.body.video.status==='ready' && d.body},60000)
  await api('/videos/persist1234/reading','PATCH',{favorite:true,read:true,notes:'Persisted note'})
  const before=(await api('/videos/persist1234')).body
  assert.ok(saved.original.text);assert.ok(saved.enrichment.correctedText)
  compose('down');await startFixture()
  const after=(await api('/videos/persist1234')).body
  assert.deepEqual(after.original,before.original);assert.deepEqual(after.enrichment,before.enrichment)
  assert.equal(after.video.reading.favorite,true);assert.equal(after.video.reading.read,true);assert.equal(after.video.reading.notes,'Persisted note')
})
test('C11 named volumes never share host library paths', { timeout: 300000 }, async () => {
  await startFixture()
  for(const [service,name,path] of [['transcript','transcript-data','/data'],['library','library-data','/data/library']]){
    const c=inspect().find(c=>c.Config.Labels['com.docker.compose.service']===service)
    assert.equal(c.Mounts.filter(m=>m.Type==='bind').length,0)
    assert.ok(c.Mounts.some(m=>m.Type==='volume'&&m.Name===`${project}_${name}`&&m.Destination===path))
  }
})
test('C12 image layers and frontend contain no env credentials or local data', async () => {
  for (const name of ['transcript','library','web']) {
    const archive=join(temp,`${name}.tar`);docker('image','save','-o',archive,`${project}-${name}`)
    command('python3',[join(root,'test/docker/inspect_layers.py'),archive,secret]);await rm(archive)
  }
  await startFixture()
  const html=await(await fetch(url)).text();assert.ok(!html.includes(secret))
  for(const path of [...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)].map(x=>x[1]))assert.ok(!(await(await fetch(url+path)).text()).includes(secret))
})
test('C13 applications are non-root and application code is read-only', { timeout: 120000 }, async () => {
  await startFixture()
  for (const service of ['transcript','library']) {
    const status=compose('exec','-T',service,'sh','-c','cat /proc/1/status')
    assert.match(status,/Uid:\s+1000\s+1000/)
    assert.equal(compose('exec','-T','--user','1000',service,'node','-e',"const fs=require('fs');try{fs.writeFileSync('/app/forbidden','x');process.exit(1)}catch{};fs.writeFileSync((process.env.LIBRARY_DATA_DIR||'/data')+'/probe','ok');console.log('writable-data-only')"),'writable-data-only')
  }
  assert.match(compose('exec','-T','web','sh','-c','cat /proc/1/status'),/Uid:\s+101\s+101/)
  compose('exec','-T','web','sh','-c','test ! -w /usr/share/nginx/html/index.html')
})
test('C14 provider rejection preserves original in API and browser and logs safely', async () => {
  await startFixture('reject');await api('/videos','POST',{url:'https://youtu.be/failure1234'})
  const detail=await until(async()=>{const d=await api('/videos/failure1234');return d.body.video.status==='failed'&&d.body},60000)
  assert.equal(detail.video.failure.code,'PROVIDER_REQUEST_REJECTED');assert.ok(detail.original.text)
  const output=compose('logs','--no-color','library');assert.match(output,/PROVIDER_REQUEST_REJECTED/)
  for(const value of [secret,detail.original.text,'private provider body'])assert.ok(!output.includes(value))
  const browser=await chromium.launch({headless:true})
  try{const page=await browser.newPage();await page.goto(url);await page.getByLabel('Access key').fill(secret);await page.getByRole('button',{name:'Unlock library'}).click();await page.getByRole('button',{name:`Read ${detail.video.title}`,exact:true}).click();await page.getByRole('tab',{name:'Original transcript',exact:true}).click();assert.ok((await page.getByRole('tabpanel').textContent()).includes(detail.original.text))}finally{await browser.close()}
})
test('C17 controlled provider proof never claims live external success', () => {
  assert.match(env.TRANSCRIPT_ENV_FILE,/docker-proof-/)
  console.log('Container/image/HTTP/browser proof: controlled providers. Live YouTube/OpenCode: not exercised by this suite.')
})
