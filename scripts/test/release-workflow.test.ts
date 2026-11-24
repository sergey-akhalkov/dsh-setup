import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface Step {
  uses?: string
  with?: Record<string, unknown>
  run?: string
  env?: Record<string, string>
}

interface Job {
  needs?: string | string[]
  permissions?: Record<string, string>
  steps?: Step[]
}

const root = join(import.meta.dirname, '..', '..')
const document = parse(readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8')) as {
  jobs?: Record<string, Job>
}

describe('release workflow closeout', () => {
  it('creates the tag Release only when it is missing and never moves the tag', () => {
    const step = document.jobs?.release?.steps?.find((entry) => entry.run !== undefined)
    const lines = (step?.run ?? '').split('\n').map((line) => line.trim())
    // The guard must be the positive check: an inverted `if ! gh release view` would create
    // a second Release for an existing tag and skip a missing one.
    const guard = lines.indexOf('if gh release view "$TAG" > /dev/null 2>&1; then')
    const otherwise = lines.indexOf('else', guard)
    const create = lines.findIndex((line) => line.startsWith('gh release create'))
    expect(guard).toBeGreaterThanOrEqual(0)
    expect(otherwise).toBeGreaterThan(guard)
    expect(create).toBeGreaterThan(otherwise)
    expect(lines[create]).toBe('gh release create "$TAG" --generate-notes --verify-tag')
    expect(
      lines.slice(guard, otherwise).some((line) => line.includes('leaving it unchanged')),
    ).toBe(true)
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the value is GitHub's expression syntax, not a template.
    expect(step?.env?.GH_REPO).toBe('${{ github.repository }}')
  })

  it('runs the closeout after the index publication and the GitHub Release only', () => {
    const jobs = document.jobs ?? {}
    const closeout = jobs['close-issues']
    // The `release` job belongs to add-releases-and-discover-screenshot; without it a
    // closeout comment would name a Release URL that does not exist.
    expect(jobs.release?.needs).toBe('publish')
    expect(closeout?.needs).toEqual(['publish', 'release'])
    expect(closeout?.permissions).toEqual({ contents: 'read', issues: 'write' })
    const checkout = closeout?.steps?.find((step) => step.uses === 'actions/checkout@v4')
    expect(checkout?.with?.['fetch-depth']).toBe(0)
    const step = closeout?.steps?.find((entry) => entry.run?.includes('scripts/close-issues.ts'))
    expect(step?.run).toContain('--apply --version "$GITHUB_REF_NAME"')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the value is GitHub's expression syntax, not a template.
    expect(step?.env?.GH_TOKEN).toBe('${{ github.token }}')
  })
})
