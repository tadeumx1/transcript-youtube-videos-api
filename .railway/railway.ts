import { defineRailway, preserve, project, service, volume } from 'railway/iac'

export const partial = 'transcript-youtube-videos-api'

export default defineRailway(() => {
  const web = service('transcript-youtube-videos-api', {
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'Dockerfile',
    },
    deploy: {
      healthcheckPath: '/health',
      healthcheckTimeout: 300,
    },
    replicas: 1,
    env: {
      API_ACCESS_KEY: preserve(),
      DATA_ROOT: '/data/transcripts',
      OPENCODE_API_KEY: preserve(),
      RAG_DATA_ROOT: '/data/lancedb',
    },
    volumeMounts: {
      '/data': volume('transcript-data', { sizeMB: 1024 }),
    },
  })

  return project('transcript-youtube-videos-api', {
    resources: [web],
  })
})
