import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SpeedReviewHarness, speedReviewConfig } from './speed-review-harness.js'

/**
 * Round metrics are derived from the session events the supervisor already
 * observes, then bounded and redacted before they reach the reviewer prompt or
 * the local record. No test needs a live Harness.
 */

let cleanup: (() => Promise<void>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

async function create(
  options: Parameters<typeof SpeedReviewHarness.create>[0] = {},
): Promise<SpeedReviewHarness> {
  const created = await SpeedReviewHarness.create(options, speedReviewConfig({ everyRound: true }))
  cleanup = created.cleanup
  return created.harness
}

interface MetricsShape {
  wallMs: number
  toolCalls: number
  errors: number
  workers: Record<string, number>
  slowCalls: Array<{ name: string; durationMs: number; arguments: string; result: string }>
  nonToolMs: number
}

function metricsOf(record: Record<string, unknown>): MetricsShape {
  return record.metrics as MetricsShape
}

describe('round cost metrics', () => {
  it('names the dominant slow call with its duration and bounded summary', async () => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    const t0 = 1_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(goal, 1, t0 + 10)
    const fast = harness.toolCall('read', { file_path: 'src/a.ts' }, t0 + 1_000)
    harness.toolResult(fast, 'ok', t0 + 1_010)
    const slow = harness.toolCall('pwsh', { command: 'pnpm check' }, t0 + 2_000)
    harness.toolResult(slow, 'done', t0 + 122_000)
    harness.turnEnd({ kind: 'completed' }, t0 + 130_000)

    const record = await harness.waitForRecord('goal-1', 1)
    const metrics = metricsOf(record)
    expect(metrics.wallMs).toBe(130_000)
    expect(metrics.toolCalls).toBe(2)
    expect(metrics.errors).toBe(0)
    expect(metrics.nonToolMs).toBe(9_990)
    expect(metrics.slowCalls[0]).toMatchObject({ name: 'pwsh', durationMs: 120_000 })
    expect(metrics.slowCalls[0]?.arguments).toContain('pnpm check')
    const prompt = harness.lastPrompt()
    expect(prompt).toContain('pwsh 120000 ms')
    expect(prompt).toContain('approximate non-tool time: 9990 ms')
  })

  it('counts worker starts by tool name and failed tool results', async () => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    const t0 = 2_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(goal, 1, t0 + 10)
    for (const [name, args] of [
      ['subagent', { prompt: 'lane one' }],
      ['subagent_fork', { prompt: 'lane two' }],
      ['workflow', { name: 'lanes' }],
      ['read', { file_path: 'src/a.ts' }],
      ['read', { file_path: 'src/b.ts' }],
    ] as const) {
      const call = harness.toolCall(name, args, t0 + 1_000)
      harness.toolResult(call, 'done', t0 + 2_000, name === 'read')
    }
    // A started delegate counts; a cached-record reuse did not start a worker.
    const started = harness.toolCall('delegate', { rule: 'task-review' }, t0 + 1_000)
    harness.toolResult(started, 'rule "task-review" review started', t0 + 2_000)
    const cached = harness.toolCall('delegate', { rule: 'task-review' }, t0 + 1_000)
    harness.toolResult(
      cached,
      'rule "task-review" PASS (reused record at .dsh/delegation/task-review/x.json)',
      t0 + 2_000,
    )
    harness.turnEnd({ kind: 'completed' }, t0 + 60_000)

    const record = await harness.waitForRecord('goal-1', 1)
    const metrics = metricsOf(record)
    expect(metrics.toolCalls).toBe(7)
    expect(metrics.errors).toBe(2)
    expect(metrics.workers).toEqual({ subagent: 1, subagent_fork: 1, workflow: 1, delegate: 1 })
    expect(metrics.nonToolMs).toBe(53_000)
    const prompt = harness.lastPrompt()
    expect(prompt).toContain('worker starts: subagent=1, subagent_fork=1, workflow=1, delegate=1')
    expect(prompt).toContain('tool errors: 2')
  })

  it('does not review a round whose start was not observed', async () => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    // The plugin mounted after the turn opened: no turn/start was observed.
    harness.goalMessage(goal, 1)
    const call = harness.toolCall('pwsh', { command: 'pnpm check' })
    harness.toolResult(call, 'done')
    harness.turnEnd({ kind: 'completed' })
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
    expect(harness.startCalls).toHaveLength(0)
    expect(await harness.tryReadRecord('goal-1', 1)).toBeUndefined()
  })

  it('redacts credentials and bounds the emitted summary', async () => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    const secret = ['sk', 'live', '0123456789abcdef'].join('-')
    const nested = JSON.stringify({ password: 'SYNTHETIC_SECRET_123' })
    const t0 = 3_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(goal, 1, t0 + 10)
    const call = harness.toolCall(
      'read',
      {
        token: "don't-SYNTHETIC_SECRET",
        note: secret,
        password: 'example-password-123',
        api_key: 'example-api-value-123',
        command: `echo '${nested}' password="first SYNTHETIC_SECRET"`,
      },
      t0 + 1_000,
    )
    harness.toolResult(
      call,
      `${secret} password="first SYNTHETIC_SECRET" ${'x'.repeat(2_000)}`,
      t0 + 90_000,
    )
    harness.turnEnd({ kind: 'completed' }, t0 + 91_000)

    const record = await harness.waitForRecord('goal-1', 1)
    const metrics = metricsOf(record)
    const slow = metrics.slowCalls[0]
    if (slow === undefined) throw new Error('slow call missing')
    expect(slow.arguments.length).toBeLessThanOrEqual(160)
    expect(slow.result.length).toBeLessThanOrEqual(160)
    expect(slow.arguments).toContain('[redacted]')
    const prompt = harness.lastPrompt()
    expect(prompt.length).toBeLessThanOrEqual(12_000)
    for (const text of [JSON.stringify(record), prompt]) {
      expect(text).not.toContain(secret)
      expect(text).not.toContain('example-password-123')
      expect(text).not.toContain('example-api-value-123')
      expect(text).not.toContain('SYNTHETIC_SECRET_123')
      expect(text).not.toContain("don't-SYNTHETIC_SECRET")
      expect(text).not.toContain('first SYNTHETIC_SECRET')
    }
  })

  const leakedPath = join(process.cwd(), 'secret-dir', 'credentials.txt')
  // The drive letter is built at runtime so this reviewed file carries no
  // literal machine path for the repository scan.
  const spacedDrivePath = ['C:', 'Users', 'Jane Doe', 'credentials.txt'].join('\\')
  const pathCases: Array<[string, Record<string, string>, string]> = [
    ['windows drive path', { file_path: leakedPath }, 'secret-dir'],
    ['enumerated POSIX path', { file_path: '/tmp/private-dir/credentials.txt' }, 'private-dir'],
    ['external POSIX path', { file_path: '/data/private-repo/config.json' }, 'private-repo'],
    [
      'quoted POSIX path with spaces',
      { file_path: '/data/private dir/account/credentials.txt' },
      'private dir',
    ],
    ['windows path with spaces', { file_path: spacedDrivePath }, 'Jane Doe'],
    [
      'backslash UNC path',
      { file_path: '\\\\backslash-server\\share\\credentials.txt' },
      'backslash-server',
    ],
    ['slash UNC path', { file_path: '//server/share/credentials.txt' }, 'server/share'],
    ['quoted Unicode UNC path', { file_path: '//fileserver/数据/credentials.txt' }, 'fileserver'],
    [
      'quoted UNC path containing an apostrophe',
      { file_path: "//fileserver/Team's PRIVATE_ACCOUNT/credentials.txt" },
      'PRIVATE_ACCOUNT',
    ],
    [
      'quoted backslash UNC path with spaces and an apostrophe',
      { file_path: "\\\\backslash-server\\Private Team's share\\credentials.txt" },
      "Private Team's share",
    ],
  ]

  it.each(pathCases)('redacts a %s from the emitted summary', async (_label, args, marker) => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    const t0 = 3_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(goal, 1, t0 + 10)
    const call = harness.toolCall('read', args, t0 + 1_000)
    harness.toolResult(call, 'ok', t0 + 90_000)
    harness.turnEnd({ kind: 'completed' }, t0 + 91_000)

    const record = await harness.waitForRecord('goal-1', 1)
    const slow = metricsOf(record).slowCalls[0]
    if (slow === undefined) throw new Error('slow call missing')
    // The fixture is short enough that an unredacted value would be emitted.
    expect(JSON.stringify(args)).toContain(marker)
    expect(slow.arguments.length).toBeLessThanOrEqual(160)
    expect(slow.arguments).toContain('[path]')
    expect(slow.arguments).not.toContain(marker)
    const prompt = harness.lastPrompt()
    for (const text of [JSON.stringify(record), prompt]) {
      expect(text).not.toContain(marker)
    }
  })

  it('keeps a URL in the emitted summary', async () => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    const t0 = 3_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(goal, 1, t0 + 10)
    const call = harness.toolCall('read', { url: 'https://example.com/a/b/c' }, t0 + 1_000)
    harness.toolResult(call, 'ok', t0 + 90_000)
    harness.turnEnd({ kind: 'completed' }, t0 + 91_000)

    const record = await harness.waitForRecord('goal-1', 1)
    const slow = metricsOf(record).slowCalls[0]
    if (slow === undefined) throw new Error('slow call missing')
    expect(slow.arguments).toContain('https://example.com/a/b/c')
    expect(harness.lastPrompt()).toContain('https://example.com/a/b/c')
  })

  it('redacts a quoted backslash UNC path in results and command strings', async () => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    const t0 = 3_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(goal, 1, t0 + 10)
    const call = harness.toolCall(
      'pwsh',
      {
        command:
          'Get-Content "\\\\backslash-server\\Share Dir\\credentials.txt"; Get-Content \'\\\\backslash-server\\Private Account\\credentials.txt\'',
      },
      t0 + 1_000,
    )
    harness.toolResult(
      call,
      'Could not open "\\\\backslash-server\\Team\'s share\\credentials.txt"',
      t0 + 90_000,
    )
    harness.turnEnd({ kind: 'completed' }, t0 + 91_000)

    const record = await harness.waitForRecord('goal-1', 1)
    const slow = metricsOf(record).slowCalls[0]
    if (slow === undefined) throw new Error('slow call missing')
    for (const text of [JSON.stringify(record), harness.lastPrompt()]) {
      expect(text).not.toContain('Share Dir')
      expect(text).not.toContain('Private Account')
      expect(text).not.toContain("Team's share")
    }
  })

  it('redacts unquoted non-ASCII paths in results', async () => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    const t0 = 3_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(goal, 1, t0 + 10)
    const call = harness.toolCall('read', { file_path: 'src/a.ts' }, t0 + 1_000)
    harness.toolResult(
      call,
      'Could not open /data/данные/credentials.txt and //fileserver/данные/credentials.txt',
      t0 + 90_000,
    )
    harness.turnEnd({ kind: 'completed' }, t0 + 91_000)

    const record = await harness.waitForRecord('goal-1', 1)
    for (const text of [JSON.stringify(record), harness.lastPrompt()]) {
      expect(text).not.toContain('данные')
    }
  })

  it('redacts unquoted paths with spaces and apostrophes in separate short results', async () => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    const t0 = 3_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(goal, 1, t0 + 10)
    const cases = [
      'Could not open /data/private dir/account/credentials.txt',
      "Could not open //fileserver/Team's PRIVATE_ACCOUNT/credentials.txt",
      `Could not open ${spacedDrivePath}`,
      `Could not open /data/${'a'.repeat(240)}/LONG_SUFFIX/credentials.txt`,
      'ENOENT:/data/COLON_CODE/credentials.txt',
    ]
    for (const [index, text] of cases.entries()) {
      const call = harness.toolCall('read', { file_path: `src/${index}.ts` }, t0 + 1_000)
      harness.toolResult(call, text, t0 + 90_000)
    }
    harness.turnEnd({ kind: 'completed' }, t0 + 91_000)

    const record = await harness.waitForRecord('goal-1', 1)
    for (const text of [JSON.stringify(record), harness.lastPrompt()]) {
      expect(text).not.toContain('private dir')
      expect(text).not.toContain('PRIVATE_ACCOUNT')
      expect(text).not.toContain('Jane Doe')
      expect(text).not.toContain('LONG_SUFFIX')
      expect(text).not.toContain('COLON_CODE')
    }
  })

  it('redacts URL credentials while keeping the host', async () => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    const t0 = 3_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(goal, 1, t0 + 10)
    const call = harness.toolCall('read', { file_path: 'src/a.ts' }, t0 + 1_000)
    harness.toolResult(call, "visit https://svc-user:Qw7n'4L2p9R6v@example.test/api", t0 + 90_000)
    harness.turnEnd({ kind: 'completed' }, t0 + 91_000)

    const record = await harness.waitForRecord('goal-1', 1)
    const windowsOf = (secret: string): string[] =>
      Array.from({ length: secret.length - 5 }, (_unused, index) => secret.slice(index, index + 6))
    for (const text of [JSON.stringify(record), harness.lastPrompt()]) {
      // The unquoted result has no JSON quoting, so only the URL rule can strip
      // the userinfo; the host proves the URL itself was not swallowed.
      expect(text).toContain('example.test/api')
      for (const window of windowsOf("Qw7n'4L2p9R6v")) expect(text).not.toContain(window)
    }
  })

  it('redacts a credential value that also contains a path', async () => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    const t0 = 3_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(goal, 1, t0 + 10)
    const call = harness.toolCall(
      'read',
      {
        password: 'SYNTHETIC_PATH_SECRET /data/file',
        access_token: 'SYNTHETIC_OAUTH_SECRET',
        client_secret: 'SYNTHETIC_CLIENT_SECRET',
        command: `echo ${JSON.stringify({ AWS_SECRET_ACCESS_KEY: 'SYNTHETIC_AWS_SECRET' })}`,
        spaced: 'echo {"AWS_SECRET_ACCESS_KEY": "SYNTHETIC_SPACED_SECRET"}',
        doubleNested: 'echo "{\\"AWS_SECRET_ACCESS_KEY\\": \\"SYNTHETIC_DOUBLE_SECRET\\"}"',
        longValue: `AWS_SESSION_TOKEN=${'A'.repeat(130)}SYNTHETIC_LONG_SECRET_SUFFIX`,
        authorization: 'Authorization: Basic U1lOVEhFVElDOlNFQ1JFVA==',
        azure: 'AZURE_OPENAI_API_KEY=SYNTHETIC_CREDENTIAL_987',
        urlCredential: 'https://svc-user:Qw7n4L2p9R6v@example.test/api',
      },
      t0 + 1_000,
    )
    harness.toolResult(
      call,
      '{"password":"SYNTHETIC_PATH_SECRET /data/file","access_token":"SYNTHETIC_OAUTH_SECRET","X-Api-Key":"SYNTHETIC_HEADER_SECRET","Authorization":"Basic U1lOVEhFVElDOlNFQ1JFVA==","AZURE_OPENAI_API_KEY":"SYNTHETIC_CREDENTIAL_987","url":"https://svc-user:Qw7n4L2p9R6v@example.test/api"}',
      t0 + 90_000,
    )
    harness.turnEnd({ kind: 'completed' }, t0 + 91_000)

    const record = await harness.waitForRecord('goal-1', 1)
    // A truncated credential leaks only its tail, so assert that no six-character
    // window of any synthetic secret survives, not only the complete markers.
    const windowsOf = (secret: string): string[] =>
      Array.from({ length: secret.length - 5 }, (_unused, index) => secret.slice(index, index + 6))
    const windows = [
      ...windowsOf('SYNTHETIC_PATH_SECRET'),
      ...windowsOf('SYNTHETIC_OAUTH_SECRET'),
      ...windowsOf('SYNTHETIC_CLIENT_SECRET'),
      ...windowsOf('SYNTHETIC_HEADER_SECRET'),
      ...windowsOf('SYNTHETIC_AWS_SECRET'),
      ...windowsOf('SYNTHETIC_SPACED_SECRET'),
      ...windowsOf('SYNTHETIC_DOUBLE_SECRET'),
      ...windowsOf('SYNTHETIC_LONG_SECRET_SUFFIX'),
      ...windowsOf('SYNTHETIC_CREDENTIAL_987'),
      ...windowsOf('U1lOVEhFVElDOlNFQ1JFVA'),
      ...windowsOf('Qw7n4L2p9R6v'),
    ]
    for (const text of [JSON.stringify(record), harness.lastPrompt()]) {
      expect(text).not.toContain('SYNTHETIC_PATH_SECRET')
      expect(text).not.toContain('SYNTHETIC_OAUTH_SECRET')
      expect(text).not.toContain('SYNTHETIC_CLIENT_SECRET')
      expect(text).not.toContain('SYNTHETIC_HEADER_SECRET')
      expect(text).not.toContain('SYNTHETIC_AWS_SECRET')
      expect(text).not.toContain('SYNTHETIC_SPACED_SECRET')
      expect(text).not.toContain('SYNTHETIC_DOUBLE_SECRET')
      expect(text).not.toContain('SYNTHETIC_LONG_SECRET_SUFFIX')
      expect(text).not.toContain('SYNTHETIC_CREDENTIAL_987')
      expect(text).not.toContain('U1lOVEhFVElDOlNFQ1JFVA')
      for (const window of windows) expect(text).not.toContain(window)
    }
  })

  it('redacts credentials and private keys before truncating long summaries', async () => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    const secret = `SYNTHETIC_SECRET_VALUE_${'A'.repeat(400)}`
    const begin = ['-----BEGIN', 'RSA', 'PRIVATE KEY-----'].join(' ')
    const end = ['-----END', 'RSA', 'PRIVATE KEY-----'].join(' ')
    const pem = `${begin}\n${'MIIBFAKE'.repeat(60)}\n${end}`
    const t0 = 5_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(goal, 1, t0 + 1)
    const call = harness.toolCall('read', { token: secret, file_path: 'src/a.ts' }, t0 + 10)
    harness.toolResult(call, pem, t0 + 90_000)
    harness.turnEnd({ kind: 'completed' }, t0 + 91_000)

    const record = await harness.waitForRecord('goal-1', 1)
    const metrics = metricsOf(record)
    const slow = metrics.slowCalls[0]
    if (slow === undefined) throw new Error('slow call missing')
    const prompt = harness.lastPrompt()
    for (const text of [JSON.stringify(record), prompt]) {
      expect(text).not.toContain('SYNTHETIC_SECRET_VALUE')
      expect(text).not.toContain('MIIBFAKE')
      expect(text).not.toContain(begin)
    }
    expect(slow.arguments).toContain('[redacted]')
    expect(slow.result).toContain('[redacted private key]')
  })

  it('times a dominant call that arrives after many fast calls', async () => {
    const harness = await create()
    const goal = harness.goal
    if (goal === undefined) throw new Error('test goal missing')
    const t0 = 4_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(goal, 1, t0 + 1)
    for (let index = 0; index < 205; index += 1) {
      const at = t0 + 1_000 + index * 2
      const call = harness.toolCall('read', { file_path: `src/${index}.ts` }, at)
      harness.toolResult(call, 'ok', at + 1)
    }
    const slow = harness.toolCall('pwsh', { command: 'pnpm check' }, t0 + 2_000)
    harness.toolResult(slow, 'done', t0 + 7_000)
    harness.turnEnd({ kind: 'completed' }, t0 + 8_000)

    const record = await harness.waitForRecord('goal-1', 1)
    const metrics = metricsOf(record)
    expect(metrics.toolCalls).toBe(206)
    expect(metrics.slowCalls[0]).toMatchObject({ name: 'pwsh', durationMs: 5_000 })
    expect(metrics.nonToolMs).toBe(8_000 - 5_205)
  })
})
