import { defineRailway, preserve, project, service } from 'railway/iac'

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
    env: {
      API_ACCESS_KEY: preserve(),
      OPENCODE_API_KEY: preserve(),
    },
  })

  return project('transcript-youtube-videos-api', {
    resources: [web],
  })
})
