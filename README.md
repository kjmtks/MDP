# ![MDP Screenshot](public/favicon/favicon-32x32.png) MDP (Markdown Presentation Tool)

A powerful, dual-environment editor for creating presentations using Markdown.
MDP allows you to write in Markdown, seamlessly insert diagrams, and present your slides with built-in presenter tools—available as both a native desktop application and a web app.

## ✨ Features

- **Markdown-Driven Slides**: Create clean and beautiful slides using standard Markdown syntax.
- **Live Preview & Split Pane**: Edit your Markdown on the upper pane and see the real-time slide preview on the lower pane.
- **Built-in Draw.io Integration**: Easily insert, edit, and save Draw.io diagrams directly within the editor.
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

## ⌨️ Shortcuts (Presenter Mode)

| Key | Action |
| :--- | :--- |
| `Right` / `Down` / `Space` | Next Slide |
| `Left` / `Up` | Previous Slide |
| `P` | Toggle Pen / View mode |
| `C` | Clear all drawings on current slide |
| `N` | Insert a blank slide |
| `Ctrl+Z` / `Cmd+Z` | Undo drawing |
| `Ctrl+Y` / `Cmd+Y` | Redo drawing |

## 📄 License

This project is licensed under the MIT License.