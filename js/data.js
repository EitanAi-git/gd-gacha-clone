// EitanGD Gacha: display constants only. Cards, packs, odds and values come from the server
// (see supabase/schema.sql) and are edited in the admin panel.
window.GD_DATA = (function () {
  const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
  const RARITY_INFO = {
    common:    { label: "Common",    color: "#9aa4b8" },
    uncommon:  { label: "Uncommon",  color: "#3fbf6a" },
    rare:      { label: "Rare",      color: "#3ea8ff" },
    epic:      { label: "Epic",      color: "#a860ff" },
    legendary: { label: "Legendary", color: "#ffa51f" },
    mythic:    { label: "Mythic",    color: "#ff4f7b" },
  };
  const SETS = {
    Official: { code: "OFF", label: "Official",      color: "#3ee8ff" },
    Easy:     { code: "EAS", label: "Easy Demon",    color: "#4fd17a" },
    Medium:   { code: "MED", label: "Medium Demon",  color: "#ffd23e" },
    Hard:     { code: "HRD", label: "Hard Demon",    color: "#ff8a3e" },
    Insane:   { code: "INS", label: "Insane Demon",  color: "#ff4fb3" },
    Extreme:  { code: "EXT", label: "Extreme Demon", color: "#ff3e3e" },
  };
  const SET_ORDER = ["Official", "Easy", "Medium", "Hard", "Insane", "Extreme"];
  return { RARITIES, RARITY_INFO, SETS, SET_ORDER };
})();
