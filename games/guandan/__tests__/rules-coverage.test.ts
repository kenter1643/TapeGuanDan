import { describe, expect, it } from 'vitest'
import { makeDeck, shuffle, deal } from '../cards'
import { classifyPlain, canBeat } from '../rules'
import { simpleConfig } from '../config'
import type { Card, Suit, Rank } from '../types'

const cards = makeDeck()
const pick = (rank: Rank, count: number): Card[] =>
  cards.filter(c => c.suit !== 'joker' && c.rank === rank).slice(0, count)
const one = (rank: Rank, suit: Suit, deck: 0 | 1 = 0): Card => {
  const card = cards.find(c => c.suit === suit && c.deck === deck && c.rank === rank)
  if (!card) throw new Error('missing card')
  return card
}
const rule = simpleConfig()
const classify = (x: Card[]) => classifyPlain(x, rule)

describe('Guandan plain rules: legal combinations and comparison', () => {
  it('recognizes singles, pairs, triples, 3+2 and rejects mixed duplicate counts', () => {
    expect(classify(pick(4, 1))?.name).toBe('single')
    expect(classify(pick(4, 2))?.name).toBe('pair')
    expect(classify(pick(4, 3))?.name).toBe('triple')
    expect(classify([...pick(5, 3), ...pick(10, 2)])).toMatchObject({ name: 'triple_pair', primary: 5 })
    expect(classify([...pick(5, 2), ...pick(10, 1)])).toBeNull()
  })

  it('recognizes three consecutive pairs and two consecutive triples', () => {
    expect(classify([...pick(3, 2), ...pick(4, 2), ...pick(5, 2)])).toMatchObject({
      name: 'three_pairs', count: 6, primary: 5,
    })
    expect(classify([...pick(6, 3), ...pick(7, 3)])).toMatchObject({
      name: 'two_triples', count: 6, primary: 7,
    })
    expect(classify([...pick(6, 2), ...pick(7, 2), ...pick(9, 2)])).toBeNull()
  })

  it('prioritizes straight flush over plain straight', () => {
    const flush = [3, 4, 5, 6, 7].map(n => one(n as Rank, 'hearts'))
    const mixed = [one(3, 'hearts'), one(4, 'spades'), one(5, 'hearts'), one(6, 'spades'), one(7, 'hearts')]
    expect(classify(flush)?.name).toBe('straight_flush')
    expect(classify(mixed)?.name).toBe('straight')
    expect(classify([one(11, 'spades'), one(12, 'hearts'), one(13, 'spades'), one(14, 'hearts'), one(2, 'spades')])).toBeNull()
  })

  it('recognizes 4-8 card bombs and rejects unachievable nine-card bombs', () => {
    for (let n = 4; n <= 8; n++) {
      expect(classify(pick(8, n))).toMatchObject({ name: 'bomb', count: n })
    }
    expect(classify([...pick(8, 8), one(9, 'spades')])).toBeNull()
  })

  it('orders equal-length bombs by rank and bigger tiers by size', () => {
    const small = classify(pick(5, 4))!
    const big = classify(pick(8, 4))!
    const five = classify(pick(4, 5))!
    expect(canBeat(big, small)).toBe(true)
    expect(canBeat(small, big)).toBe(false)
    expect(canBeat(five, big)).toBe(true)
    expect(canBeat(big, five)).toBe(false)
  })

  it('compares normal patterns only within matching types and lengths', () => {
    const single3 = classify(pick(3, 1))!
    const single4 = classify(pick(4, 1))!
    const pair4 = classify(pick(4, 2))!
    expect(canBeat(single4, single3)).toBe(true)
    expect(canBeat(single3, single4)).toBe(false)
    expect(canBeat(pair4, single3)).toBe(false)
    expect(canBeat(single3, null)).toBe(true)
  })

  it('applies current level rank to singles but does not change physical card IDs', () => {
    const levelRule = { ...rule, level: 6 as Rank }
    const levelSingle = classifyPlain(pick(6, 1), levelRule)!
    const ace = classifyPlain(pick(14, 1), levelRule)!
    expect(canBeat(levelSingle, ace)).toBe(true)
  })

  it('rejects duplicated physical card IDs and jokers used in straights', () => {
    expect(classify([one(4, 'hearts'), one(4, 'hearts')])).toBeNull()
    const joker = cards.find(c => c.suit === 'joker')!
    expect(classify([one(3,'hearts'), one(4,'spades'), one(5,'diamonds'), one(6,'clubs'), joker])).toBeNull()
  })
})

describe('deck invariants and RNG safety', () => {
  it('deals every physical card exactly once', () => {
    const hands = deal(makeDeck())
    expect(hands.map(h => h.length)).toEqual([27, 27, 27, 27])
    expect(new Set(hands.flatMap(h => h.map(c => c.id))).size).toBe(108)
  })
  it('does not mutate the source deck and rejects RNG outside [0,1)', () => {
    const original = makeDeck()
    const snapshot = JSON.stringify(original)
    shuffle(original, () => 0.5)
    expect(JSON.stringify(original)).toBe(snapshot)
    for (const rng of [() => -0.01, () => 1, () => Infinity, () => NaN]) {
      expect(() => shuffle(original, rng)).toThrow()
    }
  })
  it('refuses malformed deck lengths and duplicate physical cards', () => {
    const deck = makeDeck()
    expect(() => deal(deck.slice(0, 107))).toThrow()
    expect(() => deal([...deck.slice(0, 107), deck[0]])).toThrow()
  })
})
