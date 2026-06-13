// ============================================
// fileStorage.js — OPFS Helper Utility
// Uses Origin Private File System (OPFS) to
// write incoming file chunks directly to disk
// instead of RAM. This enables support for
// large files (>500MB) without browser crashes.
// ============================================

const FILE_NAME = 'incoming_transfer'

// Initialize a writable file handle in OPFS
// Called when a large file transfer begins
export const initOPFS = async () => {
  const root = await navigator.storage.getDirectory()
  const fileHandle = await root.getFileHandle(FILE_NAME, { create: true })
  const writable = await fileHandle.createWritable()
  return { fileHandle, writable }
}

// Write a single decrypted chunk to OPFS disk
export const writeChunk = async (writable, chunk) => {
  await writable.write(chunk)
}

// Close the writable stream when transfer is complete
export const closeWritable = async (writable) => {
  await writable.close()
}

// Read the fully assembled file from OPFS as a Blob
// Called after all chunks have been received and written
export const readFileFromOPFS = async (mimeType) => {
  const root = await navigator.storage.getDirectory()
  const fileHandle = await root.getFileHandle(FILE_NAME)
  const file = await fileHandle.getFile()
  return new Blob([await file.arrayBuffer()], { type: mimeType })
}

// Delete the temporary file from OPFS after download
// Keeps the browser storage clean
export const cleanupOPFS = async () => {
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(FILE_NAME)
}

// Check if OPFS is supported in the current browser
// Falls back to RAM storage if not supported
export const isOPFSSupported = () => {
  return 'storage' in navigator && 'getDirectory' in navigator.storage
}