const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const cors = require("cors");
require("dotenv").config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Socket.IO setup with CORS
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ====================================
// DATA STORAGE (In-memory)
// In production, use a database like MongoDB or PostgreSQL
// ====================================

// Store registered users: { userId: { username, socketId, online } }
const users = new Map();

// Store active connections: { socketId: userId }
const connections = new Map();

// Store chat messages: { conversationId: [messages] }
// conversationId format: "user1_user2" (alphabetically sorted)
const messages = new Map();

// ====================================
// HELPER FUNCTIONS
// ====================================

/**
 * Generate a unique conversation ID between two users
 * Always returns users in alphabetical order to maintain consistency
 */
function getConversationId(user1, user2) {
  return [user1, user2].sort().join("_");
}

/**
 * Get all online users except the current user
 */
function getOnlineUsers(excludeUserId = null) {
  const onlineUsers = [];
  users.forEach((user, userId) => {
    if (user.online && userId !== excludeUserId) {
      onlineUsers.push({
        userId: userId,
        username: user.username,
      });
    }
  });
  return onlineUsers;
}

/**
 * Get chat history between two users
 */
function getChatHistory(user1, user2, limit = 50) {
  const conversationId = getConversationId(user1, user2);
  const history = messages.get(conversationId) || [];
  return history.slice(-limit); // Return last 50 messages
}

// ====================================
// REST API ENDPOINTS
// ====================================

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "Chat Server Running",
    onlineUsers: users.size,
    totalMessages: Array.from(messages.values()).reduce(
      (sum, msgs) => sum + msgs.length,
      0
    ),
  });
});

// Register a new user
app.post("/api/register", (req, res) => {
  const { username } = req.body;

  // Validation
  if (!username || username.trim().length < 2) {
    return res.status(400).json({
      success: false,
      message: "Username must be at least 2 characters long",
    });
  }

  // Check if username already exists
  const existingUser = Array.from(users.values()).find(
    (user) => user.username.toLowerCase() === username.toLowerCase()
  );

  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: "Username already taken",
    });
  }

  // Create new user with unique ID
  const userId = `user_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  users.set(userId, {
    username: username.trim(),
    socketId: null,
    online: false,
    createdAt: new Date().toISOString(),
  });

  res.json({
    success: true,
    userId,
    username: username.trim(),
    message: "Registration successful",
  });
});

// Get all registered users
app.get("/api/users", (req, res) => {
  const allUsers = [];
  users.forEach((user, userId) => {
    allUsers.push({
      userId,
      username: user.username,
      online: user.online,
    });
  });
  res.json({ success: true, users: allUsers });
});

// ====================================
// SOCKET.IO EVENTS
// ====================================

io.on("connection", (socket) => {
  console.log(`🔌 New socket connection: ${socket.id}`);

  // ----------------
  // USER LOGIN
  // ----------------
  socket.on("user-login", ({ userId }) => {
    // Verify user exists
    if (!users.has(userId)) {
      socket.emit("error", { message: "User not found" });
      return;
    }

    // Update user status
    const user = users.get(userId);
    user.socketId = socket.id;
    user.online = true;
    users.set(userId, user);

    // Map socket to user
    connections.set(socket.id, userId);

    console.log(`✅ User logged in: ${user.username} (${userId})`);

    // Send success confirmation to user
    socket.emit("login-success", {
      userId,
      username: user.username,
    });

    // Send updated online users list to everyone
    io.emit("users-update", getOnlineUsers());

    // Notify others that this user came online
    socket.broadcast.emit("user-online", {
      userId,
      username: user.username,
    });
  });

  // ----------------
  // GET CHAT HISTORY
  // ----------------
  socket.on("get-chat-history", ({ otherUserId }) => {
    const userId = connections.get(socket.id);
    if (!userId) return;

    const history = getChatHistory(userId, otherUserId);
    socket.emit("chat-history", {
      otherUserId,
      messages: history,
    });
  });

  // ----------------
  // SEND PRIVATE MESSAGE
  // ----------------
  socket.on("send-message", ({ recipientId, message }) => {
    const senderId = connections.get(socket.id);
    if (!senderId) {
      socket.emit("error", { message: "Not authenticated" });
      return;
    }

    // Verify recipient exists
    if (!users.has(recipientId)) {
      socket.emit("error", { message: "Recipient not found" });
      return;
    }

    const sender = users.get(senderId);
    const recipient = users.get(recipientId);

    // Create message object
    const messageData = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      senderId,
      senderName: sender.username,
      recipientId,
      recipientName: recipient.username,
      message: message.trim(),
      timestamp: new Date().toISOString(),
    };

    // Store message in history
    const conversationId = getConversationId(senderId, recipientId);
    if (!messages.has(conversationId)) {
      messages.set(conversationId, []);
    }
    messages.get(conversationId).push(messageData);

    console.log(`💬 Message: ${sender.username} → ${recipient.username}`);

    // Send to recipient if online
    if (recipient.online && recipient.socketId) {
      io.to(recipient.socketId).emit("receive-message", messageData);
    }

    // Send confirmation back to sender
    socket.emit("message-sent", messageData);
  });

  // ----------------
  // TYPING INDICATOR
  // ----------------
  socket.on("typing", ({ recipientId, isTyping }) => {
    const senderId = connections.get(socket.id);
    if (!senderId) return;

    const recipient = users.get(recipientId);
    if (recipient && recipient.online && recipient.socketId) {
      io.to(recipient.socketId).emit("user-typing", {
        userId: senderId,
        isTyping,
      });
    }
  });

  // ----------------
  // USER DISCONNECT
  // ----------------
  socket.on("disconnect", () => {
    const userId = connections.get(socket.id);

    if (userId && users.has(userId)) {
      const user = users.get(userId);
      user.online = false;
      user.socketId = null;
      users.set(userId, user);

      console.log(`❌ User disconnected: ${user.username} (${userId})`);

      // Notify others
      socket.broadcast.emit("user-offline", {
        userId,
        username: user.username,
      });

      // Send updated users list
      io.emit("users-update", getOnlineUsers());
    }

    connections.delete(socket.id);
  });

  // ----------------
  // MANUAL LOGOUT
  // ----------------
  socket.on("logout", () => {
    const userId = connections.get(socket.id);

    if (userId && users.has(userId)) {
      const user = users.get(userId);
      user.online = false;
      user.socketId = null;
      users.set(userId, user);

      console.log(`🚪 User logged out: ${user.username}`);

      socket.broadcast.emit("user-offline", {
        userId,
        username: user.username,
      });

      io.emit("users-update", getOnlineUsers());
    }

    connections.delete(socket.id);
  });
});

// ====================================
// START SERVER
// ====================================

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════╗
  ║   🚀 Chat Server Running               ║
  ║   📡 Port: ${PORT}                        ║
  ║   🌍 Environment: ${process.env.NODE_ENV || "development"}       ║
  ╚════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, closing server...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
