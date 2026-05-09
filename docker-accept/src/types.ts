export type EmailWebhookPayload = {
  event: string;
  messageId: string;
  from: string;
  to: string[];
  rawSize: number;
  subject: string;
  headers: Record<string, string>;
  textPreview: string;
  rawBase64: string;
  receivedAt: string;
};

export type UserRole = "admin" | "member";

export type UserAccount = {
  username: string;
  password: string;
  role: UserRole;
  createdAt: string;
};

export type SessionRecord = {
  username: string;
  role: UserRole;
  createdAt: string;
  expiresAt: string;
};
