// ============================================
// Home.jsx — Landing Page Component
// Handles file selection via drag-and-drop
// and generates an encrypted share link
// with AES-256-GCM key embedded in URL hash
// ============================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'

// Generate a cryptographic AES-GCM 256-bit key
// The key is exportable so we can embed it in the URL hash
const generateEncryptionKey = async () => {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable — needed to export as base64
    ['encrypt', 'decrypt']
  )
  // Export key as raw bytes and convert to base64
  const exported = await crypto.subtle.exportKey('raw', key)
  const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(exported)))
  return { key, keyBase64 }
}

function Home() {
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const navigate = useNavigate()

  // Handle file drop on the drop zone
  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) setFile(droppedFile)
  }

  // Handle file selection via file input
  const handleFileInput = (e) => {
    if (e.target.files[0]) setFile(e.target.files[0])
  }

  // Generate unique room ID and encryption key
  // Navigate to room page with file and key
  const handleShare = async () => {
    if (!file) return
    const roomId = uuidv4().slice(0, 8)

    // Generate AES-256-GCM encryption key
    const { key, keyBase64 } = await generateEncryptionKey()

    // Store file metadata in sessionStorage
    sessionStorage.setItem('encryptionKey', keyBase64)
    sessionStorage.setItem('fileName', file.name)
    sessionStorage.setItem('fileSize', file.size)
    sessionStorage.setItem('fileType', file.type)

    // Key is passed via URL hash — never sent to server
    // This is the core of Zero-Knowledge Encryption
    navigate(`/room/${roomId}#key=${keyBase64}`, {
      state: { file, isSender: true, encryptionKey: key }
    })
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-4xl font-bold mb-2 text-blue-400">P2P Web Share</h1>
      <p className="text-gray-400 mb-2 text-center">
        Direct browser-to-browser file transfer. No servers. No limits.
      </p>
      <p className="text-green-500 text-xs mb-10 text-center">
        End-to-end encrypted — your files never touch our servers
      </p>

      {/* Drop Zone — accepts drag and drop or click to browse */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        className={`w-full max-w-md border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200
          ${dragOver ? 'border-blue-400 bg-blue-950' : 'border-gray-600 bg-gray-900 hover:border-blue-500'}`}
        onClick={() => document.getElementById('fileInput').click()}
      >
        <div className="text-5xl mb-4">📂</div>
        {file ? (
          <div>
            <p className="text-green-400 font-semibold">{file.name}</p>
            <p className="text-gray-400 text-sm mt-1">
              {(file.size / (1024 * 1024)).toFixed(2)} MB
            </p>
          </div>
        ) : (
          <div>
            <p className="text-gray-300 font-medium">Drag & drop a file here</p>
            <p className="text-gray-500 text-sm mt-1">or click to browse</p>
            <p className="text-gray-600 text-xs mt-2">Supports files up to 500MB+</p>
          </div>
        )}
        <input
          id="fileInput"
          type="file"
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {/* Share button — disabled until file is selected */}
      <button
        onClick={handleShare}
        disabled={!file}
        className={`mt-6 px-8 py-3 rounded-xl font-semibold text-lg transition-all duration-200
          ${file
            ? 'bg-blue-500 hover:bg-blue-600 active:scale-95 cursor-pointer'
            : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
      >
        Generate Share Link
      </button>

      {/* Encryption info badge */}
      <div className="mt-4 flex items-center gap-2 text-gray-500 text-xs">
        <span>🔒</span>
        <span>AES-256-GCM encrypted — key never leaves your browser</span>
      </div>
    </div>
  )
}

export default Home