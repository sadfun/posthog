/**
 * Verifies team config changes propagate to all config endpoints.
 */
import { expect } from '@playwright/test'

import { test } from '../utils/workspace-test-base'

test('config changes propagate to all endpoints', async ({ request, playwrightSetup, baseURL }) => {
    const workspace = await playwrightSetup.createWorkspace('Config Test')
    const { personal_api_key: apiKey, team_id: teamId, api_token: apiToken } = workspace

    // Enable surveys
    const updateResponse = await request.patch(`${baseURL}/api/projects/${teamId}/`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        data: { surveys_opt_in: true },
    })
    expect(updateResponse.ok()).toBe(true)

    // Verify /flags endpoint (Rust service)
    const flagsResponse = await request.post(`${baseURL}/flags/?v=2&config=true`, {
        data: { token: apiToken, distinct_id: 'test-user' },
    })
    expect(flagsResponse.ok()).toBe(true)
    expect((await flagsResponse.json()).surveys).toBe(true)

    // Verify /array/{token}/config endpoint (Django)
    const remoteConfigResponse = await request.get(`${baseURL}/array/${apiToken}/config`)
    expect(remoteConfigResponse.ok()).toBe(true)
    expect((await remoteConfigResponse.json()).surveys).toBe(true)

    // Verify /array/{token}/config.js endpoint (Django JS)
    const configJsResponse = await request.get(`${baseURL}/array/${apiToken}/config.js`)
    expect(configJsResponse.ok()).toBe(true)
    expect(await configJsResponse.text()).toContain('"surveys":true')
})
