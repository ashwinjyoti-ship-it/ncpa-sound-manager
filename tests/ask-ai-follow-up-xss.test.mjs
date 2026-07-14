import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'

const appSource = await readFile(new URL('../public/static/app.js', import.meta.url), 'utf8')

let browser

before(async () => {
  browser = await chromium.launch({ headless: true })
})

after(async () => {
  await browser?.close()
})

test('Ask AI follow-up suggestions stay inert and preserve their exact query', async () => {
  const page = await browser.newPage()
  const suggestion = 'Crew coverage" onmouseover="window.__xss = 1" data-tail="'

  await page.setContent(`
    <input id="aiQueryInput">
    <div id="aiResponse"></div>
    <div id="aiLoading"></div>
    <div id="aiExplanation"></div>
    <div id="aiResultsContainer"></div>
  `)
  await page.evaluate(() => {
    window.__xss = 0
    window.__queries = []
    window.axios = {
      post: async (_url, body) => {
        window.__queries.push(body.query)
        return {
          data: {
            success: true,
            answer: 'Coverage analysis',
            events: [],
            insights: {},
            recommendations: [],
            follow_up_queries: window.__queries.length === 1 ? [window.__suggestion] : [],
            metadata: { query_intent: 'analytics' },
          },
        }
      },
    }
  })
  await page.evaluate((value) => {
    window.__suggestion = value
  }, suggestion)
  await page.addScriptTag({ content: appSource })

  await page.evaluate(() => askAI('Initial query'))

  const button = page.locator('#aiResultsContainer button')
  assert.equal(await button.textContent(), suggestion)
  await button.dispatchEvent('mouseover')
  assert.equal(await page.evaluate(() => window.__xss), 0)

  await button.click()
  assert.deepEqual(
    await page.evaluate(() => window.__queries),
    ['Initial query', suggestion],
  )

  await page.close()
})
