import { expect, test } from '@playwright/test'

/**
 * Critical-path E2E: UI → Temporal → AIMock (Grok) → JobRoom WebSocket → completed.
 * No real XAI_API_KEY; worker points at CopilotKit AIMock via XAI_BASE_URL.
 */
test.describe('video generation (AIMock)', () => {
  test('happy path: enhance → generate → completed video', async ({
    page,
  }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message)
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(
      page.getByRole('heading', { name: /AI video generation/i }),
    ).toBeVisible()

    const prompt =
      'E2E rocket launching from Mars dunes at golden hour — aimock fixture'
    const promptBox = page.getByRole('textbox', { name: 'Prompt' })
    await promptBox.click()
    await promptBox.fill(prompt)
    await expect(promptBox).toHaveValue(prompt)

    await expect(
      page.getByRole('checkbox', {
        name: 'Enhance prompt with Grok text before video gen',
      }),
    ).toBeChecked()

    const generate = page.getByRole('button', { name: /^Generate video$/i })
    await expect(generate).toBeEnabled()
    await generate.click()

    // Button should enter a busy state quickly
    await expect(
      page.getByRole('button', {
        name: /Starting workflow|Generating/i,
      }),
    ).toBeVisible({ timeout: 10_000 })

    // Workflow id appears once the gateway accepts the start
    const workflowId = page.locator('p.font-mono').filter({ hasText: /^video-/ })
    const errorBanner = page.locator('div').filter({ hasText: /Failed to start|required|Unauthorized|error/i }).first()

    try {
      await expect(workflowId).toBeVisible({ timeout: 45_000 })
    } catch (err) {
      const bodyText = await page.locator('body').innerText()
      throw new Error(
        `workflow id not shown.\nconsole: ${consoleErrors.join(' | ')}\nbody:\n${bodyText.slice(0, 2000)}`,
        { cause: err },
      )
    }

    if (await errorBanner.isVisible().catch(() => false)) {
      throw new Error(`error banner: ${await errorBanner.innerText()}`)
    }

    // JobRoom WS drives phase updates; wait for completed message
    await expect(page.getByText('Video ready!')).toBeVisible({
      timeout: 90_000,
    })

    const video = page.locator('video')
    await expect(video).toBeVisible()
    await expect(video).toHaveAttribute(
      'src',
      'https://example.com/e2e-video.mp4',
    )
  })
})
