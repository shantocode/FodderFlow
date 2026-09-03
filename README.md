# ⚡ Fodder Flow

> An advanced Chrome extension for solving **Squad Building Challenges (SBCs)** in the EA SPORTS FC 26 Web App.

Fodder Flow is a browser extension designed to automate and optimize SBC squad building. It analyzes available players, SBC requirements, chemistry, ratings, player types, and other constraints to find valid and efficient solutions.

The project includes a custom constraint-based solver, chemistry calculation engine, EA Web App integration, FUT.GG player/price data integration, and support for solving complex SBC requirements.

---

## ✨ Features

### 🧩 Intelligent SBC Solver

Fodder Flow analyzes SBC requirements and builds squads that satisfy the required constraints.

Supported requirement types include:

* Squad size
* Squad rating
* Player quality
* Player rarity
* Rarity groups
* Nation requirements
* League requirements
* Club requirements
* Same nation requirements
* Same league requirements
* Same club requirements
* Minimum/maximum/exact overall rating
* First-owner requirements
* Tradability requirements
* TOTW requirements
* TOTS requirements
* TOTW/TOTS combinations
* Inform requirements
* Loan player requirements
* Legend requirements
* Trophy requirements
* Chemistry requirements
* Player level requirements
* And more

The solver also normalizes multiple variations of SBC requirement formats into a common internal representation.

---

## 🧪 Chemistry Engine

The extension contains a dedicated chemistry calculation system.

It evaluates:

* Club chemistry
* League chemistry
* Nation chemistry
* Player chemistry
* On-position players
* Position compatibility
* Total squad chemistry
* Minimum player chemistry

The chemistry system also determines the best possible player-to-position assignment instead of simply assuming players occupy their original positions.

This allows the solver to handle more complicated chemistry-based SBCs.

---

## 🔄 Sequence Solver

Fodder Flow supports solving multiple SBCs as a sequence.

You can:

* Create sequence plans
* Run SBCs in order
* Loop complete plans
* Loop individual steps
* Track execution progress
* Review completed challenges
* See which players were used for each challenge
* Handle complex chemistry requirements across multiple challenges

This is particularly useful for SBC groups where completing one challenge changes the available player pool for the next.

---

## 💰 Player Pricing

Fodder Flow can retrieve player price information from FUT.GG.

The extension includes:

* Player price fetching
* Batched requests
* Price caching
* Request throttling
* Retry handling
* Request timeouts
* Large player-ID handling

Price data can be used to help the solver make more efficient squad selections.

---

## 👥 Player Data

The extension can retrieve player information from FUT.GG, including data used for filtering and solving.

Supported filters include:

* Club
* League
* Nation
* Overall rating
* Price
* Rarity

Player fetching is rate-limited and cached to reduce unnecessary requests.

---

## 🎛️ Player Controls

Fodder Flow provides controls for determining which players the solver can use.

Depending on the configuration, players can be:

* Allowed
* Excluded
* Added as extra candidates
* Limited by club
* Limited by league
* Limited by nation
* Limited by card type
* Limited by rating

Local exclusions can also be configured for individual SBC solves without changing global settings.

---

## 🃏 Card Type Controls

The solver provides control over which card types can be used.

This includes dedicated handling for special card requirements such as:

* TOTW
* TOTS
* Special cards
* Rarity groups
* Inform cards
* Legends

This makes it easier to prevent the solver from unnecessarily consuming valuable cards.

---

## 🌐 EA SPORTS FC Web App Integration

Fodder Flow integrates directly with the EA SPORTS FC Ultimate Team Web App.

The extension communicates with the Web App through:

```text
Chrome Extension
       │
       ├── Content Script
       │
       ├── Background Service Worker
       │
       └── EA Page Data Bridge
                  │
                  ▼
          EA SPORTS FC Web App
```

The extension only allows its page bridge to be injected into supported EA FC Web App pages.

---

## 🏗️ Architecture

```text
Fodder Flow
│
├── background.js
│   ├── Extension service worker
│   ├── Solver bridge
│   ├── EA page bridge injection
│   ├── FUT.GG API communication
│   ├── Price caching
│   └── Update checking
│
├── content-script.js
│   ├── EA Web App integration
│   ├── Page communication
│   ├── Extension metadata
│   └── UI/update handling
│
├── page/
│   ├── ea-data-bridge.js
│   └── ea-data-bridge.css
│
├── solver/
│   ├── solver.js
│   ├── chemistry.js
│   ├── constraint-compiler.js
│   ├── worker.js
│   ├── glpk.js
│   └── glpk.wasm
│
├── data/
│   └── changelog.json
│
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

---

## 🧠 Solver Architecture

The solver is separated into several components.

### Constraint Compiler

`solver/constraint-compiler.js`

Converts different SBC requirement formats into normalized constraints that the solver can understand.

Examples:

```text
PLAYER_COUNT
PLAYER_COUNT_COMBINED
TEAM_STAR_RATING
NATION_COUNT
LEAGUE_COUNT
CLUB_COUNT
CHEMISTRY_POINTS
PLAYER_MIN_OVR
PLAYER_MAX_OVR
```

These are normalized into internal requirement types.

---

### Chemistry

`solver/chemistry.js`

Responsible for calculating chemistry and determining valid player-position assignments.

It evaluates the squad based on:

```text
Club
League
Nation
Position
```

and calculates:

```text
Total Chemistry
Minimum Chemistry
Per-player Chemistry
Position compatibility
```

---

### Solver

`solver/solver.js`

Builds the solver context, processes player pools and constraints, and searches for valid SBC solutions.

---

### GLPK

The project includes:

```text
solver/glpk.js
solver/glpk.wasm
```

GLPK provides mathematical optimization capabilities used by the solver.

---

## 🔐 Permissions

The extension uses Chrome Manifest V3.

Required permissions:

```text
storage
scripting
alarms
tabs
```

Host permissions include:

```text
https://www.fut.gg/*
https://raw.githubusercontent.com/*
```

The extension's content script runs on the EA SPORTS FC Ultimate Team Web App.

---

## 📦 Installation

### Chrome / Chromium

1. Download or clone the repository.

```bash
git clone <repository-url>
```

2. Open Chrome.
3. Navigate to:

```text
chrome://extensions/
```

4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the Fodder Flow project directory.
7. Open the EA SPORTS FC Ultimate Team Web App.
8. The extension should initialize automatically.

---

## 🛠️ Development

This project is a browser extension and does not require a traditional Node.js build step for its core runtime.

The extension is based on:

* JavaScript
* Chrome Manifest V3
* Web Workers
* WebAssembly
* GLPK
* EA Web App page integration
* FUT.GG data APIs

The main solver components can be modified directly inside the `solver/` directory.

---

## 🐛 Debugging

To inspect the extension background service worker:

1. Open:

```text
chrome://extensions/
```

2. Find **Fodder Flow**.
3. Click **Service worker**.

For page-level debugging, open the EA FC Web App and use Chrome DevTools.

Useful console prefixes include:

```text
[EA Data]
```

These can help identify:

* Solver errors
* Bridge errors
* API failures
* Update-checking issues
* Extension initialization problems

---

## 🔄 Updates

The extension contains an update-checking system and maintains release information in:

```text
data/changelog.json
```

The changelog records:

* Version
* Release date
* Headline
* Summary
* Detailed changes

---

## 📋 Recent Changes

### v1.10 — May 15, 2026

* Added solved squad player pricing.
* Improved solver efficiency.
* Reduced unnecessary high-rated player usage.
* Added card-type controls to Single Solver.
* Added card-type controls to Multi Solver.
* Added card-type controls to Sequence Solver.

### v1.9.3 — May 8, 2026

* Added Review Before Submit mode.
* Improved Sequence Solver handling of complex chemistry challenges.

### v1.9.2 — April 25, 2026

* Improved player fetching performance.
* Reduced fetching time.
* Improved solver logic.

### v1.9.1 — April 19, 2026

* Improved TOTS requirement detection.
* Improved club-player handling.
* Added quick source-code access from global settings.

### v1.9 — April 18, 2026

* Improved SBC solving reliability.
* Fixed SBC Storage handling.
* Fixed Use Unassigned handling.
* Project officially became open source.

---

## ⚠️ Disclaimer

Fodder Flow is an independent community project and is not affiliated with, endorsed by, or sponsored by EA SPORTS or Electronic Arts.

Use the extension at your own risk.

Automating interactions with online services may be subject to their terms of service. Users are responsible for ensuring that their use of the extension complies with applicable rules and policies.

---

## 🤝 Contributing

Contributions are welcome.

Before submitting a pull request:

1. Check existing issues.
2. Test your changes against the EA FC Web App.
3. Make sure existing solver functionality still works.
4. Keep solver changes isolated and understandable.
5. Update documentation when adding significant functionality.

For bugs, please provide:

* Chrome version
* Extension version
* EA FC Web App state
* SBC being solved
* Console errors
* Steps to reproduce the issue

---

## 👨‍💻 Made By

Fodder Flow is made by:

* **[Shanto](https://github.com/shantocode)**
* **[Zenitsu](https://github.com/samratdas5703)**

Built with ❤️ by **[Shanto](https://github.com/shantocode) & [Zenitsu](https://github.com/samratdas5703)**.

---

## 📄 License

Fodder Flow is released under the **GNU General Public License v3.0**.

See [`LICENSE`](LICENSE) for the complete license.

---

## ⭐ Project

If you find Fodder Flow useful, consider starring the repository and contributing improvements.

**Fodder Flow — smarter SBC solving, better fodder management.**

### 👨‍💻 Shanto & Zenitsu

**[Shanto](https://github.com/shantocode)** • **[Zenitsu](https://github.com/samratdas5703)**

Made with ❤️ for the FC community.
