// Mirrors sync-server's admin JSON responses (see sync-server/README.md,
// "Admin console"). Keep in sync when main.rs's admin structs change.

export interface Token {
  id: number;
  accountId: number;
  label: string;
  createdAt: number;
}

export interface Passkey {
  id: number;
  accountId: number;
  credId: string;
  createdAt: number;
}

export interface Account {
  id: number;
  name: string;
  createdAt: number;
  grantRev: number;
  tokens: Token[];
  passkeys: Passkey[];
  rowCount: number;
}

export interface Share {
  ownerId: number;
  granteeId: number;
  ownerName: string;
  granteeName: string;
  calendar: boolean;
  todos: boolean;
}

export interface SyncRow {
  accountId: number;
  accountName: string;
  tbl: string;
  pk: string;
  updatedAt: number;
  deleted: boolean;
  seq: number;
}

export interface CreateAccountRequest {
  name: string;
}

export interface CreateAccountResponse {
  name: string;
  token: string;
}

export interface UpdateShareRequest {
  calendar: boolean;
  todos: boolean;
}
