import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * The host key that authenticates workflow approvals, receipts, and run files.
 * It lives outside the workspace `.dsh` tree, is never exposed to the model,
 * and is read or created once per host. An approval or receipt that a model
 * writes can therefore never carry a valid signature.
 */

/** Environment override: 64 hex characters. */
export const HOST_KEY_ENV = 'DSH_WORKFLOWS_HOST_KEY'

/** The default host key location, outside every workspace. */
export function defaultHostKeyFile(): string {
  return join(homedir(), '.dsh-setup', 'workflows-host.key')
}

/** One canonical JSON encoding, so signing and verification agree. */
function canonical(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  throw new Error('the host signature payload must be JSON data')
}

/** A trusted HMAC-SHA256 signer over a bounded payload. */
export class HostAuth {
  private readonly key: Buffer

  private constructor(key: Buffer) {
    this.key = key
  }

  /** Build a signer from an explicit key; tests use this seam. */
  static fromKey(key: string | Buffer): HostAuth {
    const value = typeof key === 'string' ? Buffer.from(key, 'utf8') : key
    if (value.length < 16) throw new Error('the workflows host key must be at least 16 bytes')
    return new HostAuth(value)
  }

  /** Load the host key, creating one atomically when it does not exist. */
  static async load(
    options: { keyFile?: string; env?: NodeJS.ProcessEnv } = {},
  ): Promise<HostAuth> {
    const env = options.env ?? process.env
    const configured = env[HOST_KEY_ENV]
    if (configured !== undefined && configured !== '') {
      if (!/^[a-f0-9]{64}$/u.test(configured)) {
        throw new Error(`${HOST_KEY_ENV} must be 64 hex characters`)
      }
      return HostAuth.fromKey(Buffer.from(configured, 'hex'))
    }
    const file = options.keyFile ?? defaultHostKeyFile()
    try {
      const raw = (await readFile(file, 'utf8')).trim()
      if (!/^[a-f0-9]{64}$/u.test(raw)) {
        throw new Error(`the workflows host key at ${file} is not 64 hex characters`)
      }
      return HostAuth.fromKey(Buffer.from(raw, 'hex'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const generated = randomBytes(32).toString('hex')
    try {
      const handle = await open(file, 'wx', 0o600)
      try {
        await handle.writeFile(`${generated}\n`, 'utf8')
      } finally {
        await handle.close()
      }
      return HostAuth.fromKey(Buffer.from(generated, 'hex'))
    } catch (error) {
      // A concurrent host created the key first; its value is authoritative.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const raw = (await readFile(file, 'utf8')).trim()
      if (!/^[a-f0-9]{64}$/u.test(raw)) {
        throw new Error(`the workflows host key at ${file} is not 64 hex characters`)
      }
      return HostAuth.fromKey(Buffer.from(raw, 'hex'))
    }
  }

  /** Sign one domain-separated payload. */
  sign(domain: string, payload: unknown): string {
    return createHmac('sha256', this.key)
      .update(`${domain}\n${canonical(payload)}`)
      .digest('hex')
  }

  /** Verify a signature; a missing, short, or forged value is simply false. */
  verify(domain: string, payload: unknown, signature: unknown): boolean {
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/u.test(signature)) return false
    let expected: string
    try {
      expected = this.sign(domain, payload)
    } catch {
      return false
    }
    const left = Buffer.from(expected, 'hex')
    const right = Buffer.from(signature, 'hex')
    return left.length === right.length && timingSafeEqual(left, right)
  }
}
