import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import type Database from 'better-sqlite3'
import type { UserRecord } from '@tongzhuo/core-shared'
import { UserStore } from './user-store'

const loadPackage = createRequire(import.meta.url)
const NONCE_TTL_MS = 5 * 60 * 1000
const ADDRESS_RE = /^0x[a-f\d]{40}$/i

type ChallengeRecord = {
  id: string
  address: string
  message: string
  expires_at: number
  used_at: number | null
}
type Viem = {
  verifyMessage: (args: { address: `0x${string}`; message: string; signature: `0x${string}` }) => Promise<boolean>
}

/**
 * Wallet sign-in is fail-closed: no authenticated session is issued unless a
 * real cryptographic EIP-191 signature verifier is installed and succeeds.
 */
function signatureVerifier(): Viem | null {
  try {
    const module = loadPackage('viem') as Partial<Viem>
    return typeof module.verifyMessage === 'function' ? module as Viem : null
  } catch { return null }
}

export function walletVerifierAvailable(): boolean {
  return signatureVerifier() !== null
}

export class WalletAuth {
  // Tests can inject a verifier; the live server always uses the installed viem implementation.
  constructor(private db: Database.Database, private users: UserStore, private verifySignature: Viem | null = null) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS wallet_challenges (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        message TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER DEFAULT NULL
      );
      CREATE TABLE IF NOT EXISTS wallet_accounts (
        address TEXT PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wallet_challenges_expiry ON wallet_challenges(expires_at);
    `)
  }

  challenge(address: unknown, chainId: unknown, origin: unknown) {
    if (typeof address !== 'string' || !ADDRESS_RE.test(address) ||
        (typeof chainId !== 'number' || !Number.isSafeInteger(chainId) || chainId < 1) ||
        typeof origin !== 'string') throw new Error('INVALID_WALLET_PARAMS')
    let url: URL
    try { url = new URL(origin) } catch { throw new Error('INVALID_ORIGIN') }
    if (!['https:', 'http:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('INVALID_ORIGIN')
    }
    const issued = new Date()
    const expires = new Date(issued.getTime() + NONCE_TTL_MS)
    const id = crypto.randomBytes(24).toString('hex')
    const nonce = crypto.randomBytes(12).toString('hex')
    const normalized = address.toLowerCase()
    // SIWE (EIP-4361) message; no transaction, token approval or gas.
    const message = `${url.host} wants you to sign in with your Ethereum account:
${address}

Sign in to Tape Games.

URI: ${url.origin}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issued.toISOString()}
Expiration Time: ${expires.toISOString()}`
    this.db.prepare('DELETE FROM wallet_challenges WHERE expires_at < ?').run(Date.now())
    this.db.prepare('INSERT INTO wallet_challenges (id,address,message,expires_at) VALUES (?,?,?,?)')
      .run(id, normalized, message, expires.getTime())
    return { challengeId: id, message, expiresAt: expires.toISOString() }
  }

  async verify(challengeId: unknown, signature: unknown, origin: unknown): Promise<{ token: string; user: UserRecord }> {
    if (typeof challengeId !== 'string' || !/^[a-f0-9]{48}$/.test(challengeId) ||
      typeof signature !== 'string' || !/^0x[a-f\d]{130}$/i.test(signature)) {
      throw new Error('INVALID_SIGNATURE')
    }
    const entry = this.db.prepare('SELECT * FROM wallet_challenges WHERE id = ?')
      .get(challengeId) as ChallengeRecord | undefined
    if (!entry || entry.used_at !== null || Date.now() > entry.expires_at) throw new Error('CHALLENGE_EXPIRED')
    const match = /^URI: (.+)$/m.exec(entry.message)
    if (typeof origin !== 'string' || match?.[1] !== origin) throw new Error('ORIGIN_MISMATCH')

    const verifier = this.verifySignature ?? signatureVerifier()
    if (!verifier) throw new Error('WALLET_VERIFIER_UNAVAILABLE')
    const ok = await verifier.verifyMessage({
      address: entry.address as `0x${string}`,
      message: entry.message,
      signature: signature as `0x${string}`,
    })
    if (!ok) throw new Error('INVALID_SIGNATURE')
    // Atomic consumption prevents replay and concurrent double-registration.
    return this.db.transaction(() => {
      const consumed = this.db.prepare(
        'UPDATE wallet_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?'
      ).run(Date.now(), challengeId, Date.now())
      if (consumed.changes !== 1) throw new Error('CHALLENGE_EXPIRED')
      let row = this.db.prepare('SELECT user_id FROM wallet_accounts WHERE address = ?')
        .get(entry.address) as { user_id: number } | undefined
      let user: UserRecord | undefined = row ? this.users.getUserById(row.user_id) : undefined
      if (!user) {
        const username = `w_${crypto.randomBytes(8).toString('hex')}`
        const password = crypto.randomBytes(32).toString('hex')
        const name = `玩家${entry.address.slice(2, 8)}`
        const result = this.users.createUser(username, password, name)
        if (!result.success || !result.user) throw new Error('REGISTER_FAILED')
        user = result.user
        this.db.prepare('INSERT INTO wallet_accounts (address,user_id,created_at) VALUES (?,?,?)')
          .run(entry.address, user.id, Date.now())
      }
      return { token: this.users.generateToken(user.username), user }
    })()
  }
}
