// Character models for the people at the table.
//
// The defaults are the KayKit Adventurers by Kay Lousberg (www.kaylousberg.com), CC0 1.0,
// slimmed to the animations the game uses (see public/characters/LICENSE-KayKit.txt).
// Entry i is used for the i-th opponent around the table and repeats when there are more players.
// Paths are relative to the page; the loader also tries them under public/ for hosts that
// serve the source tree as is (Google AI Studio).
//
// What a model needs to be "fully" used:
// - glTF binary (.glb), Y up, facing +Z (the glTF default), one skinned person
// - a clip named SEATED_CLIP (looped while sitting) and any of the REACTION_CLIPS
// - a bone named "head" (turns to follow the game) and bones for the upper body (UPPER_BODY)
// Models without these still load: without the seated clip they stand still, without a head bone they do not look around.
export const CHARACTER_MODELS: string[] = [
  'characters/Knight.glb',
  'characters/Barbarian.glb',
  'characters/Mage.glb',
  'characters/Rogue_Hooded.glb',
  'characters/Rogue.glb',
];

export const SEATED_CLIP = 'Sit_Chair_Idle';

/** What the figures do when something happens to them */
export const REACTION_CLIPS = {
  pick: 'PickUp',
  swap: 'Use_Item',
  tap: 'Interact',
  cheer: 'Cheer',
  wince: 'Hit_A',
} as const;

/** Bones a reaction may move; legs and hips keep sitting */
export const UPPER_BODY = /^(spine|chest|head|upperarm|lowerarm|wrist|hand|handslot|elbowIK|handIK)/;

/** Fallback height for models without a seated clip, in table units (1 unit ≈ 10 cm) */
export const CHARACTER_HEIGHT = 13;
