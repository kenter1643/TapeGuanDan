import { describe, expect, it } from 'vitest'
import { detectBrand, validEvmAddress, connectInjectedWallet } from './src/wallet/providers'
import type { WalletChoice, EIP1193Provider } from './src/wallet/providers'

describe('wallet provider detection', () => {
  it('recognizes supported wallet provider names and reverse DNS identifiers', () => {
    expect(detectBrand('Binance Wallet')).toBe('binance')
    expect(detectBrand('OKX Wallet')).toBe('okx')
    expect(detectBrand('TokenPocket')).toBe('tokenpocket')
    expect(detectBrand('Unknown', 'pro.tokenpocket.wallet')).toBe('tokenpocket')
    expect(detectBrand('Some unrelated wallet')).toBeNull()
  })
  it('rejects invalid EVM addresses before account connection', () => {
    expect(validEvmAddress('0x' + '1'.repeat(40))).toBe(true)
    expect(validEvmAddress('0x' + 'A'.repeat(40))).toBe(true)
    expect(validEvmAddress('0x' + 'g'.repeat(40))).toBe(false)
    expect(validEvmAddress('0x123')).toBe(false)
    expect(validEvmAddress(null)).toBe(false)
  })
})

describe('injected EIP-1193 wallet request contract', () => {
  const makeWallet = (request: EIP1193Provider['request']): WalletChoice => ({
    brand: 'okx', label: 'OKX Wallet', provider: { request }, source: 'eip6963',
  })
  it('requires explicit account authorization and retrieves chain ID', async () => {
    const calls: string[] = []
    const wallet = makeWallet(async ({ method }) => {
      calls.push(method)
      if (method === 'eth_requestAccounts') return ['0x' + '1'.repeat(40)]
      if (method === 'eth_chainId') return '0x38'
      throw new Error('unexpected RPC method')
    })
    const result = await connectInjectedWallet(wallet)
    expect(result).toEqual({ address: '0x' + '1'.repeat(40), chainId: '0x38' })
    expect(calls).toEqual(['eth_requestAccounts','eth_chainId'])
    expect(calls).not.toContain('eth_sendTransaction')
    expect(calls).not.toContain('eth_signTypedData')
  })

  it('refuses wallet providers without an address', async () => {
    const wallet = makeWallet(async () => [])
    await expect(connectInjectedWallet(wallet)).rejects.toThrow('EVM')
  })

  it('refuses invalid chain IDs', async () => {
    const wallet = makeWallet(async ({ method }) =>
      method === 'eth_requestAccounts' ? ['0x' + '1'.repeat(40)] : 'network-not-hex')
    await expect(connectInjectedWallet(wallet)).rejects.toThrow()
  })

  it('propagates rejected wallet connection without requesting any transaction', async () => {
    const wallet = makeWallet(async ({ method }) => {
      if (method === 'eth_requestAccounts') throw new Error('User rejected request')
      throw new Error('unexpected method')
    })
    await expect(connectInjectedWallet(wallet)).rejects.toThrow('User rejected request')
  })
})
