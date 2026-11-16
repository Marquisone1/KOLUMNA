import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, maxVisibleCard, publicStep, publicView, standings, visibleSum } from './engine';
import { afterDelay } from '../anim';

test('game lifecycle: lobby, setup flips, play turn, and publicView masking', () => {
  const game = new Game('host-1');
  assert.equal(game.addPlayer('host-1', 'Alice').ok, true);
  assert.equal(game.addPlayer('bot-1', 'Ada', true).ok, true);

  const startRes = game.apply('host-1', { a: 'start' });
  assert.equal(startRes.ok, true);
  assert.equal(game.s.phase, 'setup');
  assert.equal(game.s.players[0].grid.length, 4);

  // Public view masks face-down cards
  const pubBefore = publicView(game.s, 'host-1');
  assert.equal(pubBefore.players[0].grid[0][0].card.v, null);

  // Both players flip 2 cards in setup
  const p1Cards = game.s.players[0].grid.flat();
  const p2Cards = game.s.players[1].grid.flat();
  assert.equal(game.apply('host-1', { a: 'flip', card: p1Cards[0].card.id }).ok, true);
  assert.equal(game.apply('host-1', { a: 'flip', card: p1Cards[1].card.id }).ok, true);
  assert.equal(game.apply('bot-1', { a: 'flip', card: p2Cards[0].card.id }).ok, true);
  assert.equal(game.apply('bot-1', { a: 'flip', card: p2Cards[1].card.id }).ok, true);

  assert.equal(game.s.phase, 'play');
  assert.equal(game.s.stage, 'choose');

  const activeId = game.s.players[game.s.turn].id;
  const otherId = activeId === 'host-1' ? 'bot-1' : 'host-1';
  const drawRes = game.apply(activeId, { a: 'drawDeck' });
  assert.equal(drawRes.ok, true);
  assert.equal(game.s.stage, 'deckDrawn');
  assert.notEqual(game.s.drawn, null);

  // Active player sees drawn card value; opponent sees v: null until placed on board or discard
  const stepForDrawer = publicStep(drawRes.steps[0], activeId);
  const stepForOpponent = publicStep(drawRes.steps[0], otherId);
  assert.notEqual(stepForDrawer.state.drawn?.v, null);
  assert.equal(stepForOpponent.state.drawn?.v, null);
  if (stepForDrawer.ev.k === 'draw' && stepForOpponent.ev.k === 'draw') {
    assert.notEqual(stepForDrawer.ev.card.v, null);
    assert.equal(stepForOpponent.ev.card.v, null);
  }

  // Once placed on discard (toss) or swapped onto board, opponent sees the card value
  const tossRes = game.apply(activeId, { a: 'toss' });
  assert.equal(tossRes.ok, true);
  const tossForOpponent = publicStep(tossRes.steps[0], otherId);
  if (tossForOpponent.ev.k === 'toss') {
    assert.notEqual(tossForOpponent.ev.card.v, null);
  }
  assert.notEqual(tossForOpponent.state.discard[tossForOpponent.state.discard.length - 1]?.v, null);
});

test('player with highest flipped sum starts every round (including round 2+), with highest card tie-breaker', () => {
  const game = new Game('p1');
  game.addPlayer('p1', 'Alice');
  game.addPlayer('p2', 'Bob');
  game.apply('p1', { a: 'start' });

  // Force known card values in Round 1: p2 has higher sum (15 vs 8)
  const p1Slots = game.s.players[0].grid.flat();
  const p2Slots = game.s.players[1].grid.flat();
  p1Slots[0].card.v = 3;
  p1Slots[1].card.v = 5;
  p2Slots[0].card.v = 7;
  p2Slots[1].card.v = 8;

  game.apply('p1', { a: 'flip', card: p1Slots[0].card.id });
  game.apply('p1', { a: 'flip', card: p1Slots[1].card.id });
  game.apply('p2', { a: 'flip', card: p2Slots[0].card.id });
  game.apply('p2', { a: 'flip', card: p2Slots[1].card.id });

  assert.equal(game.s.phase, 'play');
  assert.equal(game.s.players[game.s.turn].id, 'p2');

  // Simulate Round 1 ending with p1 as finisher, then start Round 2
  game.s.phase = 'roundEnd';
  game.s.starter = 'p1';
  assert.equal(game.apply('p1', { a: 'nextRound' }).ok, true);
  assert.equal(game.s.round, 2);
  assert.equal(game.s.phase, 'setup');

  // In Round 2, p1 and p2 tie on sum (10 vs 10), but p2 has the higher single card (11 vs 6)
  const r2p1 = game.s.players[0].grid.flat();
  const r2p2 = game.s.players[1].grid.flat();
  r2p1[0].card.v = 4;
  r2p1[1].card.v = 6;
  r2p2[0].card.v = -1;
  r2p2[1].card.v = 11;

  game.apply('p1', { a: 'flip', card: r2p1[0].card.id });
  game.apply('p2', { a: 'flip', card: r2p2[0].card.id });
  game.apply('p1', { a: 'flip', card: r2p1[1].card.id });
  game.apply('p2', { a: 'flip', card: r2p2[1].card.id });

  assert.equal(maxVisibleCard(game.s.players[0]), 6);
  assert.equal(maxVisibleCard(game.s.players[1]), 11);
  assert.equal(game.s.phase, 'play');
  assert.equal(game.s.players[game.s.turn].id, 'p2');
});

test('setup flips have 0ms queue delay while setup is in progress so players can flip in parallel', () => {
  const game = new Game('p1');
  game.addPlayer('p1', 'Alice');
  game.addPlayer('p2', 'Bob');
  const startRes = game.apply('p1', { a: 'start' });
  assert.equal(afterDelay(startRes.steps[0].ev, startRes.steps[0].state), 0);

  const p1Slots = game.s.players[0].grid.flat();
  const p2Slots = game.s.players[1].grid.flat();

  const f1 = game.apply('p1', { a: 'flip', card: p1Slots[0].card.id });
  assert.equal(afterDelay(f1.steps[0].ev, f1.steps[0].state), 0);

  const f2 = game.apply('p1', { a: 'flip', card: p1Slots[1].card.id });
  assert.equal(afterDelay(f2.steps[0].ev, f2.steps[0].state), 0);

  const f3 = game.apply('p2', { a: 'flip', card: p2Slots[0].card.id });
  assert.equal(afterDelay(f3.steps[0].ev, f3.steps[0].state), 0);

  // Final setup flip waits 440ms before transitioning to play
  const f4 = game.apply('p2', { a: 'flip', card: p2Slots[1].card.id });
  assert.equal(afterDelay(f4.steps[0].ev, f4.steps[0].state), 440);
});

test('standings ranks lowest total first and shares ties', () => {
  const game = new Game('h');
  game.addPlayer('p1', 'A');
  game.addPlayer('p2', 'B');
  game.addPlayer('p3', 'C');
  game.s.players[0].total = 25;
  game.s.players[1].total = 10;
  game.s.players[2].total = 10;

  const ranked = standings(game.s.players);
  assert.equal(ranked[0].place, 1);
  assert.equal(ranked[1].place, 1);
  assert.equal(ranked[2].place, 3);
  assert.equal(visibleSum(game.s.players[0]), 0);
});

test('lobby settings: only the host changes them, only in the lobby; shuffled seats keep everyone', () => {
  const game = new Game('h');
  game.addPlayer('h', 'Host');
  for (const id of ['a', 'b', 'c', 'd']) game.addPlayer(id, id.toUpperCase(), true);
  assert.deepEqual(game.s.settings, { view: 'both', shuffleSeats: false, room: 'bar' });

  assert.equal(game.apply('a', { a: 'settings', view: '2d' }).ok, false);
  assert.equal(game.apply('h', { a: 'settings', view: 'flat' as never }).ok, false);
  assert.equal(game.apply('h', { a: 'settings', view: '3d' }).ok, true);
  assert.equal(game.apply('h', { a: 'settings', shuffleSeats: true }).ok, true);
  assert.equal(game.apply('h', { a: 'settings', room: 'moon' as never }).ok, false);
  assert.equal(game.apply('h', { a: 'settings', room: 'space' }).ok, true);
  assert.deepEqual(game.s.settings, { view: '3d', shuffleSeats: true, room: 'space' });

  // A game saved before settings existed still starts
  delete game.s.settings;
  assert.equal(game.apply('h', { a: 'settings', shuffleSeats: true }).ok, true);
  assert.equal(game.s.settings?.view, 'both');

  const before = game.s.players.map((p) => p.id).sort();
  let changed = false;
  const first = game.s.players.map((p) => p.id).join();
  assert.equal(game.apply('h', { a: 'start' }).ok, true);
  assert.equal(game.apply('h', { a: 'settings', view: '2d' }).ok, false, 'settings are locked once the game runs');
  assert.deepEqual(game.s.players.map((p) => p.id).sort(), before);
  // five players: the order after a few deals is very unlikely to stay the same every time
  for (let i = 0; i < 6 && !changed; i++) {
    (game as unknown as { deal(): void }).deal();
    changed = game.s.players.map((p) => p.id).join() !== first;
    assert.deepEqual(game.s.players.map((p) => p.id).sort(), before);
    for (const p of game.s.players) assert.equal(p.grid.length, 4);
  }
  assert.ok(changed, 'seats were shuffled');
});
