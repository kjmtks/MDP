# ![MDP Screenshot](public/favicon/favicon-32x32.png) MDP (Markdown Presentation Tool)

A powerful, dual-environment editor for creating presentations using Markdown.
MDP allows you to write in Markdown, seamlessly insert diagrams, and present your slides with built-in presenter tools—available as both a native desktop application and a web app.

## ✨ Features

- **Markdown-Driven Slides**: Create clean and beautiful slides using standard Markdown syntax.
- **Live Preview & Split Pane**: Edit your Markdown on the upper pane and see the real-time slide preview on the lower pane.
- **Built-in Draw.io Integration**: Easily insert, edit, and save Draw.io diagrams directly within the editor.
- **Slide Hyperlinks & History**: Link to any page — in this deck or another — and step back/forward through your jumps like a browser, for non-linear presentations.
- **Workspace Slide Search**: Find any slide across all decks by title, subtitle, tag, or full text — and exclude folders from the search with a `.mdpignore` file.
- **Advanced Presenter Mode**: 
  - Dual-screen setup (Presenter view & Audience view).
  - Built-in timer and next-slide preview.
  - Interactive drawing tools (Pen, Laser Pointer, Eraser) with undo/redo support.
- **Customization**: Support for custom themes, templates, and text snippets.
- **Dark Theme**: Professional, VS Code-like dark UI optimized for long editing sessions.
- **Export**: Export your presentation to PDF format.
- **Cross-Platform**: Run it as a standalone desktop app (Electron) or host it as a web application.

## 🚀 Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (v20 or v22 LTS recommended) installed on your machine.

### Installation

Clone the repository and install dependencies:

```sh
git clone https://github.com/kjmtks/MDP.git
cd MDP
npm install
```

---

### 💻 Electron Application (Desktop)

Run the application as a standalone desktop executable:

```sh
npm run electron:build
```

---

### 🌐 Web Application (Browser)

Run the application as a web server:

```sh
npm run build
npm run start
```

After the server starts, open the following URL in your browser: http://localhost:3000

## 🔗 Slide Hyperlinks & Navigation History

Turn a deck into an interactive, non-linear presentation: use standard Markdown links to jump to a specific page — in the same deck or another one — and step back through your jumps like a web browser.

**Link targets** — write them as a normal Markdown link `[text](target)`:

| Example | Jumps to |
| :--- | :--- |
| `[Details](#5)` | Page 5 of the current deck |
| `[Intro](#intro)` | The slide tagged `<!-- @id intro -->` |
| `[Appendix](appendix.slide.md)` | Another deck (its first page) |
| `[Q3](appendix.slide.md#3)` | Another deck, page 3 |
| `[Method](appendix.slide.md#intro)` | Another deck, the `#intro` anchor |

- **Anchors**: add `<!-- @id NAME -->` to a slide to give it a stable name that survives slide reordering. `NAME` is unique within the deck (letters, digits, `-`, `_`).
- **Other-deck paths** are resolved relative to the current deck's folder (e.g. `../shared/refs.slide.md#2`).
- **History**: following a link records where you came from. **Back / Forward** (`Alt + ←` / `Alt + →`, or the on-screen buttons next to the slide counter) return you to the previous page — across decks too. Normal next/previous navigation is unaffected.
- **Works everywhere**: the editor preview, the fullscreen slideshow, the Presenter view, and the Remote display (tap the link on the mirrored slide). External `http(s)://` links open in your browser.

> The **Back / Forward** keys are remappable in **Settings → Shortcuts**.

## 🔍 Slide Search & `.mdpignore`

Search every deck in your workspace at once from the search box in the sidebar — by **title**, **subtitle**, **`@tags`**, or **full slide text**. Results are ranked across all `*.slide.md` files and jump straight to the matching page.

### Excluding folders from search

Drop an empty file named **`.mdpignore`** into any folder to keep that folder — and everything beneath it — **out of the slide search index**. The folder stays fully visible in the file tree, and its files can still be opened and referenced (as images or link targets); only slide *search / indexing* skips it.

```
my-workspace/
├─ talk.slide.md           ← searched
├─ archive/
│  ├─ .mdpignore           ← excludes this folder…
│  └─ old-2023.slide.md    ← …so this deck is NOT searched
└─ assets/
   └─ chart.png            ← still referenceable from any slide
```

- **Presence-based** (like `.gitignore`): the file's contents are ignored — an empty file is enough.
- After adding or removing a `.mdpignore`, **refresh the file tree** (the refresh button in the file-tree header) for the change to take effect.
- Place it in a sub-folder, not the workspace root (a root `.mdpignore` is not applied — it would exclude everything).

## ⌨️ Shortcuts (Presenter Mode)

| Key | Action |
| :--- | :--- |
| `Right` / `Down` / `Space` | Next Slide |
| `Left` / `Up` | Previous Slide |
| `Alt + Left` | Navigate back (hyperlink history) |
| `Alt + Right` | Navigate forward (hyperlink history) |
| `P` | Toggle Pen / View mode |
| `C` | Clear all drawings on current slide |
| `N` | Insert a blank slide |
| `Ctrl+Z` / `Cmd+Z` | Undo drawing |
| `Ctrl+Y` / `Cmd+Y` | Redo drawing |

## 📄 License

This project is licensed under the MIT License.