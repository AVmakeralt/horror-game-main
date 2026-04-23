# 🎮 Horror Game - A Fully Moddable Horror Experience

A comprehensive horror game featuring 30 unique rooms, advanced modding capabilities, reproducibility features for research, and stunning atmospheric visuals.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [How to Play](#how-to-play)
- [Console Commands](#console-commands)
- [Map Creator](#map-creator)
- [Modding System](#modding-system)
- [Reproducibility & Research](#reproducibility--research)
- [Art & Visuals](#art--visuals)
- [Technical Details](#technical-details)
- [Contributing](#contributing)

## 🎭 Overview

This is a sophisticated horror game built with JavaScript and HTML5 Canvas. You play as a character navigating through 30 unique, terrifying rooms while being stalked by an AI-driven entity. The game features advanced systems for modding, research reproducibility, and procedural content generation.

### Key Highlights

- **30 Unique Rooms**: Each with distinct layouts, hazards, and atmospheres
- **200+ Console Commands**: Full control over game state for debugging and experimentation
- **Advanced Modding**: Create and load custom mods to extend the game
- **Reproducibility**: Seed control, version locking, and deterministic logging
- **Enhanced Visuals**: Dynamic lighting, particle effects, and atmospheric rendering
- **AI Stalker**: Intelligent enemy with predictive pathfinding and sensory systems

## ✨ Features

### Core Gameplay

- **Tile-based Movement**: Navigate through 28x10 grid rooms
- **Hide Mechanic**: Hide from the stalker in designated spots
- **Resource Management**: Use flashlight, tape, candy, mirror shards, and key crayons
- **Transformation System**: Suffer various effects like control inversion, speed reduction, and hallucinations
- **Key Collection**: Find 8 keys across 30 zones to unlock the final exit
- **Chess Mini-game**: Play chess against Stockfish AI in certain rooms

### 30 Unique Zones

| Zone | Name | Description |
|------|------|-------------|
| 0 | Entrance Hall | Where the nightmare begins |
| 1 | Corridor | Endless passages |
| 2 | Living Room | Familiar yet wrong |
| 3 | Bathroom | Reflective surfaces hide secrets |
| 4 | Kitchen | Abandoned meal preparations |
| 5 | Storage | Cluttered with memories |
| 6 | Library | Books hold dark secrets |
| 7 | Bedroom | Sleep is not safe here |
| 8 | Laundry | Clean clothes, dirty secrets |
| 9 | Attic | Dust and whispers |
| 10 | Basement | Foundation of fear |
| 11 | Backyard | Nature reclaiming |
| 12 | Greenhouse | Plants that watch |
| 13 | Garage | Tools of the trade |
| 14 | Wine Cellar | Vintage dread |
| 15 | Chapel | Sacred space corrupted |
| 16 | Dungeon | Cold stone and chains |
| 17 | Observatory | Stars that judge |
| 18 | Nursery | Children's laughter echoes |
| 19 | Ballroom | Dance with death |
| 20 | Laboratory | Experiments gone wrong |
| 21 | Catacombs | Restless remains |
| 22 | Clock Tower | Time is running out |
| 23 | Fountain Room | Water that remembers |
| 24 | Armory | Weapons against the dark |
| 25 | Overgrown Garden | Nature's revenge |
| 26 | Hall of Mirrors | Infinite reflections |
| 27 | Ice Cave | Frozen in fear |
| 28 | Research Chamber | Lab-home hybrid |
| 29 | The Void | Nothing and everything |

### Hazards & Features

- **Flickering Lights**: Unpredictable darkness
- **Migration**: Rooms that shift and change
- **Locked Doors**: Barriers to progress
- **Collapsing Floors**: Environmental dangers
- **Phantoms**: Ghostly apparitions
- **Acid Pools**: Chemical hazards
- **Ritual Circles**: Supernatural phenomena
- **Mirror Loops**: Disorienting reflections
- **Fake Exits**: Deceptive escape routes

## 🚀 Installation

### Requirements

- Modern web browser (Chrome, Firefox, Edge, Safari)
- JavaScript enabled
- HTML5 Canvas support

### Setup

1. Clone or download the repository
2. Open `src/index.html` in your browser
3. Press Enter to start the game

```bash
git clone https://github.com/yourusername/horror-game.git
cd horror-game/src
# Open index.html in browser
```

### Optional: Stockfish Integration

For the chess mini-game, load Stockfish:

```javascript
const stockfishScript = document.createElement('script');
stockfishScript.src = "https://cdn.jsdelivr.net/npm/stockfish/src/stockfish.js";
document.head.appendChild(stockfishScript);
```

## 🎮 How to Play

### Controls

| Key | Action |
|-----|--------|
| `W/A/S/D` or `Arrow Keys` | Move character |
| `H` | Hide (when near hiding spots) |
| `E` | Interact with objects |
| `Shift` | Run (if not transformed) |
| `1-5` | Use tools |
| `Tab` | Open console |

### Objectives

1. **Navigate through 30 zones** while avoiding the stalker
2. **Collect 8 keys** hidden throughout the zones
3. **Use tools wisely** to survive encounters
4. **Find the true exit** (avoid fake exits!)
5. **Survive** with limited deaths

### Tips

- Listen for audio cues - the stalker makes noise
- Watch for visual flickers - they signal danger
- Use hiding spots strategically
- Manage your transformation burden
- Collect notes for lore and hints
- Mirrors can be deceptive - some loop endlessly

## ⌨️ Console Commands

The game features 200+ console commands accessible by pressing `Tab`. Commands are categorized by function:

### Basic Commands
```
help                    - Show all commands
freeze                  - Pause game
unfreeze / resume       - Resume game
pause                   - Toggle pause
```

### Player Commands
```
player speed <value>    - Set player speed
player hide             - Force hide
player unhide           - Force unhide
player position         - Get coordinates
player facing           - Get direction
player reset            - Reset player state
player invincible <on/off>
player visible <on/off>
```

### Stalker Commands
```
stalker speed <value>   - Set AI speed
stalker position        - Get stalker coordinates
stalker freeze          - Stop AI
stalker unfreeze        - Resume AI
stalker reset           - Reset AI state
stalker visible <on/off>
stalker aggressive <on/off>
```

### Teleport Commands
```
teleport player <x> <y>
teleport stalker <x> <y>
teleport object <fromX> <fromY> <toX> <toY>
```

### Map Commands
```
map reset               - Reset current map
map clear               - Clear all tiles
map fill <tile>         - Fill with tile type
map zone <index>        - Jump to zone
map list                - List all zones
map current             - Show current zone
map export              - Export map data
map import <data>       - Import map data
map create <template>   - Create from template
map load <layout>       - Load custom layout
map tile <x> <y> <type>
map save <name>         - Save map
```

### Editor Commands
```
editor template <name>  - Load template
editor list-templates   - Show templates
editor load <name>      - Load saved map
editor save <name>      - Save current
editor tile <x> <y> <char>
editor clear            - Clear custom maps
```

### Item Commands
```
item give <item>        - Add item
item remove <item>      - Remove item
item list               - List items
item clear              - Clear inventory
item flashlight
item tape
item candy
item mirrorshard
item keycrayon
```

### Zone Commands
```
zone goto <index>       - Jump to zone
zone list               - List zones
zone info <index>       - Zone details
zone unlock <index>
zone lock <index>
zone skip               - Next zone
zone reset              - Reset current
zone complete           - Mark complete
```

### Transform Commands
```
transform add <type>    - Add transformation
transform remove <type> - Remove transformation
transform list          - List active
transform clear         - Clear all
transform status
transform inversion <on/off>
transform speed <value>
```

### Visual Commands
```
visual light <mode>     - Set light mode
visual flicker <on/off>
visual hud <on/off>
visual particles <on/off>
visual shake <intensity>
visual flash <duration>
```

### AI Commands
```
ai speed <value>        - Set AI speed
ai sight <value>        - Set sight range
ai hearing <value>      - Set hearing range
ai predictive <on/off>
ai patrol <on/off>
ai chase <on/off>
```

### Door Commands
```
door open <x> <y>
door close <x> <y>
door lock <x> <y>
door unlock <x> <y>
door toggle <x> <y>
door all                - List all doors
```

### Hazard Commands
```
hazard add <x> <y> <type>
hazard remove <x> <y>
hazard list
hazard clear
hazard acid <x> <y>
hazard crack <x> <y>
hazard ritual <x> <y>
```

### Mirror Commands
```
mirror loop <x> <y> <targetX> <targetY>
mirror normal <x> <y>
mirror fake <x> <y>
mirror lure <on/off>
mirror clone <on/off>
```

### Debug Commands
```
debug mode <on/off>
debug showhitbox <on/off>
debug showpath <on/off>
debug showvision <on/off>
debug log <message>
debug trace <on/off>
```

### Time Commands
```
time scale <value>      - Game speed
time freeze
time normal
time tick <amount>
time skip <seconds>
```

### Save Commands
```
save                    - Save game
load                    - Load game
clearsave               - Delete save
autosave <on/off>
snapshot create
snapshot load
snapshot clear
```

### Audio Commands
```
audio volume <value>
audio mute <on/off>
audio distortion <value>
audio reset
```

### Chess Commands
```
chess open
chess close
chess reset
chess move <from> <to>
chess status
```

### Bot Commands
```
bot status
bot enable
bot disable
bot input
bot clear
```

### Reproducibility Commands
```
seed set <value>        - Set RNG seed
seed get                - Get current seed
seed reset              - Reset RNG
seed deterministic <on/off>
seed random             - Random seed

version lock            - Lock version
version unlock
version info

snapshot take <name>    - Save config
snapshot restore <name> - Load config
snapshot list           - List snapshots
snapshot delete <name>
snapshot clear

log enable
log disable
log export <category>
log clear
log tick <start> <end>
```

### Mod Commands
```
mod load <code>         - Load mod from code
mod load-file <file>    - Load from file
mod unload <name>       - Unload mod
mod list                - List mods
mod info <name>         - Mod details
mod enable <name>
mod disable <name>
mod reload-all          - Reload all
mod clear               - Clear all
mod register-command <name> <code>
```

## 🗺️ Map Creator

The game includes a powerful map creator system for designing custom rooms.

### Tile Types

| Char | ID | Name | Description |
|------|-----|------|-------------|
| 0 | 0 | Floor | Walkable surface |
| 1 | 1 | Wall | Impassable barrier |
| 2 | 2 | Hide Spot | Safe hiding place |
| 3 | 3 | Corruption (Ink) | Hazardous zone |
| 4 | 4 | Corruption | Spreading danger |
| 5 | 5 | Exit | True exit point |
| 6 | 6 | Moved Furniture | Obstacle |
| 7 | 7 | Collapse | Falling danger |
| 8 | 8 | Block/Tape | Temporary barrier |
| 9 | 9 | Locked | Requires key |
| a | 10 | Hallucination | Visual distortion |
| b | 11 | Mirror | Reflective surface |
| c | 12 | Safe | Reversal zone |
| d | 13 | Tiny Hazard | Minor danger |
| e | 14 | Door | Passageway |
| f | 15 | Drawer | Storage |
| g | 16 | Fake Exit | Deceptive exit |
| h | 17 | Note | Lore document |
| i | 18 | Acid Pool | Chemical hazard |
| j | 19 | Ritual Circle | Supernatural |
| k | 20 | Vent | Crawlspace |
| l | 21 | Static TV | Monitor |
| m | 22 | Cracked Floor | Fragile |
| n | 23 | Medicine Cabinet | Storage |
| o | 24 | Key | Collectible |

### Using Templates

```
console> editor template livingLab
```

Available templates:
- `livingLab` - Living room with lab equipment
- `kitchenLab` - Kitchen with chemical station
- `bedroomLab` - Bedroom with monitoring equipment
- `officeLab` - Office with terminals
- `storageLab` - Specimen storage

### Custom Layout Example

```
console> map load `
111111111111111111111111111111
1c00000000000000000000000000001
1f0000001100000000001100000000h1
10000000101000000010100000000101
10000000101000000010100000000101
10000000000000000000000000000101
1f0000001100000000001100000000h1
10000000101000000010100000000101
10000000101000000010100000000101
1c00000000000000000000000000001
111111111111111111111111111111
`
```

## 🧩 Modding System

Create custom mods to extend the game with new content.

### Creating a Mod

Create a JavaScript file in the `mods/` folder:

```javascript
// Register metadata
api.registerMetadata({
  name: "My Awesome Mod",
  version: "1.0.0",
  author: "Your Name",
  description: "Adds new zones and items",
  requiredGameVersion: "1.0.0",
  dependencies: [],
  conflicts: [],
  loadPriority: 0,
});

// Add a new zone
const zoneIndex = api.addZone({
  id: "my_zone",
  name: "Custom Zone",
  stalkerSpawn: { x: 26, y: 1 },
  ai: {
    speed: 2,
    sightRange: 7,
    hearingRange: 6,
    sightCone: Math.PI / 3.2,
    catchRadius: 1,
    predictive: true,
  },
  hazards: {
    flicker: true,
    migration: true,
  },
  entryText: "Welcome to my custom zone!",
});

// Add custom items
api.addItem("custom_item", {
  name: "Magic Crystal",
  description: "Glows with mysterious energy",
  stackable: true,
  maxStack: 5,
});

// Register console commands
api.registerCommand("custom-command", function() {
  return "Hello from my mod!";
}, "Description of command");

// Hook into events
api.on("zoneEnter", function(data) {
  api.log("ZONE", `Entered zone ${data.zoneIndex}`);
});

api.on("keyCollect", function(data) {
  api.log("KEY", "Collected a key!");
});
```

### Loading Mods

```
console> mod load `<paste mod code here>`
```

### Mod API Reference

| Method | Description |
|--------|-------------|
| `api.registerMetadata(data)` | Register mod info |
| `api.addZone(zoneData)` | Add new zone |
| `api.modifyZone(index, mods)` | Modify existing zone |
| `api.addItem(id, data)` | Add custom item |
| `api.addTileType(id, props)` | Add tile type |
| `api.on(event, callback)` | Register event hook |
| `api.trigger(event, data)` | Trigger event |
| `api.registerCommand(name, fn, desc)` | Add console command |
| `api.getGameState()` | Get state snapshot |
| `api.log(category, message, data)` | Log to game |

### Available Events

- `zoneEnter` - Player enters zone
- `zoneExit` - Player exits zone
- `keyCollect` - Key collected
- `death` - Player dies
- `transformAdd` - Transformation applied
- `transformRemove` - Transformation removed
- `stalkerSpotted` - Stalker sees player
- `hide` - Player hides
- `unhide` - Player unhides

## 🔬 Reproducibility & Research

This game includes enterprise-grade reproducibility features for research, testing, and fair comparison.

### Seeded Random Number Generation

Control randomness for deterministic behavior:

```
console> seed set 12345
console> seed deterministic on
```

### Version Locking

Lock game version to prevent version drift:

```
console> version lock
console> version info
```

### Configuration Snapshots

Save and restore exact game states:

```
console> snapshot take baseline_run
console> snapshot restore baseline_run
console> snapshot list
```

Snapshots include:
- Zone configuration
- AI parameters
- Tool states
- Transformation states
- Scores and progress
- RNG seed

### Deterministic Logging

Log events with tick precision for analysis:

```
console> log enable
console> log export AI
console> log tick 0 1000
```

Log categories:
- `SEED` - RNG events
- `VERSION` - Version changes
- `SNAPSHOT` - Snapshot operations
- `AI` - AI decisions
- `PLAYER` - Player actions
- `TRANSFORM` - Transformation events
- `ZONE` - Zone transitions
- `MOD` - Mod events

### Use Cases

- **Research**: Controlled experiments with exact reproducibility
- **Testing**: Deterministic test scenarios
- **Speedrunning**: Fair comparison across runs
- **Debugging**: Exact state restoration for bug reproduction
- **Bot Training**: Consistent environments for AI training

## 🎨 Art & Visuals

The game features an advanced art system with dynamic lighting and atmospheric effects.

### Visual Features

- **Gradient Lighting**: Walls and floors with atmospheric depth
- **Dynamic Shadows**: Real-time shadow casting
- **Particle Effects**: Dust, bubbles, and ambient particles
- **Animated Tiles**: Acid bubbling, ritual pulsing, mirror shimmer
- **Flashlight System**: Player-controlled light with flicker
- **Vignette Effects**: Corner darkening for atmosphere
- **Exit Glow**: Pulsing green light on true exits

### Rendering Pipeline

1. Background room styling
2. Tile rendering with gradients
3. Entity sprites (player, stalker)
4. Particle effects
5. Lighting overlay (multiply blend)
6. HUD elements

### Performance

- Canvas 2D rendering with optimized draw calls
- Particle pooling for efficiency
- Conditional rendering based on visibility
- Frame-rate independent animations

## 🔧 Technical Details

### Architecture

```
horror-game/
├── src/
│   ├── engine.js          # Core game logic
│   ├── player.js          # Player controller
│   ├── enemy.js           # Stalker AI
│   ├── transform.js       # Transformation system
│   ├── art-system.js      # Visual rendering
│   ├── mod-system.js      # Modding framework
│   ├── console-commands.js # 200+ commands
│   ├── number-grid-sprites.js # Procedural sprites
│   └── index.html         # Entry point
├── mods/
│   └── example-mod.js     # Example mod template
└── assets/                # Sprite sheets (optional)
```

### Game Loop

```
Input → Update → Render → Repeat
  ↓        ↓        ↓
Keys    Logic    Canvas
        Physics  Lighting
        AI       Particles
```

### State Management

Centralized state object containing:
- Player position and status
- Stalker AI state
- Current zone and map
- Inventory and tools
- Transformations
- Scores and statistics
- Reproducibility data

### AI System

The stalker uses a sophisticated AI with:
- **Sensory Perception**: Sight and hearing
- **Memory System**: Recent noise locations
- **Patrol Nodes**: Predefined routes
- **Predictive Pathfinding**: Anticipates player movement
- **Hallucination Interference**: Affected by player transformations

### Tile System

28x10 grid with 25 tile types:
- Passable (floor, hide spots)
- Impassable (walls, furniture)
- Interactive (doors, drawers)
- Hazardous (acid, cracks)
- Special (mirrors, exits)

## 🤝 Contributing

### Development Setup

1. Fork the repository
2. Make your changes
3. Test thoroughly
4. Submit a pull request

### Code Style

- Use ES6+ features
- Comment complex logic
- Follow existing patterns
- Test console commands
- Verify reproducibility features

### Adding Features

1. **New Zones**: Add to `ZONES` array in `engine.js`
2. **New Tiles**: Extend `drawTile()` function
3. **New Commands**: Add to `console-commands.js`
4. **New Mod APIs**: Extend `mod-system.js`
5. **Visual Effects**: Add to `art-system.js`

### Testing Checklist

- [ ] Console commands work
- [ ] Mods load correctly
- [ ] Seeds produce deterministic results
- [ ] Snapshots restore correctly
- [ ] All 30 zones load
- [ ] AI behaves correctly
- [ ] No console errors

## 📜 License

MIT License - Feel free to use, modify, and distribute.

## 🙏 Acknowledgments

- Stockfish for chess AI
- Number-grid sprites technique
- Horror game community for inspiration

## 🐛 Troubleshooting

### Game won't start
- Check browser console for errors
- Verify JavaScript is enabled
- Try a different browser

### Console not working
- Press `Tab` to toggle
- Check that game has focus
- Verify no input fields are active

### Mods not loading
- Check mod code for syntax errors
- Verify metadata is registered
- Check version compatibility

### Performance issues
- Reduce particle count
- Disable lighting effects
- Close other browser tabs

## 📞 Support

For issues, questions, or contributions:
- Open an issue on GitHub
- Check existing documentation
- Review example mods

---

**Enjoy the horror!** 👻

*Remember: The stalker is always watching...*
