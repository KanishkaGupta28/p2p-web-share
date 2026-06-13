// ============================================
// Room.jsx — File Transfer Room Component
// Handles WebRTC peer connection, AES-256-GCM
// encryption/decryption, file chunking,
// SHA-256 verification, and auto-download.
// Supports large files via OPFS disk storage.
// ============================================

import { useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { io } from 'socket.io-client'
import {
  initOPFS,
  writeChunk,
  closeWritable,
  readFileFromOPFS,
  cleanupOPFS,
  isOPFSSupported
} from '../utils/fileStorage'

// Signaling server URL
const SIGNAL_SERVER = 'http://localhost:3001'

// Size of each file chunk sent over WebRTC (16KB)
const CHUNK_SIZE = 16384

// Import AES-GCM key from base64 string for decryption
const importKey = async (keyBase64) => {
  const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}

// Encrypt a single chunk using AES-GCM
// A random 12-byte IV is prepended to each encrypted chunk
const encryptChunk = async (key, chunk) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    chunk
  )
  // Combine IV + encrypted data into one buffer
  const result = new Uint8Array(iv.byteLength + encrypted.byteLength)
  result.set(iv, 0)
  result.set(new Uint8Array(encrypted), iv.byteLength)
  return result
}

// Decrypt a single chunk using AES-GCM
// Extracts IV from first 12 bytes, then decrypts the rest
const decryptChunk = async (key, data) => {
  const iv = data.slice(0, 12)
  const encrypted = data.slice(12)
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  )
}

function Room() {
  const { roomId } = useParams()
  const location = useLocation()
  const isSender = location.state?.isSender || false
  const file = location.state?.file || null

  // UI state
  const [status, setStatus] = useState('Connecting...')
  const [progress, setProgress] = useState(0)
  const [speed, setSpeed] = useState(0)
  const [connected, setConnected] = useState(false)
  const [transferDone, setTransferDone] = useState(false)
  const [error, setError] = useState(null)
  const [encrypted, setEncrypted] = useState(false)

  // Refs for WebRTC and transfer state
  const socketRef = useRef(null)       // Socket.io connection
  const pcRef = useRef(null)           // RTCPeerConnection
  const channelRef = useRef(null)      // WebRTC DataChannel
  const chunksRef = useRef([])         // Received chunks (RAM)
  const receivedSizeRef = useRef(0)    // Total bytes received
  const totalSizeRef = useRef(0)       // Expected file size
  const startTimeRef = useRef(null)    // Transfer start time
  const fileNameRef = useRef('')       // Received file name
  const fileTypeRef = useRef('')       // Received file MIME type
  const cryptoKeyRef = useRef(null)    // AES-GCM crypto key
  const opfsWritableRef = useRef(null) // OPFS writable stream
  const useOPFSRef = useRef(false)     // Whether to use OPFS

  // Share link includes the encryption key in the URL hash
  // The hash is never sent to the server (browser security)
  const shareLink = `${window.location.origin}/room/${roomId}${window.location.hash}`

  // Extract AES-GCM key from URL hash (#key=...)
  const getKeyFromHash = () => {
    const hash = window.location.hash
    if (hash.startsWith('#key=')) return hash.slice(5)
    return null
  }

  useEffect(() => {
    // Connect to signaling server via Socket.io
    const socket = io(SIGNAL_SERVER)
    socketRef.current = socket

    // Create WebRTC peer connection with Google STUN server
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })
    pcRef.current = pc

    // Send ICE candidates to the other peer via signaling server
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('ice-candidate', { roomId, candidate: e.candidate })
      }
    }

    // Import encryption key from URL hash
    const keyBase64 = getKeyFromHash()
    if (keyBase64) {
      importKey(keyBase64).then(key => {
        cryptoKeyRef.current = key
        setEncrypted(true)
      })
    }

    if (isSender) {
      // ---- SENDER FLOW ----
      socket.emit('create-room', roomId)
      setStatus('Waiting for receiver to join...')

      // Create WebRTC data channel for file transfer
      const channel = pc.createDataChannel('fileTransfer')
      channelRef.current = channel

      // Start sending file when channel opens
      channel.onopen = () => {
        setConnected(true)
        setStatus('Connected! Starting encrypted transfer...')
        sendFile()
      }

      channel.onclose = () => setStatus('Transfer channel closed')

      // When receiver joins, create and send WebRTC offer
      socket.on('receiver-joined', async () => {
        setStatus('Receiver joined! Creating connection...')
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socket.emit('offer', { roomId, offer })
      })

      // Set remote description when answer is received
      socket.on('answer', async ({ answer }) => {
        await pc.setRemoteDescription(new RTCSessionDescription(answer))
      })

    } else {
      // ---- RECEIVER FLOW ----
      socket.emit('join-room', roomId)
      setStatus('Joining room...')

      // Listen for incoming data channel from sender
      pc.ondatachannel = (e) => {
        const channel = e.channel
        channelRef.current = channel
        channel.onmessage = (event) => handleReceiveMessage(event)
        channel.onopen = () => {
          setConnected(true)
          setStatus('Connected! Waiting for encrypted file...')
        }
      }

      socket.on('room-not-found', () => {
        setError('Room not found. Check the link and try again.')
      })

      // Receive offer from sender and send back answer
      socket.on('offer', async ({ offer }) => {
        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit('answer', { roomId, answer })
      })
    }

    // Add ICE candidates received from the other peer
    socket.on('ice-candidate', async ({ candidate }) => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
      } catch (e) {
        console.error('ICE candidate error:', e)
      }
    })

    // Graceful disconnect — notify user if other peer leaves
    socket.on('peer-disconnected', () => {
      setError('Other peer disconnected.')
      setStatus('Disconnected')
      setConnected(false)
    })

    // Cleanup on component unmount
    return () => {
      socket.disconnect()
      pc.close()
    }
  }, [])

  // ---- SENDER: Send file in encrypted chunks ----
  const sendFile = async () => {
    if (!file) return
    const channel = channelRef.current
    const key = cryptoKeyRef.current

    // Send file metadata first so receiver knows what to expect
    const meta = JSON.stringify({
      name: file.name,
      size: file.size,
      type: file.type
    })
    channel.send(JSON.stringify({ type: 'meta', data: meta }))

    // Read entire file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()

    // Generate SHA-256 hash of original file for integrity check
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    startTimeRef.current = Date.now()
    let offset = 0

    // Send chunks recursively using setTimeout to avoid blocking UI
    const sendNextChunk = async () => {
      if (offset >= file.size) {
        // All chunks sent — send completion signal with hash
        channel.send(JSON.stringify({ type: 'done', hash: hashHex }))
        setStatus('File sent successfully!')
        setTransferDone(true)
        return
      }

      // Slice next chunk from file buffer
      const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE)

      // Encrypt chunk with AES-GCM if key is available
      let dataToSend
      if (key) {
        dataToSend = await encryptChunk(key, chunk)
      } else {
        dataToSend = chunk
      }

      // Wait if WebRTC buffer is getting full (flow control)
      while (channel.bufferedAmount > 65536) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      channel.send(dataToSend)
      offset += CHUNK_SIZE

      // Update progress and speed UI
      const percent = Math.min(100, Math.floor((offset / file.size) * 100))
      setProgress(percent)

      const elapsed = (Date.now() - startTimeRef.current) / 1000
      const mbSent = offset / (1024 * 1024)
      setSpeed((mbSent / elapsed).toFixed(2))

      // Schedule next chunk
      setTimeout(sendNextChunk, 0)
    }

    sendNextChunk()
  }

  // ---- RECEIVER: Handle incoming messages ----
  const handleReceiveMessage = async (event) => {
    if (typeof event.data === 'string') {
      const msg = JSON.parse(event.data)

      if (msg.type === 'meta') {
        // File metadata received — initialize transfer state
        const meta = JSON.parse(msg.data)
        fileNameRef.current = meta.name
        fileTypeRef.current = meta.type
        totalSizeRef.current = meta.size
        startTimeRef.current = Date.now()
        chunksRef.current = []
        receivedSizeRef.current = 0

        // Use OPFS for large files (>50MB) to avoid RAM limits
        if (isOPFSSupported() && meta.size > 50 * 1024 * 1024) {
          useOPFSRef.current = true
          const { writable } = await initOPFS()
          opfsWritableRef.current = writable
          setStatus(`Receiving large file: ${meta.name} (using disk storage)`)
        } else {
          useOPFSRef.current = false
          setStatus(`Receiving: ${meta.name}`)
        }
      }

      if (msg.type === 'done') {
        // All chunks received — assemble and verify
        assembleFile(msg.hash)
      }
    } else {
      // Binary chunk received — decrypt and store
      const key = cryptoKeyRef.current
      let chunkData = new Uint8Array(event.data)

      // Decrypt chunk if encryption key is available
      if (key) {
        chunkData = new Uint8Array(await decryptChunk(key, chunkData))
      }

      // Write to OPFS (large file) or RAM (small file)
      if (useOPFSRef.current && opfsWritableRef.current) {
        await writeChunk(opfsWritableRef.current, chunkData)
      } else {
        chunksRef.current.push(chunkData)
      }

      receivedSizeRef.current += chunkData.byteLength

      // Update progress and speed UI
      const percent = Math.min(100, Math.floor(
        (receivedSizeRef.current / totalSizeRef.current) * 100
      ))
      setProgress(percent)

      const elapsed = (Date.now() - startTimeRef.current) / 1000
      const mbReceived = receivedSizeRef.current / (1024 * 1024)
      setSpeed((mbReceived / elapsed).toFixed(2))
    }
  }

  // ---- RECEIVER: Verify and trigger download ----
  const assembleFile = async (expectedHash) => {
    setStatus('Verifying file integrity...')

    let blob
    if (useOPFSRef.current) {
      // Large file — close OPFS stream and read back as Blob
      await closeWritable(opfsWritableRef.current)
      blob = await readFileFromOPFS(fileTypeRef.current)
    } else {
      // Small file — assemble from RAM chunks
      blob = new Blob(chunksRef.current, { type: fileTypeRef.current })
    }

    // Generate SHA-256 hash of received file
    const arrayBuffer = await blob.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const actualHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    // Compare with sender's hash — zero tolerance for corruption
    if (actualHash === expectedHash) {
      setStatus('File verified! Downloading...')
      setTransferDone(true)

      // Trigger automatic file download
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileNameRef.current
      a.click()
      URL.revokeObjectURL(url)

      // Clean up OPFS temp file
      if (useOPFSRef.current) await cleanupOPFS()
    } else {
      setError('File verification failed! Data may be corrupted.')
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold mb-2 text-blue-400">P2P Web Share</h1>
      <p className="text-gray-500 mb-1 text-sm">Room: {roomId}</p>

      {/* Encryption badge — shown when AES key is detected in URL */}
      {encrypted && (
        <div className="mb-6 flex items-center gap-2 bg-green-900 text-green-300 text-xs px-3 py-1 rounded-full">
          <span>🔒</span>
          <span>End-to-end encrypted with AES-256-GCM</span>
        </div>
      )}

      {/* Status card — shows connection state and progress */}
      <div className="w-full max-w-md bg-gray-900 rounded-2xl p-6 mb-4">
        <div className="flex items-center gap-2 mb-4">
          {/* Green = connected, Yellow = waiting */}
          <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-400' : 'bg-yellow-400'}`} />
          <span className="text-sm text-gray-300">{status}</span>
        </div>

        {/* Progress bar and speed indicator */}
        {(progress > 0 || connected) && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>{progress}%</span>
              <span>{speed} MB/s</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3">
              <div
                className="bg-blue-500 h-3 rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Success message */}
        {transferDone && (
          <div className="text-green-400 text-center font-semibold mt-2">
            Transfer Complete!
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="text-red-400 text-center font-semibold mt-2">
            {error}
          </div>
        )}
      </div>

      {/* Share link card — only shown to sender */}
      {isSender && (
        <div className="w-full max-w-md bg-gray-900 rounded-2xl p-6">
          <p className="text-gray-400 text-sm mb-1">Share this link with the receiver:</p>
          <p className="text-gray-600 text-xs mb-3">
            The decryption key is embedded in the link — only people with this link can decrypt the file.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={shareLink}
              className="flex-1 bg-gray-800 text-blue-300 text-sm rounded-lg px-3 py-2 outline-none"
            />
            <button
              onClick={() => navigator.clipboard.writeText(shareLink)}
              className="bg-blue-500 hover:bg-blue-600 active:scale-95 active:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-100"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Room