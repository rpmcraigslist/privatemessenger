import { describe, expect, it } from 'vitest';

import { ensureParticipantSubs, repairParticipantSubs } from './util';

describe('ensureParticipantSubs', () => {
  const mySub = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const peerSub = '11111111-2222-3333-4444-555555555555';
  const handleToSub = new Map([['peer', peerSub]]);

  it('returns subs when participants are already Cognito subs', () => {
    expect(
      ensureParticipantSubs([mySub, peerSub], 'me', mySub, handleToSub),
    ).toEqual([mySub, peerSub]);
  });

  it('resolves handles through the directory map', () => {
    expect(
      ensureParticipantSubs([mySub, 'peer'], 'me', mySub, handleToSub),
    ).toEqual([mySub, peerSub]);
  });

  it('throws when a participant cannot be resolved to a sub', () => {
    expect(() =>
      ensureParticipantSubs([mySub, 'unknown'], 'me', mySub, handleToSub),
    ).toThrow(/could not resolve/i);
  });

  it('matches repairParticipantSubs for valid input', () => {
    const participants = [mySub, 'peer'];
    expect(
      ensureParticipantSubs(participants, 'me', mySub, handleToSub),
    ).toEqual(repairParticipantSubs(participants, 'me', mySub, handleToSub));
  });
});
