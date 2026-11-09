import { describe, expect, it } from 'vitest'
import { makeDeck } from '../cards'
import { applyAction, clientView, newSimpleRound } from '../engine'
import type { GuandanRound } from '../engine'

const ids = ['p0','p1','p2','p3']
const deck = makeDeck()
const newRound = () => newSimpleRound(ids, () => 0.5)
function rig(hands: number[][]): GuandanRound {
  const state = newRound()
  state.players.forEach((p, i) => { p.hand = hands[i].map(j => deck[j]) })
  return state
}

describe('Guandan reducer: rejects unsafe and invalid actions without mutation', () => {
  const invalid = [
    null, {}, { type: 'unknown' },
    { type: 'play' }, { type: 'play', cardIds: null },
    { type: 'play', cardIds: [] }, { type: 'play', cardIds: ['forged'] },
    { type: 'play', cardIds: [42] }, { type: 'play', cardIds: Array(28).fill('x') },
  ]
  for (const action of invalid) {
    it('rejects invalid action: ' + JSON.stringify(action), () => {
      const state = newRound()
      const before = JSON.stringify(state)
      const result = applyAction(state, ids[0], action as never)
      expect(result.error).toBeTruthy()
      expect(result.state).toBe(state)
      expect(JSON.stringify(state)).toBe(before)
    })
  }

  it('rejects actions from an out-of-turn player and outside participant', () => {
    const s = newRound()
    expect(applyAction(s, ids[1], { type: 'play', cardIds: [s.players[1].hand[0].id] }).error).toBeTruthy()
    expect(applyAction(s, 'outsider', { type: 'play', cardIds: [s.players[0].hand[0].id] }).error).toBeTruthy()
  })

  it('rejects pass when leading and invalid configurations', () => {
    const s = newRound()
    expect(applyAction(s, ids[0], { type: 'pass' }).error).toBeTruthy()
    const classic = structuredClone(s)
    classic.config.mode = 'classic'
    expect(applyAction(classic, ids[0], { type: 'play', cardIds: [classic.players[0].hand[0].id] }).error).toBeTruthy()
    const ended = structuredClone(s)
    ended.phase = 'ended'
    expect(applyAction(ended, ids[0], { type: 'pass' }).error).toBeTruthy()
  })

  it('accepted play is immutable and projects strictly per-player hands', () => {
    const state = newRound()
    const before = JSON.stringify(state)
    const card = state.players[0].hand[0].id
    const result = applyAction(state, ids[0], { type: 'play', cardIds: [card] })
    expect(result.error).toBeUndefined()
    expect(JSON.stringify(state)).toBe(before)
    expect(result.state).not.toBe(state)
    expect(result.state.players[0].hand).toHaveLength(26)
    for (let i=0; i<4; i++) {
      const view = clientView(result.state, ids[i])
      expect(view.myPlayerIndex).toBe(i)
      expect(view.myHand.length).toBe(i === 0 ? 26 : 27)
      expect(view.otherHandCounts[i]).toBeNull()
      expect(Object.keys(view)).not.toContain('players')
    }
  })

  it('requires exactly four distinct nonempty player IDs', () => {
    expect(() => newSimpleRound(['one'], () => 0.5)).toThrow()
    expect(() => newSimpleRound(['a','b','a','c'], () => 0.5)).toThrow()
    expect(() => newSimpleRound(['a','b','c',''], () => 0.5)).toThrow()
  })

  it('on a four-player trick three passes yield a fresh lead for the last player', () => {
    let s = newRound()
    const card = s.players[0].hand[0].id
    s = applyAction(s, ids[0], { type: 'play', cardIds: [card] }).state
    for (let i=1; i<=3; i++) {
      const r = applyAction(s, ids[i], { type: 'pass' })
      expect(r.error).toBeUndefined()
      s = r.state
    }
    expect(s.currentTurn).toBe(0)
    expect(s.lastPlay).toBeNull()
    expect(s.passedSeats).toEqual([])
  })

  it('allows teammate finishing with first player to end immediately', () => {
    const s = rig([[1], [2,3], [12], [4,5]])
    const first = applyAction(s, ids[0], { type: 'play', cardIds: [deck[1].id] }).state
    const passed = applyAction(first, ids[1], { type: 'pass' }).state
    const ended = applyAction(passed, ids[2], { type: 'play', cardIds: [deck[12].id] }).state
    expect(ended.phase).toBe('ended')
    expect(ended.finishOrder).toEqual([0,2])
    expect(ended.winner).toBe(ids[0])
    expect(clientView(ended, ids[0]).winner).toBe('teamA')
    expect(clientView(ended, ids[1]).winner).toBe('teamA')
  })
})
