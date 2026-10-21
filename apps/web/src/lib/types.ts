export interface User {
  id: string;
  email: string;
  displayName: string | null;
}

export interface Conversation {
  id: string;
  title: string | null;
  channel: "WEB" | "TELEGRAM";
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  providerUsed: string | null;
  createdAt: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}
