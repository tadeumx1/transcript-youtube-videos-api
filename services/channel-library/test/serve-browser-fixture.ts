import { browserFixture } from './browser-fixture.js'

const fixture = await browserFixture(Number(process.env.PREVIEW_PORT || 4180))
console.log(
  `Controlled fixture reader: ${fixture.origin}. Fixture access key: browser-fixture-owner`,
)
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => void fixture.dispose())
