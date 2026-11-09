import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { WalletAuth } from '../wallet-auth'
import { UserStore } from '../user-store'

const ADDR = '0x1111111111111111111111111111111111111111'
const SECOND = '0x2222222222222222222222222222222222222222'
const ORIGIN = 'http://localhost:5173'
const SIGNATURE = '0x' + 'a'.repeat(130)
let db: Database.Database
let users: UserStore
let verify: ReturnType<typeof vi.fn>
let wallet: WalletAuth

describe('wallet signup / login (mock crypto verifier: NOT cryptographic integration)', () => {
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar_id INTEGER DEFAULT 0,
        coins INTEGER DEFAULT 1000,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE coin_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `)
    users = new UserStore(db, 'isolated-test-secret')
    verify = vi.fn(async ({ address, message }: { address: string; message: string }) =>
      message.toLowerCase().includes(address.toLowerCase()) && message.includes('URI: ' + ORIGIN))
    wallet = new WalletAuth(db, users, { verifyMessage: verify })
  })
  afterEach(() => { db.close(); vi.restoreAllMocks() })

  it('first valid signed challenge creates exactly one account and valid session token', async () => {
    const { challengeId } = wallet.challenge(ADDR, 56, ORIGIN)
    const result = await wallet.verify(challengeId, SIGNATURE, ORIGIN)
    expect(result.user.username).toMatch(/^w_[0-9a-f]{16}$/)
    expect(result.user.displayName).toMatch(/^玩家/)
    expect(users.verifyToken(result.token)).toMatchObject({ valid: true, username: result.user.username })
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM wallet_accounts').get()).toEqual({ n: 1 })
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('repeated signatures on fresh nonces preserve user ID, nickname and avatar', async () => {
    const one = wallet.challenge(ADDR, 56, ORIGIN)
    const first = await wallet.verify(one.challengeId, SIGNATURE, ORIGIN)
    expect(users.updateProfile(first.user.username, '昆哥', 6).success).toBe(true)
    const two = wallet.challenge(ADDR.toUpperCase().replace('0X', '0x'), 56, ORIGIN)
    const again = await wallet.verify(two.challengeId, SIGNATURE, ORIGIN)
    expect(again.user.id).toBe(first.user.id)
    expect(again.user.displayName).toBe('昆哥')
    expect(again.user.avatarId).toBe(6)
    expect(db.prepare('SELECT COUNT(*) AS n FROM wallet_accounts').get()).toEqual({ n: 1 })
  })

  it('distinct addresses cannot collide with each other', async () => {
    const a = wallet.challenge(ADDR, 56, ORIGIN)
    const b = wallet.challenge(SECOND, 56, ORIGIN)
    const first = await wallet.verify(a.challengeId, SIGNATURE, ORIGIN)
    const second = await wallet.verify(b.challengeId, SIGNATURE, ORIGIN)
    expect(first.user.id).not.toBe(second.user.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM wallet_accounts').get()).toEqual({ n: 2 })
  })

  it('consumes the nonce exactly once, even when the same request is retried concurrently', async () => {
    const { challengeId } = wallet.challenge(ADDR, 56, ORIGIN)
    const settled = await Promise.allSettled([
      wallet.verify(challengeId, SIGNATURE, ORIGIN),
      wallet.verify(challengeId, SIGNATURE, ORIGIN),
    ])
    expect(settled.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter(r => r.status === 'rejected')).toHaveLength(1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 })
    await expect(wallet.verify(challengeId, SIGNATURE, ORIGIN)).rejects.toThrow('CHALLENGE_EXPIRED')
  })

  it('rejects invalid signatures and keeps nonce unused for a legitimate retry', async () => {
    verify.mockResolvedValueOnce(false)
    const { challengeId } = wallet.challenge(ADDR, 56, ORIGIN)
    await expect(wallet.verify(challengeId, SIGNATURE, ORIGIN)).rejects.toThrow('INVALID_SIGNATURE')
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 })
    const next = await wallet.verify(challengeId, SIGNATURE, ORIGIN)
    expect(next.user.id).toBeGreaterThan(0)
  })

  it('rejects wrong origin, expired nonce, malformed address, and null signature', async () => {
    const { challengeId } = wallet.challenge(ADDR, 56, ORIGIN)
    await expect(wallet.verify(challengeId, SIGNATURE, 'https://evil.test')).rejects.toThrow('ORIGIN_MISMATCH')
    await expect(wallet.verify(challengeId, null, ORIGIN)).rejects.toThrow('INVALID_SIGNATURE')
    expect(() => wallet.challenge('0x1234', 56, ORIGIN)).toThrow('INVALID_WALLET_PARAMS')
    db.prepare('UPDATE wallet_challenges SET expires_at = ? WHERE id = ?').run(1, challengeId)
    await expect(wallet.verify(challengeId, SIGNATURE, ORIGIN)).rejects.toThrow('CHALLENGE_EXPIRED')
  })

  it('reverts user registration if mapping insertion fails', async () => {
    db.exec(`CREATE TRIGGER fail_link BEFORE INSERT ON wallet_accounts
      BEGIN SELECT RAISE(ABORT, 'blocked'); END;`)
    const { challengeId } = wallet.challenge(ADDR, 56, ORIGIN)
    await expect(wallet.verify(challengeId, SIGNATURE, ORIGIN)).rejects.toThrow()
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM wallet_accounts').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT used_at FROM wallet_challenges WHERE id = ?').get(challengeId))
      .toEqual({ used_at: null })
  })
})
