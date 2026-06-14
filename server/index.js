// ============================================
// P2P Web Share — Signaling Server
// Built with Node.js + Express + Socket.io
// This server ONLY coordinates the WebRTC
// handshake. It never reads or stores any
// file data.
// ============================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

// Health check route — shows server is running
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'P2P Web Share - Signaling Server',
    message: 'This server coordinates WebRTC handshakes only. No file data is processed here.'
  });
});

const server = http.createServer(app);

// Initialize Socket.io with CORS for frontend
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// In-memory store for active rooms
// Each room has a sender and receiver socket ID
const rooms = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Sender creates a new room with a unique ID
  socket.on("create-room", (roomId) => {
    rooms[roomId] = { sender: socket.id, receiver: null };
    socket.join(roomId);
    console.log(`Room created: ${roomId}`);
  });

  // Receiver joins an existing room
  socket.on("join-room", (roomId) => {
    if (!rooms[roomId]) {
      // Room doesn't exist — notify receiver
      socket.emit("room-not-found");
      return;
    }
    rooms[roomId].receiver = socket.id;
    socket.join(roomId);
    // Notify sender that receiver has joined
    socket.to(roomId).emit("receiver-joined", roomId);
  });

  // Forward WebRTC offer from sender to receiver
  socket.on("offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("offer", { offer });
  });

  // Forward WebRTC answer from receiver to sender
  socket.on("answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("answer", { answer });
  });

  // Forward ICE candidates between peers
  // ICE candidates help establish the best network path
  socket.on("ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice-candidate", { candidate });
  });

  // Handle peer disconnect gracefully
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.sender === socket.id || room.receiver === socket.id) {
        // Notify the other peer about disconnection
        socket.to(roomId).emit("peer-disconnected");
        // Clean up the room
        delete rooms[roomId];
        break;
      }
    }
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on http://localhost:${PORT}`);
});