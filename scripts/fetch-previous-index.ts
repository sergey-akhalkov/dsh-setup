import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { githubPagesIndexUrl } from './lib/market.ts'
import { readDshVersions, rootDir } from './lib/workspace.ts'

/**
 * Download the index the next release replaces.
 *
 * The market index is generated from one tagged commit, so the previously
 * deployed document is the only record of older versions; the release workflow
 * fetches it here and passes it to `generate-market.ts --previous`. A 404 is the
 * expected first release. Any other status, including a redirect, fails: the
 * market format requires a direct 200 response, and publishing on top of an
 * unknown document could silently delist pinned versions.
 */

const output = resolve(rootDir, process.argv[2] ?? '.tmp/previous-index.json')
const url = process.env.MARKET_INDEX_URL ?? githubPagesIndexUrl(readDshVersions().repository)

try {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) {
    rmSync(output, { force: true })
    console.log(`fetch-previous-index: no published index yet at ${url}`)
  } else if (response.status !== 200) {
    throw new Error(
      `${url} answered HTTP ${response.status}${response.headers.get('location') === null ? '' : ` (redirect to ${String(response.headers.get('location'))})`}; the market requires a direct 200`,
    )
  } else {
    const body = await response.text()
    JSON.parse(body)
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, body)
    console.log(`fetch-previous-index: ${body.length} bytes from ${url} -> ${output}`)
  }
} catch (error) {
  console.error(`fetch-previous-index: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
