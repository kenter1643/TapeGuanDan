import { describe, expect, it } from 'vitest'
import { guandanSimpleServerPlugin } from '../plugin'
import { applyAction, clientView, newSimpleRound } from '../engine'
import { makeDeck } from '../cards'

const ids = ['alice', 'bob', 'carol', 'dave']
const simple = () => newSimpleRound(ids, () => 0.5)

describe('guandan Simple GameServerPlugin', () => {
  it('advertises a four-player room and only the simple-mode entry', () => {
    expect(guandanSimpleServerPlugin.id).toBe('guandan-simple')
    expect(guandanSimpleServerPlugin.minPlayers).toBe(4)
    expect(guandanSimpleServerPlugin.maxPlayers).toBe(4)
    expect(guandanSimpleServerPlugin.createInitialState(ids).config.mode).toBe('simple')
  })
  it('does not accept an unknown game event', () => {
    const state = simple()
    const result = guandanSimpleServerPlugin.handleEvent(state, ids[0], 'cheat', {})
    expect(result.error).toBeTruthy()
    expect(result.state).toBe(state)
  })
  it('does not leak any opponent cards in personalized state', () => {
    const state = simple()
    for (let i = 0; i < 4; i++) {
      const view = guandanSimpleServerPlugin.getClientState(state, ids[i])
      expect(view.myHand).toHaveLength(27)
      for (let j = 0; j < 4; j++) {
        if (j === i) continue
        expect(view.otherHandCounts[j]).toBe(27)
        const privateCards = state.players[j].hand.map(c => c.id)
        const ownIds = new Set(state.players[i].hand.map(c => c.id))
        for (const id of privateCards.filter(id => !ownIds.has(id))) {
          expect(JSON.stringify(view)).not.toContain(`"id":"${id}"`)
        }
      }
    }
  })
  it('chooses an opponent-team player when any seat forfeits', () => {
    const state = simple()
    for (let seat = 0; seat < 4; seat++) {
      const winnerId = guandanSimpleServerPlugin.resolveForfeitWinner?.(state, ids[seat])
      expect(winnerId).toBe(ids[(seat + 1) % 4])
      const winnerSeat = ids.indexOf(winnerId!)
      expect(winnerSeat % 2).not.toBe(seat % 2)
    }
    expect(guandanSimpleServerPlugin.resolveForfeitWinner?.(state, 'not-a-player')).toBeNull()
  })

  it('matches team win display to all four client viewpoints', () => {
    const state = simple()
    const deck = makeDeck()
    state.players[0].hand = [deck[1]]
    state.players[1].hand = [deck[1], deck[2]]
    state.players[2].hand = [deck[12]]
    state.players[3].hand = [deck[3], deck[4]]
    let s = applyAction(state, ids[0], { type:'play', cardIds:[deck[1].id] }).state
    s = applyAction(s, ids[1], { type:'pass' }).state
    s = applyAction(s, ids[2], { type:'play', cardIds:[deck[12].id] }).state
    expect(guandanSimpleServerPlugin.checkGameEnd(s)).toBe('alice')
    expect(clientView(s, 'alice').myRole).toBe('teamA')
    expect(clientView(s, 'carol').myRole).toBe('teamA')
    expect(clientView(s, 'bob').myRole).toBe('teamB')
    expect(clientView(s, 'alice').winner).toBe('teamA')
    expect(clientView(s, 'bob').winner).toBe('teamA')
  })
})
