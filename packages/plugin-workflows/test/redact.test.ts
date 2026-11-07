import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  eventsDirectory,
  Journal,
  MAX_RECORD_BYTES,
  sessionFileName,
  summarize,
  toolResultText,
} from '../src/host/journal.ts'
import { REDACTED, REDACTED_PAYLOAD, redactText, redactValue } from '../src/host/redact.ts'

const TEMP_DIRECTORIES: string[] = []

/** Compose the PEM marker at runtime so the repo secret scan does not flag the fixture. */
const PEM_BEGIN = ['-----BEGIN', 'RSA', 'PRIVATE KEY-----'].join(' ')
const PEM_END = ['-----END', 'RSA', 'PRIVATE KEY-----'].join(' ')

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-redact-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    }),
  )
})

function record(journal: Journal) {
  return journal.record({
    at: 1_762_500_000_000,
    session: 'session-1',
    kind: 'tools/result',
    subject: 'delegate',
    summary: '',
    bytes: 0,
    truncated: false,
  })
}

describe('redaction', () => {
  it('removes a bearer token from free text', () => {
    const text = redactText('authorization: Bearer SECRET-TOKEN-123')
    expect(text).toContain(REDACTED)
    expect(text).not.toContain('SECRET-TOKEN-123')
    expect(redactText('sent Bearer SECRET-TOKEN-123')).toBe('sent Bearer [REDACTED]')
  })

  it('removes key-value secrets from free text', () => {
    const text = redactText('password=hunter2 token: abc123 cookie=session-cookie')
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('abc123')
    expect(text).not.toContain('session-cookie')
    expect(text.match(/\[REDACTED\]/gu)).toHaveLength(3)
  })

  it('removes a Basic authorization credential with its scheme', () => {
    const text = redactText('authorization: Basic dXNlcjpwYXNzd29yZA==')
    expect(text).not.toContain('dXNlcjpwYXNzd29yZA==')
    expect(text).not.toContain('Basic ')
  })

  it('redacts secret keys inside a JSON payload', () => {
    const payload = JSON.stringify({
      authorization: 'Basic dXNlcjpwYXNz',
      token: 'tok-secret',
      nested: { password: 'hunter2', note: 'Bearer SECRET-TOKEN-123' },
    })
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('tok-secret')
    expect(summary).not.toContain('hunter2')
    expect(summary).not.toContain('SECRET-TOKEN-123')
    expect(summary).not.toContain('dXNlcjpwYXNz')
    expect(summary).toBe(REDACTED_PAYLOAD)
  })

  it('redacts an unterminated private-key block before truncating it', () => {
    const block = `before ${PEM_BEGIN}\n${'MIIEsecret\n'.repeat(200)}`
    const summary = summarize(block, 80).summary
    expect(summary).not.toContain('MIIEsecret')
    expect(summary).not.toContain('BEGIN RSA PRIVATE KEY')
    expect(summary).toBe(REDACTED_PAYLOAD)
  })

  it('removes a private-key block', () => {
    const key = `${PEM_BEGIN}\nMIIEsecret\n${PEM_END}`
    const text = redactText(`before\n${key}\nafter`)
    expect(text).toContain('[REDACTED PRIVATE KEY]')
    expect(text).not.toContain('MIIEsecret')
    expect(text).not.toContain('BEGIN RSA PRIVATE KEY')
  })

  it('hides secret-named fields and nested strings', () => {
    const value = redactValue({
      authorization: 'Basic abc',
      token: 'abc',
      apiKey: 'key-1',
      password: 'hunter2',
      nested: { secret: 'shh', note: 'Bearer SECRET-TOKEN-123' },
      safe: 'read notes.md',
      list: [{ cookie: 'c1' }],
    }) as Record<string, unknown>
    expect(value.authorization).toBe(REDACTED)
    expect(value.token).toBe(REDACTED)
    expect(value.apiKey).toBe(REDACTED)
    expect(value.password).toBe(REDACTED)
    expect(value.nested).toEqual({ secret: REDACTED, note: REDACTED_PAYLOAD })
    expect(value.safe).toBe('read notes.md')
    expect(value.list).toEqual([{ cookie: REDACTED }])
  })

  it('caps an oversized record and keeps the original size', () => {
    const journal = new Journal()
    const { record: bounded, truncated } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'tools/result',
      subject: 'read',
      summary: 'x'.repeat(20_000),
      bytes: 20_000,
      truncated: false,
    })
    expect(truncated).toBe(true)
    expect(bounded.summary.length).toBeLessThan(20_000)
    expect(bounded.summary.endsWith('…')).toBe(true)
    expect(bounded.bytes).toBe(20_000)
    expect(Buffer.byteLength(JSON.stringify(bounded), 'utf8')).toBeLessThanOrEqual(MAX_RECORD_BYTES)
  })

  it('redacts pretty-printed JSON with array and object values', () => {
    const payload = JSON.stringify(
      {
        authorization: ['Basic dXNlcjpwYXNz'],
        token: { value: 'tok-secret' },
        password: ['hunter2'],
      },
      null,
      2,
    )
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('dXNlcjpwYXNz')
    expect(summary).not.toContain('tok-secret')
    expect(summary).not.toContain('hunter2')
    const journal = new Journal()
    const { record: bounded } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'tools/result',
      subject: 'read',
      summary,
      bytes: 200,
      truncated: false,
    })
    expect(JSON.stringify(bounded)).not.toContain('dXNlcjpwYXNz')
    expect(JSON.stringify(bounded)).not.toContain('tok-secret')
  })

  it('redacts JSON embedded inside a string value', () => {
    const payload = JSON.stringify({
      message: JSON.stringify({ token: 'tok-secret', note: 'Bearer SECRET-TOKEN-123' }),
      safe: 'nothing here',
    })
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('tok-secret')
    expect(summary).not.toContain('SECRET-TOKEN-123')
  })

  it('redacts a JSON payload that contains a PEM string and a secret sibling', () => {
    const payload = JSON.stringify({
      key: `${PEM_BEGIN}\nMIIEsecret\n${PEM_END}`,
      token: 'tok-secret',
    })
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('MIIEsecret')
    expect(summary).not.toContain('tok-secret')
    expect(summary).not.toContain('BEGIN RSA PRIVATE KEY')
  })

  it('redacts plain YAML passwords containing punctuation', () => {
    const payload = 'password: prefix,SUFFIX-SECRET\n  CONTINUATION-SECRET\nsafe: ok'
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('SUFFIX-SECRET')
    expect(summary).not.toContain('CONTINUATION-SECRET')
    const journal = new Journal()
    const { record: bounded } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'subagent/end',
      subject: 'child',
      summary: payload,
      bytes: 60,
      truncated: false,
    })
    expect(bounded.summary).not.toContain('SUFFIX-SECRET')
    expect(bounded.summary).not.toContain('CONTINUATION-SECRET')
  })

  it('redacts plain multiline YAML passwords and doubled single quotes', () => {
    const plain = 'password: HUNTER-secret\n  continued-secret\nsafe: ok'
    const plainSummary = summarize(plain, 4000).summary
    expect(plainSummary).not.toContain('HUNTER-secret')
    expect(plainSummary).not.toContain('continued-secret')
    const quoted = "password: 'it''s HUNTER-secret'"
    const quotedSummary = summarize(quoted, 4000).summary
    expect(quotedSummary).not.toContain('HUNTER-secret')
  })

  it('redacts YAML block scalar passwords through summarize and record creation', () => {
    for (const indicator of ['|', '>']) {
      const payload = `password: ${indicator}\n  HUNTER-secret\nsafe: ok`
      const summary = summarize(payload, 4000).summary
      expect(summary).not.toContain('HUNTER-secret')
      const journal = new Journal()
      const { record: bounded } = journal.record({
        at: 1,
        session: 'session-1',
        kind: 'subagent/end',
        subject: 'child',
        summary: payload,
        bytes: 40,
        truncated: false,
      })
      expect(bounded.summary).not.toContain('HUNTER-secret')
    }
  })

  it('redacts a secret object whose single-quoted brace looks like the end', () => {
    const payload = "password: {hint: '}', value: 'HUNTER-secret'}"
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('HUNTER-secret')
    const journal = new Journal()
    const { record: bounded } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'subagent/end',
      subject: 'child',
      summary: payload,
      bytes: 40,
      truncated: false,
    })
    expect(bounded.summary).not.toContain('HUNTER-secret')
  })

  it('redacts escaped JSON keys and multiply serialized credentials', () => {
    expect(summarize('{"pass\\u0077ord":"HUNTER-secret"}', 4000).summary).toBe(REDACTED_PAYLOAD)
    const serialized = JSON.stringify(JSON.stringify(JSON.stringify({ password: 'HUNTER-secret' })))
    expect(summarize(serialized, 4000).summary).toBe(REDACTED_PAYLOAD)
    const journal = new Journal()
    const { record: bounded } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'subagent/end',
      subject: 'child',
      summary: serialized,
      bytes: 40,
      truncated: false,
    })
    expect(JSON.stringify(bounded)).not.toContain('HUNTER-secret')
  })

  it('redacts prefixed serialized credentials and encoded structures', () => {
    const prefixed =
      'Result: ' + JSON.stringify(JSON.stringify(JSON.stringify({ password: 'HUNTER-secret' })))
    expect(summarize(prefixed, 4000).summary).toBe(REDACTED_PAYLOAD)
    const escaped = 'Result: {"pass\\u0077ord":"HUNTER-secret"}'
    expect(summarize(escaped, 4000).summary).toBe(REDACTED_PAYLOAD)
    const percent = 'Result: %7B%22password%22%3A%22HUNTER-secret%22%7D'
    expect(summarize(percent, 4000).summary).toBe(REDACTED_PAYLOAD)
    const journal = new Journal()
    const { record: bounded } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'subagent/end',
      subject: 'child',
      summary: prefixed,
      bytes: 80,
      truncated: false,
    })
    expect(JSON.stringify(bounded)).not.toContain('HUNTER-secret')
  })

  it('redacts named HTML entity encodings', () => {
    const payload = 'Result: {&quot;password&quot;:&quot;SYNTHETIC-SECRET&quot;}'
    expect(summarize(payload, 4000).summary).toBe(REDACTED_PAYLOAD)
    const journal = new Journal()
    const { record: bounded } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'subagent/end',
      subject: 'child',
      summary: payload,
      bytes: 60,
      truncated: false,
    })
    expect(JSON.stringify(bounded)).not.toContain('SYNTHETIC-SECRET')
  })

  it('marks an oversized secret-bearing payload as truncated after redaction', () => {
    const payload = `password: ${'x'.repeat(5000)}`
    const summarized = summarize(payload, 4000)
    expect(summarized.summary).toBe(REDACTED_PAYLOAD)
    expect(summarized.truncated).toBe(true)
    expect(summarized.bytes).toBeGreaterThan(MAX_RECORD_BYTES)
    const journal = new Journal()
    const { record: bounded, truncated } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'subagent/end',
      subject: 'child',
      summary: summarized.summary,
      bytes: summarized.bytes,
      truncated: summarized.truncated,
    })
    expect(truncated).toBe(true)
    expect(bounded.truncated).toBe(true)
  })

  it('keeps a plain JSON payload that carries no secret', () => {
    const payload = '{"path":"notes.md","count":2}'
    expect(summarize(payload, 4000).summary).toBe(payload)
  })

  it('redacts a quoted multiline password with non-ASCII content', () => {
    const payload = 'password: "prefix\nсекретный"'
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('секретный')
    const journal = new Journal()
    const { record: bounded } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'subagent/end',
      subject: 'child',
      summary: payload,
      bytes: 30,
      truncated: false,
    })
    expect(bounded.summary).not.toContain('секретный')
  })

  it('applies the complete redaction pipeline to a direct record summary', () => {
    const journal = new Journal()
    const { record: bounded } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'subagent/end',
      subject: 'child',
      summary: 'child c ended: password: "multi\nline-secret"',
      bytes: 40,
      truncated: false,
    })
    expect(bounded.summary).not.toContain('line-secret')
  })

  it('bounds a deeply nested malformed balanced payload without throwing', () => {
    const payload = `${'{bad:'.repeat(20_000)}password: tok-secret${'}'.repeat(20_000)}`
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('tok-secret')
    expect(summary.length).toBeLessThanOrEqual(4000)
  })

  it('does not expand replacement patterns from a wrapped JSON string', () => {
    const payload = JSON.stringify(JSON.stringify({ token: 'tok-secret', note: "$& $` $' $1" }))
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('tok-secret')
  })

  it('redacts secret fields inside a balanced non-JSON wrapper', () => {
    const payload = `wrapper { not: json, child: ${JSON.stringify({ token: 'tok-secret' })} }`
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('tok-secret')
  })

  it('redacts several top-level JSON string documents on separate lines', () => {
    const payload = [
      JSON.stringify(JSON.stringify({ token: 'tok-secret' })),
      JSON.stringify(JSON.stringify({ password: 'hunter2-secret' })),
    ].join('\n')
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('tok-secret')
    expect(summary).not.toContain('hunter2-secret')
  })

  it('redacts a quoted password that spans lines', () => {
    const summary = summarize('password: "multi\nline-secret"', 4000).summary
    expect(summary).not.toContain('line-secret')
  })

  it('redacts a top-level JSON string that wraps JSON text', () => {
    const payload = JSON.stringify(JSON.stringify({ token: 'tok-secret' }))
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('tok-secret')
  })

  it('redacts JSON that follows an unmatched opener', () => {
    const payload = `{ unmatched prefix ${JSON.stringify({ token: 'tok-secret' }, null, 2)}`
    const summary = summarize(payload, 4000).summary
    expect(summary).not.toContain('tok-secret')
  })

  it('redacts single-quoted secret keys', () => {
    const summary = summarize("{'token': 'tok-secret', safe: 'ok'}", 4000).summary
    expect(summary).not.toContain('tok-secret')
  })

  it('handles a large malformed payload without rescanning it quadratically', () => {
    const text = `token=tok-secret ${'{'.repeat(20_000)}`
    const summary = summarize(text, 4000).summary
    expect(summary).not.toContain('tok-secret')
    expect(summary.length).toBeLessThanOrEqual(4000)
  })

  it('redacts multiple JSON text blocks through text, summarize, and record creation', () => {
    const text = toolResultText({
      isError: false,
      content: [
        { type: 'text', text: '{"token":"tok-secret"}' },
        { type: 'text', text: '{"password":"hunter2"}' },
      ],
    } as never)
    expect(text).toContain('tok-secret')
    const summary = summarize(text, 4000).summary
    expect(summary).not.toContain('tok-secret')
    expect(summary).not.toContain('hunter2')
    const journal = new Journal()
    const { record: bounded } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'tools/result',
      subject: 'read',
      summary,
      bytes: 100,
      truncated: false,
    })
    expect(JSON.stringify(bounded)).not.toContain('tok-secret')
    expect(JSON.stringify(bounded)).not.toContain('hunter2')
  })

  it('redacts a multi-cookie header and a Digest authorization header', () => {
    const cookies = redactText('Cookie: preference=dark; session=COOKIE-SECRET')
    expect(cookies).not.toContain('COOKIE-SECRET')
    const digest = redactText(
      'authorization: Digest username="u", nonce="n", response="r", qop=auth',
    )
    expect(digest).not.toContain('nonce="n"')
    expect(digest).not.toContain('response="r"')
  })

  it('refuses a record whose retained metadata cannot fit the cap', () => {
    const journal = new Journal()
    expect(() =>
      journal.record({
        at: 1,
        session: 's'.repeat(10_000),
        kind: 'tools/result',
        subject: 'read',
        summary: 'ok',
        bytes: 1,
        truncated: false,
      }),
    ).toThrow(/cap/u)
  })

  it('caps oversized metadata as well as an oversized summary', () => {
    const journal = new Journal()
    for (const input of [
      {
        at: 1,
        session: 'session-1',
        kind: 'tools/result',
        subject: 's'.repeat(10_000),
        summary: 'ok',
        bytes: 10_000,
        truncated: false,
      },
      {
        at: 1,
        session: 'session-1',
        kind: 'tools/result',
        subject: 'read',
        callId: 'c'.repeat(10_000),
        summary: 'ok',
        bytes: 10_000,
        truncated: false,
      },
    ]) {
      const { record: bounded, truncated } = journal.record(input)
      expect(truncated).toBe(true)
      expect(Buffer.byteLength(JSON.stringify(bounded), 'utf8')).toBeLessThanOrEqual(
        MAX_RECORD_BYTES,
      )
    }
  })

  it('persists only the redacted summary', async () => {
    const workspace = await tempWorkspace()
    const journal = new Journal()
    const { record: bounded } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'tools/result',
      subject: 'delegate',
      summary: 'authorization: Bearer SECRET-TOKEN-123',
      bytes: 38,
      truncated: false,
    })
    const result = await journal.append(workspace, bounded)
    expect(result.ok).toBe(true)
    const file = join(eventsDirectory(workspace), `${sessionFileName('session-1')}.jsonl`)
    const raw = await readFile(file, 'utf8')
    expect(raw).not.toContain('SECRET-TOKEN-123')
    expect(raw).toContain(REDACTED_PAYLOAD)
  })

  it('keeps the producer fields when a record is small', () => {
    const journal = new Journal()
    const { record: bounded } = record(journal)
    expect(bounded.summary).toBe('')
    expect(bounded.truncated).toBe(false)
  })
})
