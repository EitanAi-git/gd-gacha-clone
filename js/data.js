// EitanGD Gacha: card and pack data.
// Level names and creators belong to their respective creators.
// Geometry Dash is a game by RobTop Games. Inspired by gachagd.com.
// This list is hand-curated; add more cards from the Admin page.

window.GD_DATA = (function () {
  const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

  const RARITY_INFO = {
    common:    { label: "Common",    color: "#9aa4b8", sell: 2 },
    uncommon:  { label: "Uncommon",  color: "#4fd17a", sell: 5 },
    rare:      { label: "Rare",      color: "#3ea8ff", sell: 15 },
    epic:      { label: "Epic",      color: "#b067ff", sell: 50 },
    legendary: { label: "Legendary", color: "#ffb020", sell: 200 },
    mythic:    { label: "Mythic",    color: "#ff4f7b", sell: 1000 },
  };

  const SETS = {
    Official: { code: "OFF", label: "Official",       color: "#3ee8ff" },
    Easy:     { code: "EAS", label: "Easy Demon",     color: "#4fd17a" },
    Medium:   { code: "MED", label: "Medium Demon",   color: "#ffd23e" },
    Hard:     { code: "HRD", label: "Hard Demon",     color: "#ff8a3e" },
    Insane:   { code: "INS", label: "Insane Demon",   color: "#ff4fb3" },
    Extreme:  { code: "EXT", label: "Extreme Demon",  color: "#ff3e3e" },
  };
  const SET_ORDER = ["Official", "Easy", "Medium", "Hard", "Insane", "Extreme"];

  const MODIFIERS = {
    foil:    { label: "Foil",     chance: 8, sellBonus: 4 },
    fullArt: { label: "Full art", chance: 6, sellBonus: 5 },
  };

  // [name, creator, set, rarity]
  const RAW = [
    // Official levels by RobTop Games
    ["Stereo Madness", "RobTop", "Official", "common"],
    ["Back on Track", "RobTop", "Official", "common"],
    ["Polargeist", "RobTop", "Official", "common"],
    ["Dry Out", "RobTop", "Official", "common"],
    ["Base After Base", "RobTop", "Official", "common"],
    ["Cant Let Go", "RobTop", "Official", "uncommon"],
    ["Jumper", "RobTop", "Official", "uncommon"],
    ["Time Machine", "RobTop", "Official", "uncommon"],
    ["Cycles", "RobTop", "Official", "uncommon"],
    ["xStep", "RobTop", "Official", "uncommon"],
    ["Clutterfunk", "RobTop", "Official", "rare"],
    ["Theory of Everything", "RobTop", "Official", "rare"],
    ["Electroman Adventures", "RobTop", "Official", "rare"],
    ["Electrodynamix", "RobTop", "Official", "rare"],
    ["Hexagon Force", "RobTop", "Official", "rare"],
    ["Blast Processing", "RobTop", "Official", "epic"],
    ["Geometrical Dominator", "RobTop", "Official", "epic"],
    ["Fingerdash", "RobTop", "Official", "epic"],
    ["Dash", "RobTop", "Official", "legendary"],
    ["The Seven Seas", "RobTop", "Official", "common"],
    ["Viking Arena", "RobTop", "Official", "common"],
    ["Airborne Robots", "RobTop", "Official", "uncommon"],
    ["Press Start", "RobTop", "Official", "common"],
    ["Nock Em", "RobTop", "Official", "uncommon"],
    ["Power Trip", "RobTop", "Official", "rare"],

    // Easy demons
    ["Theory of Everything 2", "RobTop", "Easy", "uncommon"],
    ["The Nightmare", "Jax", "Easy", "common"],
    ["Problematic", "Dhafin", "Easy", "common"],
    ["The Lightning Road", "timeless real", "Easy", "uncommon"],

    // Medium demons
    ["Clubstep", "RobTop", "Medium", "uncommon"],
    ["Deadlocked", "RobTop", "Medium", "rare"],
    ["Supersonic", "ZenthicAlpha", "Medium", "uncommon"],

    // Hard demons
    ["Jawbreaker", "ZenthicAlpha", "Hard", "rare"],
    ["Nine Circles", "Zobros", "Hard", "rare"],
    ["Xo", "KrmaL", "Hard", "rare"],

    // Insane demons
    ["Plasma Pulse", "Smokes", "Insane", "rare"],

    // Extreme demons
    ["Cataclysm", "Ggb0y", "Extreme", "rare"],
    ["Change of Scene", "Bianox", "Extreme", "rare"],
    ["Bloodbath", "Riot", "Extreme", "epic"],
    ["Sonic Wave", "Cyclic", "Extreme", "epic"],
    ["Yatagarasu", "TrusTa", "Extreme", "epic"],
    ["Kenos", "Bianox", "Extreme", "epic"],
    ["Zodiac", "Bianox", "Extreme", "epic"],
    ["Erebus", "Bo", "Extreme", "epic"],
    ["Sakupen Circles", "Diamond", "Extreme", "epic"],
    ["Bloodlust", "Knobbelboy", "Extreme", "epic"],
    ["Windy Landscape", "WOOGI1411", "Extreme", "epic"],
    ["Limbo", "MindCap", "Extreme", "epic"],
    ["Artificial Ascent", "Viprin", "Extreme", "epic"],
    ["Plasma Pulse Finale", "Smokes", "Extreme", "epic"],
    ["Allegiance", "Nikroplays", "Extreme", "epic"],
    ["The Golden", "Bo", "Extreme", "legendary"],
    ["Tartarus", "Dolphy", "Extreme", "legendary"],
    ["Acheron", "ryamu", "Extreme", "legendary"],
    ["Slaughterhouse", "icedcave", "Extreme", "legendary"],
    ["Abyss of Darkness", "Exen", "Extreme", "legendary"],
    ["Avernus", "PockeWindfish", "Extreme", "legendary"],
    ["Firework", "Trick", "Extreme", "legendary"],
    ["Kocmoc", "Luqualizer", "Extreme", "legendary"],
    ["Acu", "Neigefeu", "Extreme", "legendary"],
    ["Silent Clubstep", "TheRealSailent", "Extreme", "mythic"],
    ["Tidal Wave", "OniLink", "Extreme", "mythic"],
  ];

  function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  const CARDS = RAW.map(([name, creator, set, rarity]) => ({
    id: slug(name), name, creator, set, rarity, custom: false,
  }));

  const PACKS = [
    {
      id: "demon", name: "Demon Pack", description: "Demons of every difficulty.",
      size: 5, price: 100, colors: ["#ff3e6c", "#7a1fff"],
      sets: ["Easy", "Medium", "Hard", "Insane", "Extreme"],
      odds: { common: 52, uncommon: 29, rare: 14.5, epic: 4, legendary: 0.4, mythic: 0.1 },
    },
    {
      id: "classic", name: "Classic Pack", description: "RobTop's official levels.",
      size: 5, price: 30, colors: ["#3ee8ff", "#2b5cff"],
      sets: ["Official"],
      odds: { common: 52, uncommon: 29, rare: 14.5, epic: 4, legendary: 0.5, mythic: 0 },
    },
    {
      id: "easy-medium", name: "Easy & Medium", description: "A gentle start.",
      size: 5, price: 50, colors: ["#4fd17a", "#ffd23e"],
      sets: ["Easy", "Medium"],
      odds: { common: 52, uncommon: 29, rare: 14.5, epic: 4, legendary: 0.4, mythic: 0.1 },
    },
    {
      id: "hard-insane", name: "Hard & Insane", description: "Getting serious.",
      size: 5, price: 75, colors: ["#ff8a3e", "#ff4fb3"],
      sets: ["Hard", "Insane"],
      odds: { common: 52, uncommon: 29, rare: 14.5, epic: 4, legendary: 0.4, mythic: 0.1 },
    },
    {
      id: "extreme", name: "Extreme Pack", description: "Only the hardest demons.",
      size: 5, price: 200, colors: ["#ff3e3e", "#1a0b2e"],
      sets: ["Extreme"],
      odds: { common: 45.06, uncommon: 31, rare: 17.2, epic: 6, legendary: 0.7, mythic: 0.04 },
    },
  ];

  const ECONOMY = {
    startOrbs: 500,
    perHour: 60,       // passive orbs per hour
    cap: 600,          // max pending passive orbs
    dailyBase: 100,
    dailyPerStreak: 20,
    dailyMax: 300,
  };

  return { RARITIES, RARITY_INFO, SETS, SET_ORDER, MODIFIERS, CARDS, PACKS, ECONOMY };
})();
