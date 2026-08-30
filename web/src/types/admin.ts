export interface Account {
  id: number;
  name: string;
  created_at: number;
  grant_rev: number;
  tokens: Token[];
  passkeys: Passkey[];
  row_count: number;
}

export interface Token {
  id: number;
  account_id: number;
  label: string;
  created_at: number;
}

export interface Passkey {
  id: number;
  account_id: number;
  cred_id: string;
  created_at: number;
}

export interface Share {
  owner_id: number;
  grantee_id: number;
  owner_name: string;
  grantee_name: string;
  calendar: boolean;
  todos: boolean;
}

export interface Invite {
  id: number;
  code_hash: string;
  name: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

export interface SyncRow {
  account_id: number;
  account_name: string;
  tbl: string;
  pk: string;
  updated_at: number;
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
