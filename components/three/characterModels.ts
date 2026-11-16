// Character models for the people at the table.
//
// Leave the list empty to use the built-in placeholders. To use your own figures,
// put .glb files where the app can load them (for example /characters/ next to index.html)
// and list their URLs. Entry i is used for seat colour i (0–5) and repeats when the list is shorter.
//
// What a model should look like:
// - glTF binary (.glb), Y up, facing +Z (the glTF default), one person, ideally in a seated pose
// - any size: it is scaled so its height is CHARACTER_HEIGHT and its feet stand on the floor
// - a node with "head" in its name turns to follow the game; without one the model stays still
export const CHARACTER_MODELS: string[] = [];

/** Height of a model after scaling, in table units (1 unit ≈ 10 cm). Seated adult ≈ 13. */
export const CHARACTER_HEIGHT = 13;
