# P2P Web Share

A lightweight, decentralized peer-to-peer file sharing web application that enables direct browser-to-browser file transfers with end-to-end encryption. No file data ever touches the server.

## Demo Video
[Watch Demo Video](https://drive.google.com/file/d/1wP82jfo1fgsoZL5Ch24rKV3kVmzNesxy/view?usp=sharing)

## Live Demo
- Frontend: https://p2p-web-share-ten.vercel.app
- Backend: https://p2p-web-share-bx12.onrender.com

## Features

### Core MVP
- Drag-and-drop file upload with unique room ID generation
- Direct P2P file transfer via WebRTC Data Channels
- Node.js + Socket.io signaling server (coordinates handshake only)
- SHA-256 chunk verification for zero data corruption
- Real-time progress bar, transfer speed (MB/s), and connection status
- Graceful disconnect handling with user notification
- Auto-download on receiver side after verification

### Brownie Points
- Zero-Knowledge Encryption — AES-256-GCM encryption in the browser, key passed via URL hash, server never sees it
- Large File Support (500MB+) — Uses Origin Private File System (OPFS) to write chunks directly to disk instead of RAM

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React.js + Tailwind CSS |
| P2P Communication | WebRTC API (RTCPeerConnection + DataChannel) |
| Backend Signaling | Node.js + Express.js + Socket.io |
| Encryption | Web Crypto API (AES-256-GCM) |
| Large File Storage | Origin Private File System (OPFS) |
| Frontend Hosting | Vercel |
| Backend Hosting | Render |

## How It Works

1. Sender drops a file and generates a unique room link with encryption key in URL hash
2. Receiver opens the link and joins the room
3. Signaling server brokers WebRTC handshake (offer/answer/ICE)
4. Direct P2P connection established — server is no longer involved
5. File is encrypted, chunked, and sent directly to receiver
6. Receiver decrypts chunks, verifies SHA-256 hash, and auto-downloads

## Project Structure
```
p2p-web-share/
├── server/
│   ├── node_modules/
│   ├── index.js          # Signaling server
│   ├── package-lock.json
│   └── package.json
├── client/
│   ├── node_modules/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Home.jsx  # Landing page
│   │   │   └── Room.jsx  # Transfer room
│   │   ├── utils/
│   │   │   └── fileStorage.js  # OPFS helper
│   │   ├── assets/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── index.css
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   ├── package-lock.json
│   └── package.json
└── README.md

```
## Setup Instructions

### Prerequisites
- Node.js v18+
- npm

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/p2p-web-share.git
cd p2p-web-share
```

### 2. Setup and run the server
```bash
cd server
npm install
node index.js
```
Server runs on `http://localhost:3001`

### 3. Setup and run the client
```bash
cd client
npm install
npm run dev
```
Client runs on `http://localhost:5173`

### 4. Test the app
- Open `http://localhost:5173` in one browser window
- Drop a file and click **Generate Share Link**
- Copy the link and open it in another browser window
- Watch the file transfer directly between browsers!


## Security
- Files are encrypted with AES-256-GCM before transmission
- Encryption key is passed via URL hash — never sent to server
- SHA-256 hash verification ensures zero data corruption
- Signaling server never reads, stores, or processes any file data