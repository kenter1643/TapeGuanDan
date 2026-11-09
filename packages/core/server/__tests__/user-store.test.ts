import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { UserStore } from '../user-store'

let db: Database.Database
let store: UserStore
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
  store = new UserStore(db, 'test-secret')
})
afterEach(() => db.close())

describe('UserStore: credentials, tokens, profile and ledger', () => {
  it('creates a user without exposing password hash or salt; rejects duplicate users', () => {
    const created = store.createUser('alice', 'secret123', 'Alice')
    expect(created.success).toBe(true)
    expect(created.user).toMatchObject({ username: 'alice', displayName: 'Alice', coins: 1000 })
    expect(JSON.stringify(created.user)).not.toContain('password_hash')
    expect(store.createUser('alice', 'secret123').success).toBe(false)
    expect(store.hasUsers()).toBe(true)
    expect(store.getUserById(created.user!.id)).toEqual(created.user)
  })

  it('rejects invalid usernames, weak passwords and empty nicknames', () => {
    expect(store.createUser('a', 'secret123').success).toBe(false)
    expect(store.createUser('alice', 'short').success).toBe(false)
    expect(store.createUser('alice', 'secret123', ' ').success).toBe(false)
  })

  it('checks password, supports changing password and refuses old one', () => {
    store.createUser('alice', 'oldSecret')
    expect(store.verifyPassword('alice', 'wrong').valid).toBe(false)
    expect(store.verifyPassword('alice', 'oldSecret').valid).toBe(true)
    expect(store.changePassword('alice', 'wrong', 'newSecret').success).toBe(false)
    expect(store.changePassword('alice', 'oldSecret', 'newSecret').success).toBe(true)
    expect(store.verifyPassword('alice', 'oldSecret').valid).toBe(false)
    expect(store.verifyPassword('alice', 'newSecret').valid).toBe(true)
  })

  it('issues and refreshes tokens, rejects alteration and malformed MACs', () => {
    store.createUser('alice', 'secret123')
    const token = store.generateToken('alice')
    expect(store.verifyToken(token)).toMatchObject({ valid: true, username: 'alice' })
    const refreshed = store.refreshToken(token)
    expect(refreshed.success).toBe(true)
    expect(store.verifyToken(refreshed.newToken!).valid).toBe(true)
    expect(store.verifyToken(token.replace(/^alice/, 'bob')).valid).toBe(false)
    for (const malformed of ['abc', 'alice.1.2.', 'alice.1.2.xxxx', 'alice.1.2.' + 'z'.repeat(64)]) {
      expect(store.verifyToken(malformed).valid).toBe(false)
    }
  })

  it('persists nickname/avatar and rejects out-of-range avatars', () => {
    store.createUser('alice', 'secret123')
    expect(store.updateProfile('alice', '新昵称', 9).success).toBe(true)
    expect(store.getUser('alice')).toMatchObject({ displayName: '新昵称', avatarId: 9 })
    expect(store.updateProfile('alice', undefined, 10).success).toBe(false)
    expect(store.getUser('alice')?.avatarId).toBe(9)
    expect(store.updateProfile('missing', 'abc').success).toBe(false)
  })

  it('keeps a consistent coin balance and does not record an overdraft', () => {
    const user = store.createUser('alice', 'secret123').user!
    expect(store.addCoins(user.id, 50, 'test')).toMatchObject({ success: true, newBalance: 1050 })
    expect(store.addCoins(user.id, -9999, 'overdraft').success).toBe(false)
    expect(store.getUser('alice')?.coins).toBe(1050)
    expect(store.getTransactions(user.id)).toHaveLength(1)
  })
})
