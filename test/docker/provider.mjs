import { createServer } from 'node:http'
const original = 'A preserved original from the controlled container provider.'
createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
  let status = 200, data
  if (request.url === '/health') data = { status: 'ok' }
  else if (request.url === '/v1/jobs' && request.headers.authorization === 'Bearer fixture-transcript') {
    status = 202; data = { jobId: new URL(body.url).searchParams.get('v') }
  } else if (/^\/v1\/jobs\/[^/]+\/transcript$/.test(request.url)) {
    const videoId = request.url.split('/')[3]
    data = { videoId, sourceUrl: `https://youtu.be/${videoId}`, source: 'youtube_captions', language: 'en', isGenerated: false, timestampPrecision: 'caption', extractedAt: '2026-10-05T00:00:00Z', text: original, segments: [] }
  } else if (/^\/v1\/jobs\/[^/]+$/.test(request.url)) data = { status: 'completed' }
  else if (request.url === '/chat/completions') {
    if (body.model === 'reject') { status = 400; data = { error: { message: 'private provider body' } } }
    else data = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ correctedText: 'A corrected transcript from the container fixture.', summary: 'Resumo controlado.', keyPoints: ['Ponto controlado.'] }) } }] }
  } else { status = 401; data = { error: 'Unauthorized' } }
  response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(data))
}).listen(8090, '0.0.0.0')
