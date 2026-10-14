import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { browserFixture, fixtureId } from '../test/browser-fixture.js'

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
  await expect(
    page.getByRole('button', { name: 'Read Fixture reading story', exact: true }),
  ).toBeVisible()
}
async function open(page: Page) {
  await page.goto(fixture.origin)
  await unlock(page)
  await page.getByRole('button', { name: 'Read Fixture reading story', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Fixture reading story', exact: true }),
  ).toBeVisible()
}
test('T11 favorite persists after reload against the real library API', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Add favorite', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove favorite' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(fixture.store.video(fixtureId)?.reading.favorite).toBe(true)
  await page.reload()
  await unlock(page)
  await page.getByRole('button', { name: 'Read Fixture reading story', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove favorite' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove favorite' }).click()
  await expect(page.getByRole('button', { name: 'Add favorite' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})
test('T12 read state persists independently of favorite and can be cleared', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mark unread' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(fixture.store.video(fixtureId)?.reading).toMatchObject({ read: true, favorite: false })
  await page.reload()
  await unlock(page)
  await page.getByRole('button', { name: 'Read Fixture reading story', exact: true }).click()
  await page.getByRole('button', { name: 'Mark unread' }).click()
  await expect(page.getByRole('button', { name: 'Mark as read' })).toBeVisible()
  expect(fixture.store.video(fixtureId)?.reading.read).toBe(false)
})
test('T13 notes survive polling failed save and successful retry without changing source', async ({
  page,
}) => {
  await page.clock.install()
  const original = fixture.store.original(fixtureId)
  await open(page)
  await page.getByLabel('Personal notes').fill('An unsaved personal idea.')
  await page.clock.fastForward(6000)
  await expect(page.getByLabel('Personal notes')).toHaveValue('An unsaved personal idea.')
  await page.route('**/reading', (route) =>
    route.fulfill({ status: 503, json: { error: { message: 'Save failed' } } }),
  )
  await page.getByRole('button', { name: 'Save notes' }).click()
  await expect(page.getByRole('alert')).toContainText('Save failed')
  await expect(page.getByLabel('Personal notes')).toHaveValue('An unsaved personal idea.')
  await page.unroute('**/reading')
  await page.getByRole('button', { name: 'Save notes' }).click()
  await expect(page.getByText('Notes saved.', { exact: true })).toBeVisible()
  expect(fixture.store.video(fixtureId)?.reading.notes).toBe('An unsaved personal idea.')
  expect(fixture.store.original(fixtureId)).toEqual(original)
  await page.getByLabel('Personal notes').fill('😀'.repeat(10001))
  await expect(page.getByRole('button', { name: 'Save notes' })).toBeDisabled()
})
test('T14 Markdown downloads from authenticated API without putting tokens in URLs', async ({
  page,
}) => {
  await open(page)
  const request = page.waitForRequest((r) => r.url().endsWith('/export'))
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Markdown' }).click()
  const req = await request,
    file = await download
  expect(req.url()).toBe(`${fixture.origin}/api/v1/videos/${fixtureId}/export`)
  expect(req.headers().authorization).toBe('Bearer browser-fixture-owner')
  expect(file.suggestedFilename()).toBe(`video-${fixtureId}.md`)
  const path = await file.path()
  expect(path).toBeTruthy()
  const content = readFileSync(path as string, 'utf8')
  expect(content).toContain('# Fixture reading story')
  expect(content).toContain('## Original transcript')
  expect(content).toContain('Resumo de teste controlado')
})
test('T15 filters combine reset pagination and fit a keyboard operated mobile reader', async ({
  page,
}) => {
  fixture.store.updateReading(fixtureId, { favorite: true, read: true }, Date.now())
  fixture.store.updateReading('video000001', { favorite: true }, Date.now())
  await page.goto(fixture.origin)
  await unlock(page)
  await page.getByRole('button', { name: 'Next →' }).click()
  await expect(page.getByText('Page 2 of 2')).toBeVisible()
  await page.getByLabel('Filter favorites').selectOption('true')
  await page.getByLabel('Filter reading state').selectOption('false')
  await expect(page.getByText('Page 1 of 1')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Read Fixture story 1', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Read Fixture reading story', exact: true }),
  ).toHaveCount(0)
  await page.getByLabel('Search videos').fill('not present')
  await expect(page.getByText('No videos match these filters.')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByLabel('Search videos')).toHaveValue('')
  await expect(page.getByLabel('Filter favorites')).toHaveValue('')
  await expect(page.getByLabel('Filter reading state')).toHaveValue('')
  await expect(page.getByText('Page 1 of 2')).toBeVisible()
  await page.getByRole('button', { name: 'Read Fixture reading story', exact: true }).click()
  await page.setViewportSize({ width: 360, height: 800 })
  const favorite = page.getByRole('button', { name: 'Remove favorite' })
  await favorite.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Add favorite' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
test('T5 stale old-session failures cannot log out a newly unlocked session', async ({ page }) => {
  await page.goto(fixture.origin)
  await unlock(page)
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  let captured: () => void = () => {}
  const seen = new Promise<void>((r) => {
    captured = r
  })
  await page.route('**/api/v1/videos?**', async (route) => {
    if (
      route.request().headers().authorization === 'Bearer browser-fixture-owner' &&
      new URL(route.request().url()).searchParams.get('q') === 'delayed'
    ) {
      captured()
      await gate
      await route.continue()
    } else await route.continue()
  })
  await page.getByLabel('Search videos').fill('delayed')
  await seen
  await page.getByRole('button', { name: /Lock library/ }).click()
  fixture.config.accessKey = 'new-owner'
  await page.getByLabel('Access key').fill('new-owner')
  await page.getByRole('button', { name: 'Unlock library' }).click()
  await expect(page.getByRole('heading', { name: /Your video library/ })).toBeVisible()
  const oldResponse = page.waitForResponse((r) => r.status() === 401)
  release()
  await oldResponse
  await page.getByLabel('Search videos').fill('')
  await expect(
    page.getByRole('button', { name: 'Read Fixture reading story', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Unlock library' })).toHaveCount(0)
})
