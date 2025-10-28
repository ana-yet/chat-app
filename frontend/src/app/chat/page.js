"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";
import UsersList from "@/components/UsersList";
import ChatWindow from "@/components/ChatWindow";

export default function ChatPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [socket, setSocket] = useState(null);

  /**
   * Initialize user and socket connection
   */
  useEffect(() => {
    // Get user from localStorage
    const savedUser = localStorage.getItem("chatUser");

    if (!savedUser) {
      router.push("/");
      return;
    }

    const user = JSON.parse(savedUser);
    setCurrentUser(user);

    // Initialize socket
    const socketInstance = getSocket();
    setSocket(socketInstance);

    // Connect and login
    socketInstance.connect();
    socketInstance.emit("user-login", { userId: user.userId });

    // Listen for login success
    socketInstance.on("login-success", (data) => {
      console.log("✅ Logged in:", data.username);
    });

    // Listen for users list updates
    socketInstance.on("users-update", (users) => {
      setOnlineUsers(users);
    });

    // Listen for incoming messages
    socketInstance.on("receive-message", (message) => {
      // Only add if it's from the currently selected user
      setMessages((prev) => {
        // Check if this message is part of current conversation
        if (
          selectedUser &&
          (message.senderId === selectedUser.userId ||
            message.recipientId === selectedUser.userId)
        ) {
          return [...prev, message];
        }
        return prev;
      });

      // Show notification sound/alert could be added here
    });

    // Listen for message sent confirmation
    socketInstance.on("message-sent", (message) => {
      setMessages((prev) => [...prev, message]);
    });

    // Listen for typing indicator
    socketInstance.on("user-typing", ({ userId, isTyping }) => {
      if (selectedUser && userId === selectedUser.userId) {
        setIsTyping(isTyping);
      }
    });

    // Listen for user status changes
    socketInstance.on("user-online", ({ userId, username }) => {
      console.log(`${username} came online`);
    });

    socketInstance.on("user-offline", ({ userId, username }) => {
      console.log(`${username} went offline`);

      // If chatting with this user, update UI
      if (selectedUser?.userId === userId) {
        setSelectedUser(null);
        setMessages([]);
      }
    });

    // Cleanup on unmount
    return () => {
      socketInstance.emit("logout");
      socketInstance.disconnect();
    };
  }, [router]);

  /**
   * Load chat history when selecting a user
   */
  useEffect(() => {
    if (selectedUser && socket) {
      // Clear current messages
      setMessages([]);
      setIsTyping(false);

      // Request chat history
      socket.emit("get-chat-history", { otherUserId: selectedUser.userId });

      // Listen for chat history
      socket.once("chat-history", ({ otherUserId, messages: history }) => {
        if (otherUserId === selectedUser.userId) {
          setMessages(history);
        }
      });
    }
  }, [selectedUser, socket]);

  /**
   * Handle selecting a user to chat with
   */
  const handleSelectUser = (user) => {
    setSelectedUser(user);
  };

  /**
   * Handle sending a message
   */
  const handleSendMessage = (message) => {
    if (!selectedUser || !socket) return;

    socket.emit("send-message", {
      recipientId: selectedUser.userId,
      message,
    });
  };

  /**
   * Handle typing indicator
   */
  const handleTyping = (isTyping) => {
    if (!selectedUser || !socket) return;

    socket.emit("typing", {
      recipientId: selectedUser.userId,
      isTyping,
    });
  };

  /**
   * Handle logout
   */
  const handleLogout = () => {
    if (socket) {
      socket.emit("logout");
      socket.disconnect();
    }
    localStorage.removeItem("chatUser");
    router.push("/");
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <svg
            className="animate-spin h-10 w-10 text-indigo-600 mx-auto mb-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Top Bar */}
      <div className="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold">
            {currentUser.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="font-semibold text-gray-800">
              {currentUser.username}
            </h1>
            <p className="text-xs text-green-600">● Online</p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition flex items-center gap-2"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          Logout
        </button>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Users List Sidebar */}
        <UsersList
          users={onlineUsers}
          currentUserId={currentUser.userId}
          selectedUser={selectedUser}
          onSelectUser={handleSelectUser}
        />

        {/* Chat Window */}
        <ChatWindow
          currentUser={currentUser}
          selectedUser={selectedUser}
          messages={messages}
          onSendMessage={handleSendMessage}
          onTyping={handleTyping}
          isTyping={isTyping}
        />
      </div>
    </div>
  );
}
