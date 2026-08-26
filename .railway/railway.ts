import { defineRailway, project, service } from 'railway/iac'

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
  })

  return project('transcript-youtube-videos-api', {
    resources: [web],
  })
})
