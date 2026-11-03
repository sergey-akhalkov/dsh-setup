import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Write `count` blobs through plumbing and pin them with a ref, so they stay
 * loose (unreachable blobs are not packed by `git repack -d`).
 */
export function seedLooseBacklog(dir: string, scratch: string, count: number): void {
  const files = join(scratch, 'loose-fixture')
  mkdirSync(files, { recursive: true })
  const paths: string[] = []
  for (let index = 0; index < count; index += 1) {
    const file = join(files, `${index}.txt`)
    writeFileSync(file, `${index}`)
    paths.push(file)
  }
  const blobs = execFileSync('git', ['hash-object', '-w', '--stdin-paths'], {
    cwd: dir,
    input: `${paths.join('\n')}\n`,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
  const tree = execFileSync('git', ['mktree'], {
    cwd: dir,
    input: `${blobs.map((sha, index) => `100644 blob ${sha}\t${index}.txt`).join('\n')}\n`,
    encoding: 'utf8',
  }).trim()
  const commit = execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@localhost',
      'commit-tree',
      tree,
      '-m',
      'fixture',
    ],
    { cwd: dir, encoding: 'utf8' },
  ).trim()
  execFileSync('git', ['update-ref', 'refs/heads/fixture', commit], { cwd: dir })
}

/** The loose object count `git count-objects -v` reports. */
export function looseObjectCount(dir: string): number {
  const output = execFileSync('git', ['count-objects', '-v'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return Number(/^count:\s*(\d+)/mu.exec(output)?.[1] ?? 0)
}
