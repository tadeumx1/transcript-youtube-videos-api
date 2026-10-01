import { expect, type Page, test } from '@playwright/test'

const cid = `UC${'a'.repeat(22)}`
const id = 'abcdefghijk'
const channel = {
  id: cid,
  title: 'Engineering Notes',
  url: `https://www.youtube.com/channel/${cid}`,
  paused: false,
  lastCollectedAt: '2026-10-01T09:00:00Z',
  nextCollectionAt: '2026-10-02T09:00:00Z',
  lastError: null,
  collectionStatus: 'completed',
}
const video = {
  id,
  channelId: cid,
  title: 'How careful systems recover',
  channelTitle: channel.title,
  publishedAt: '2026-10-01T09:00:00Z',
  thumbnail: null,
  status: 'ready',
  failure: null,
}
const detail = {
  video,
  original: {
    text: 'Original <script>window.hacked=true</script>',
    segments: [{ text: 'Original segment', startSeconds: 12, durationSeconds: 5 }],
    language: 'en',
    source: 'youtube_captions',
    timestampPrecision: 'caption',
  },
  enrichment: {
    correctedText: 'A corrected statement.',
    summary: 'Um resumo fiel ao vídeo.',
    keyPoints: ['Retomar após falhas.', 'Preservar o original.'],
    model: 'glm-5.3-flash',
    completedAt: '2026-10-01T10:00:00Z',
  },
}
async function mock(page: Page, options: { empty?: boolean; status?: string } = {}) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    let body: unknown
    if (url.pathname === '/api/v1/channels')
      body =
        method === 'GET'
          ? { items: options.empty ? [] : [channel] }
          : { channel, collectionId: 'run' }
    else if (url.pathname === `/api/v1/videos/${id}`)
      body = {
        ...detail,
        video: { ...video, status: options.status || video.status },
        enrichment: options.status ? null : detail.enrichment,
      }
    else if (url.pathname === '/api/v1/videos')
      body = {
        items: options.empty ? [] : [{ ...video, status: options.status || video.status }],
        total: options.empty ? 0 : 1,
        page: 1,
        pageSize: 20,
      }
    else body = { channel, collectionId: 'run', status: 'pending' }
    await route.fulfill({ json: body })
  })
  await page.goto('/')
  await page.getByLabel('Access key').fill('owner-test-key')
  await page.getByRole('button', { name: 'Unlock library' }).click()
  await expect(page.getByRole('heading', { name: 'Your video library' })).toBeVisible()
}
async function open(page: Page) {
  await page.getByRole('button', { name: 'Read How careful systems recover' }).click()
  await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible()
}
test('C34 untrusted content is rendered as text', async ({ page }) => {
  await mock(page)
  await open(page)
  await page.getByRole('tab', { name: 'Original transcript', exact: true }).click()
  await expect(
    page.getByText('Original <script>window.hacked=true</script>', { exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => Object.hasOwn(window, 'hacked'))).toBe(false)
})
test('C35 channels expose identity collection times and actions', async ({ page }) => {
  await mock(page)
  await page.getByRole('button', { name: 'Channels', exact: true }).click()
  await expect(page.getByText('Engineering Notes', { exact: true })).toBeVisible()
  await expect(page.getByText(/Last collected/)).toBeVisible()
  await expect(page.getByText(/Next collection/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Collect now', exact: true })).toBeVisible()
})
test('C36 video library shows title channel date and status', async ({ page }) => {
  await mock(page)
  await expect(page.getByRole('button', { name: 'Read How careful systems recover' })).toBeVisible()
  await expect(
    page.locator('.card-content').getByText('Engineering Notes', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('article').getByText('Ready', { exact: true })).toBeVisible()
  await expect(page.locator('time')).toHaveAttribute('datetime', video.publishedAt)
})
test('C38 reader provides all four saved content tabs', async ({ page }) => {
  await mock(page)
  await open(page)
  await expect(page.getByText(detail.enrichment.summary, { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Key points', exact: true }).click()
  await expect(page.getByText('Retomar após falhas.', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Corrected transcript', exact: true }).click()
  await expect(page.getByText('A corrected statement.', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Original transcript', exact: true }).click()
  await expect(page.getByText('Original segment', { exact: true })).toBeVisible()
})
test('C39 original timestamp points to YouTube playback time', async ({ page }) => {
  await mock(page)
  await open(page)
  await page.getByRole('tab', { name: 'Original transcript', exact: true }).click()
  await expect(page.getByRole('link', { name: '0:12', exact: true })).toHaveAttribute(
    'href',
    `https://www.youtube.com/watch?v=${id}&t=12s`,
  )
  await page.getByRole('tab', { name: 'Corrected transcript', exact: true }).click()
  await expect(page.getByRole('link', { name: '0:12', exact: true })).toHaveCount(0)
})
test('C40 empty channel and video views provide next action', async ({ page }) => {
  await mock(page, { empty: true })
  await expect(
    page.getByText('Your next good read starts with a channel.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Channels', exact: true }).click()
  await expect(page.getByText('No channels yet.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add channel', exact: true })).toBeVisible()
})
test('C41 all data views display loading state', async ({ page }) => {
  await mock(page)
  await page.route('**/api/v1/videos*', async (route) => {
    await new Promise((r) => setTimeout(r, 600))
    await route.fulfill({ json: { items: [video], total: 1, page: 1, pageSize: 20 } })
  })
  await page.getByLabel('Search videos').fill('recover')
  await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible()
  await page.unroute('**/api/v1/videos*')
  await page.route(`**/api/v1/videos/${id}`, async (route) => {
    await new Promise((r) => setTimeout(r, 600))
    await route.fulfill({ json: detail })
  })
  await page.getByRole('button', { name: 'Read How careful systems recover' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to library' }).click()
  await page.route('**/api/v1/channels', async (route) => {
    await new Promise((r) => setTimeout(r, 600))
    await route.fulfill({ json: { items: [channel] } })
  })
  await page.getByRole('button', { name: 'Channels', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible()
})
test('C42 all data views show retry on error and retain existing results', async ({ page }) => {
  await mock(page)
  await page.route('**/api/v1/videos*', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Try again' } } }),
  )
  await page.getByLabel('Search videos').fill('recover')
  await expect(page.getByRole('alert')).toContainText('Try again')
  await expect(page.getByRole('button', { name: 'Retry loading' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Read How careful systems recover' })).toBeVisible()
  await page.getByRole('button', { name: 'Read How careful systems recover' }).click()
  await expect(page.getByRole('alert')).toContainText('Try again')
  await page.getByRole('button', { name: 'Back to library' }).click()
  await page.route('**/api/v1/channels', (route) =>
    route.fulfill({ status: 503, json: { error: { message: 'Try again' } } }),
  )
  await page.getByRole('button', { name: 'Channels', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Try again')
})
test('C43 unauthorized response returns to access and clears key', async ({ page }) => {
  await mock(page)
  await page.route('**/api/v1/channels', (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'Access denied' } } }),
  )
  await page.getByRole('button', { name: 'Channels', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unlock library' })).toBeVisible()
  await expect(page.getByLabel('Access key')).toHaveValue('')
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 })
})
test('C44 incomplete readers show status original and retry where appropriate', async ({
  page,
}) => {
  for (const status of ['transcribing', 'unavailable', 'failed']) {
    await page.unrouteAll({ behavior: 'wait' })
    await mock(page, { status })
    await open(page)
    await expect(
      page.getByText(status[0].toUpperCase() + status.slice(1), { exact: true }),
    ).toBeVisible()
    await page.getByRole('tab', { name: 'Original transcript', exact: true }).click()
    await expect(page.getByText('Original segment', { exact: true })).toBeVisible()
    if (status !== 'transcribing')
      await expect(page.getByRole('button', { name: 'Retry processing' })).toBeVisible()
  }
})
test('C45 mobile and desktop readers never overflow horizontally', async ({ page }) => {
  await mock(page)
  await open(page)
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    await page.getByRole('tab', { name: 'Corrected transcript', exact: true }).click()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await expect(page.getByRole('button', { name: 'Back to library' })).toBeVisible()
    await page.screenshot({ path: `test-results/reader-${width}.png`, fullPage: true })
  }
})
test('C46 keyboard navigation has labels focus and operable tabs', async ({ page }) => {
  await mock(page)
  await expect(page.getByLabel('Search videos')).toBeVisible()
  await open(page)
  const tab = page.getByRole('tab', { name: 'Key points', exact: true })
  await tab.focus()
  await expect(tab).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Retomar após falhas.', { exact: true })).toBeVisible()
  expect(await tab.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')
})

test('C35 collection state and pause resume actions reflect saved channel state', async ({
  page,
}) => {
  await mock(page)
  let paused = false
  await page.route('**/api/v1/channels**', async (route) => {
    if (route.request().method() === 'PATCH') {
      paused = route.request().postDataJSON().paused
      await route.fulfill({ json: { channel: { ...channel, paused } } })
    } else await route.fulfill({ json: { items: [{ ...channel, paused }] } })
  })
  await page.getByRole('button', { name: 'Channels', exact: true }).click()
  await expect(page.getByText('completed', { exact: true })).toBeVisible()
  await expect(page.getByText(/Last collected:/)).toContainText('Oct 1, 2026')
  await expect(page.getByText(/Next collection:/)).toContainText('Oct 2, 2026')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
  await expect(page.getByText('Paused', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect(page.getByText('completed', { exact: true })).toBeVisible()
})
test('C36 several dated cards preserve API ordering ties and display thumbnail', async ({
  page,
}) => {
  await mock(page)
  const items = [
    {
      ...video,
      id: 'aaaaaaaaaaa',
      title: 'First tie',
      publishedAt: '2026-10-02T09:00:00Z',
      thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg',
    },
    { ...video, id: 'zzzzzzzzzzz', title: 'Second tie', publishedAt: '2026-10-02T09:00:00Z' },
    video,
  ]
  await page.route('**/api/v1/videos?**', (route) =>
    route.fulfill({ json: { items, total: 3, page: 1, pageSize: 20 } }),
  )
  await page.getByLabel('Search videos').fill('video')
  await expect(page.getByRole('article').locator('h2')).toHaveText([
    'First tie',
    'Second tie',
    'How careful systems recover',
  ])
  await expect(page.getByRole('article').locator('img')).toHaveAttribute(
    'src',
    'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg',
  )
  await expect(page.locator('time')).toHaveText(['Oct 2, 2026', 'Oct 2, 2026', 'Oct 1, 2026'])
})
test('C40 filtered empty library clears filters and restores results', async ({ page }) => {
  await mock(page)
  await page.route('**/api/v1/videos?**', (route) => {
    const empty = new URL(route.request().url()).searchParams.has('q')
    return route.fulfill({
      json: { items: empty ? [] : [video], total: empty ? 0 : 1, page: 1, pageSize: 20 },
    })
  })
  await page.getByLabel('Search videos').fill('no matches')
  await expect(page.getByText('No videos match these filters.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.getByLabel('Search videos')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Read How careful systems recover' })).toBeVisible()
})
test('C42 failed reader and channel refreshes retain content and provide retry', async ({
  page,
}) => {
  await page.clock.install()
  await mock(page)
  await open(page)
  await expect(page.getByText(detail.enrichment.summary, { exact: true })).toBeVisible()
  await page.route(`**/api/v1/videos/${id}`, (route) =>
    route.fulfill({ status: 503, json: { error: { message: 'Reader unavailable' } } }),
  )
  await page.clock.fastForward(5001)
  await expect(page.getByRole('alert')).toContainText('Reader unavailable')
  await expect(page.getByRole('button', { name: 'Retry loading', exact: true })).toBeVisible()
  await expect(page.getByText(detail.enrichment.summary, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Channels', exact: true }).click()
  await expect(page.getByText('Engineering Notes', { exact: true })).toBeVisible()
  await page.route('**/api/v1/channels', (route) =>
    route.fulfill({ status: 503, json: { error: { message: 'Channels unavailable' } } }),
  )
  await page.clock.fastForward(5001)
  await expect(page.getByRole('alert')).toContainText('Channels unavailable')
  await expect(page.getByRole('button', { name: 'Retry loading', exact: true })).toBeVisible()
  await expect(page.getByText('Engineering Notes', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
})
test('C46 keyboard activates channel registration and collection actions', async ({ page }) => {
  await mock(page)
  await page.getByRole('button', { name: 'Channels', exact: true }).focus()
  await page.keyboard.press('Enter')
  const input = page.getByLabel('YouTube channel URL')
  await input.focus()
  await page.keyboard.type('https://youtube.com/@keyboard')
  await page.getByRole('button', { name: 'Add channel', exact: true }).focus()
  const added = page.waitForRequest(
    (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/channels',
  )
  await page.keyboard.press('Enter')
  expect((await added).postDataJSON()).toEqual({ url: 'https://youtube.com/@keyboard' })
  await expect(
    page.getByText('Channel added. The ten most recent videos are queued.', { exact: true }),
  ).toBeVisible()
  const collected = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/sync'))
  await page.getByRole('button', { name: 'Collect now', exact: true }).focus()
  await page.keyboard.press('Enter')
  expect((await collected).method()).toBe('POST')
  await expect(page.getByText('Collection queued.', { exact: true })).toBeVisible()
})
