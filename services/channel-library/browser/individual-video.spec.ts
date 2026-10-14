import { expect, type Page, test } from '@playwright/test'
import { browserFixture } from '../test/browser-fixture.js'

let fixture: Awaited<ReturnType<typeof browserFixture>>
test.beforeEach(async () => {
  fixture = await browserFixture()
})
test.afterEach(async () => {
  await fixture.dispose()
})
async function unlock(page: Page, key = 'browser-fixture-owner') {
  await page.getByLabel('Access key').fill(key)
  await page.getByRole('button', { name: 'Unlock library' }).click()
  await expect(page.getByLabel('YouTube video URL')).toBeVisible()
}
async function start(page: Page) {
  await page.goto(fixture.origin)
  await unlock(page)
}
const url = 'https://youtu.be/zzzzzzzzzzz'
test('adds an individual video and opens its reader', async ({ page }) => {
  await start(page)
  const form = await page.getByLabel('YouTube video URL').boundingBox()
  const filters = await page.getByLabel('Search videos').boundingBox()
  expect(form && filters && form.y < filters.y).toBe(true)
  await page.getByLabel('YouTube video URL').fill(url)
  await page.getByRole('button', { name: 'Add video', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'YouTube video zzzzzzzzzzz', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Added individually', { exact: true })).toBeVisible()
  await expect(page.getByText('Pending', { exact: true })).toBeVisible()
  expect(fixture.store.video('zzzzzzzzzzz')).toMatchObject({
    channelId: null,
    publishedAt: null,
    status: 'pending',
  })
  const original = fixture.store.original('abcdefghijk')
  const enrichment = fixture.store.enrichment('abcdefghijk')
  if (!original || !enrichment) throw new Error('Missing controlled reader fixture')
  fixture.store.saveOriginal('zzzzzzzzzzz', { ...original, videoId: 'zzzzzzzzzzz', sourceUrl: url })
  fixture.store.saveEnrichment('zzzzzzzzzzz', enrichment)
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('Resumo de teste controlado.', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Original transcript', exact: true }).click()
  await expect(
    page.getByText('This is controlled fixture content, not a live YouTube transcript.', {
      exact: true,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Add favorite', exact: true }).click()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await expect(page.getByLabel('YouTube video URL')).toHaveValue('')
  await page.getByLabel('YouTube video URL').fill(url)
  await page.getByRole('button', { name: 'Add video', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove favorite' })).toBeVisible()
  expect(fixture.store.videos({}).total).toBe(26)
})
test('handles admission loading and errors', async ({ page }) => {
  await start(page)
  for (const status of [400, 413, 429, 503]) {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/v1/videos', async (route) => {
      await gate
      await route.fulfill({ status, json: { error: { message: `Admission error ${status}` } } })
    })
    await page.getByLabel('YouTube video URL').fill(url)
    await page.getByRole('button', { name: 'Add video', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Adding video…' })).toBeDisabled()
    release()
    await expect(page.getByRole('alert')).toContainText(`Admission error ${status}`)
    await expect(page.getByLabel('YouTube video URL')).toHaveValue(url)
    await expect(page.getByRole('button', { name: 'Add video', exact: true })).toBeEnabled()
    await page.unroute('**/api/v1/videos')
  }
  await page.route('**/api/v1/videos', (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'Unauthorized' } } }),
  )
  await page.getByRole('button', { name: 'Add video', exact: true }).click()
  await expect(page.getByLabel('Access key')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Access denied')
})
test('isolates admission across sessions', async ({ page }) => {
  await start(page)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/videos', async (route) => {
    await gate
    await route.continue()
  })
  await page.getByLabel('YouTube video URL').fill(url)
  await page.getByRole('button', { name: 'Add video', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Adding video…' })).toBeDisabled()
  await page.getByRole('button', { name: /Lock library/ }).click()
  fixture.config.accessKey = 'next-owner'
  await unlock(page, 'next-owner')
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/videos') && r.status() === 401,
  )
  release()
  await response
  await expect(page.getByLabel('YouTube video URL')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Add video', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Access key')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
test('supports keyboard and responsive admission', async ({ page }) => {
  // Empty the fixture with dependent rows first, retaining the real HTTP and SQLite boundary.
  fixture.store.db.exec(
    'DELETE FROM enrichments; DELETE FROM sources; DELETE FROM videos; DELETE FROM channels;',
  )
  await start(page)
  await expect(page.getByText('Your next good read starts with a video or channel.')).toBeVisible()
  await page.getByRole('button', { name: 'Channels', exact: true }).click()
  await expect(page.getByLabel('YouTube channel URL')).toBeVisible()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 900 })
    const input = page.getByLabel('YouTube video URL')
    await input.focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Add video', exact: true })).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: test.info().outputPath(`admission-${width}.png`),
      fullPage: true,
    })
  }
  await page.getByLabel('YouTube video URL').fill(url)
  await page.getByLabel('YouTube video URL').press('Enter')
  await expect(
    page.getByRole('heading', { name: 'YouTube video zzzzzzzzzzz', exact: true }),
  ).toBeVisible()
})
