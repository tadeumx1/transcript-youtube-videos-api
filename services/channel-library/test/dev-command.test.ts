import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'

test('T2 root development wrapper forwards both Vite flags', async () => {
  const result = await promisify(execFile)(
    'npm',
    ['run', 'library:dev:web', '--', '--port', '4299', '--strictPort', '--help'],
    { cwd: '../..', timeout: 5000 },
  )
  expect(result.stdout).toContain('vite --host 127.0.0.1 --port 4299 --strictPort --help')
  expect(result.stdout).toContain('--strictPort')
  expect(result.stderr).not.toContain('Unknown cli config')
})
