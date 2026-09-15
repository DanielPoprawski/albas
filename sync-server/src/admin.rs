//! `albas-sync admin …`: the operator CLI that replaced the HTTP admin routes
//! and the web console (2026-09).
//!
//! It runs *inside the container* (`scripts/admin.sh` wraps the `docker
//! compose exec`) against the same SQLite file the server has open — WAL mode
//! plus a busy timeout make that safe, and each write is one short
//! transaction, so the server's `Mutex<Connection>` always sees a consistent
//! database and its next `/sync` reflects the change. No network, no bearer
//! token: whoever can exec into the container or read the volume already owns
//! the database, so an admin credential on top of that was only theatre.
//!
//! Everything here is a thin shell over the `*_db` functions in `admin_db.rs`
//! and `passkey::create_invite_db` — which is also what the tests exercise; this
//! module only parses arguments and prints. `albas-sync health` (`health`)
//! lives here too because it is the other non-server entry point.

use clap::{Args, Parser, Subcommand};
use rusqlite::Connection;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::ExitCode;
use std::time::Duration;

use crate::admin_db::{
    clear_password_db, clear_totp_db, create_account_db, delete_account_db, delete_passkey_db,
    label_passkey_db, list_accounts_db, list_shares_db, rename_account_db, revoke_token_db,
    set_share_db, AccountDetail, AdminError, AdminShare,
};
use crate::config::Config;
use crate::{passkey, schema};

#[derive(Parser)]
#[command(
    name = "albas-sync admin",
    bin_name = "albas-sync admin",
    about = "Operate an albas-sync database from a shell (reads ALBAS_SYNC_DB, default /data/albas-sync.db)",
    disable_help_subcommand = true
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Accounts: list, create (token-only), rename, delete
    #[command(subcommand)]
    Account(AccountCmd),
    /// A passkey on an account: label or delete
    #[command(subcommand)]
    Passkey(PasskeyCmd),
    /// Bearer tokens (one per signed-in device)
    #[command(subcommand)]
    Token(TokenCmd),
    /// The password credential
    #[command(subcommand)]
    Password(PasswordCmd),
    /// The TOTP second factor
    #[command(subcommand)]
    Totp(TotpCmd),
    /// Read-only sharing grants between accounts
    #[command(subcommand)]
    Share(ShareCmd),
    /// Invite codes (signup passes / attach-a-passkey)
    #[command(subcommand)]
    Invite(InviteCmd),
    /// Exit 0 if the server on this host answers GET /health (same as `albas-sync health`)
    Health,
}

#[derive(Args)]
struct JsonFlag {
    /// Machine-readable output (the shape the old HTTP route returned)
    #[arg(long)]
    json: bool,
}

#[derive(Subcommand)]
enum AccountCmd {
    /// Every account with its tokens, passkeys, row count and credential flags
    List(JsonFlag),
    /// Create a token-only account and print its bearer token, once
    Create { name: String },
    /// Rename an account (`owner` is refused; grantees' shared caches rebuild)
    Rename { name: String, new_name: String },
    /// Delete an account and everything anchored to it (rows, tokens, passkeys, shares)
    Delete { name: String },
}

#[derive(Subcommand)]
enum PasskeyCmd {
    /// Set a passkey's label; omit the label to clear it
    Label {
        account: String,
        id: i64,
        label: Option<String>,
    },
    /// Delete a passkey (refused when it is the account's only way in)
    Delete { account: String, id: i64 },
}

#[derive(Subcommand)]
enum TokenCmd {
    /// Revoke one token — that device is signed out on its next sync
    Revoke { account: String, id: i64 },
}

#[derive(Subcommand)]
enum PasswordCmd {
    /// Clear the password (refused when it is the only credential)
    Clear { account: String },
}

#[derive(Subcommand)]
enum TotpCmd {
    /// Clear TOTP — the recovery move for a lost authenticator; never guarded
    Clear { account: String },
}

#[derive(Subcommand)]
enum ShareCmd {
    /// Every grant on the server
    List(JsonFlag),
    /// Grant <GRANTEE> read access to <OWNER>'s data; no scope flag removes the grant
    Set {
        owner: String,
        grantee: String,
        /// events, periods, categories
        #[arg(long)]
        calendar: bool,
        /// habits, completions, tasks, categories
        #[arg(long)]
        todos: bool,
    },
    /// Remove a grant (same as `set` with no scope flags)
    Remove { owner: String, grantee: String },
}

#[derive(Subcommand)]
enum InviteCmd {
    /// Mint a single-use invite code, valid 7 days
    Create {
        /// Bind the invite to an existing account so it can add a passkey
        #[arg(long)]
        name: Option<String>,
    },
}

/// Entry point for `albas-sync admin …`; `args` is everything *after* the
/// `admin` word. Exit codes: 0 ok, 1 the operation failed (message on
/// stderr), 2 usage error (clap's convention).
pub(crate) fn run(args: impl Iterator<Item = String>) -> ExitCode {
    let cli = match Cli::try_parse_from(std::iter::once("albas-sync admin".to_string()).chain(args))
    {
        Ok(cli) => cli,
        Err(e) => {
            let _ = e.print();
            return if e.use_stderr() {
                ExitCode::from(2)
            } else {
                ExitCode::SUCCESS
            };
        }
    };
    if let Cmd::Health = cli.cmd {
        return health();
    }
    match open_db().and_then(|mut conn| execute(&mut conn, cli.cmd)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(msg) => {
            eprintln!("error: {msg}");
            ExitCode::FAILURE
        }
    }
}

/// Same boot path as the server (`schema::open`), so the CLI works on a fresh
/// volume before the server has ever run — and `ALBAS_SYNC_TOKEN`, when set,
/// keeps owning the `owner` account's env token exactly as a server start
/// would.
fn open_db() -> Result<Connection, String> {
    let cfg = Config::from_env()?;
    schema::open(&cfg.db_path, cfg.owner_token.as_deref())
}

/// One transaction per write, so a failure leaves the database as it was.
fn write<T>(
    conn: &mut Connection,
    f: impl FnOnce(&Connection) -> Result<T, AdminError>,
) -> Result<T, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let out = f(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(out)
}

fn execute(conn: &mut Connection, cmd: Cmd) -> Result<(), String> {
    match cmd {
        Cmd::Account(AccountCmd::List(JsonFlag { json })) => {
            let accounts = list_accounts_db(conn).map_err(|e| e.to_string())?;
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&accounts).map_err(|e| e.to_string())?
                );
            } else if accounts.is_empty() {
                println!("no accounts");
            } else {
                for a in &accounts {
                    print_account(a);
                }
            }
        }
        Cmd::Account(AccountCmd::Create { name }) => {
            let (id, token) = write(conn, |c| create_account_db(c, &name))?;
            println!("created account '{}' (id {id})", name.trim());
            println!("token: {token}");
            println!("This token is shown once and never again — only its hash is stored.");
        }
        Cmd::Account(AccountCmd::Rename { name, new_name }) => {
            write(conn, |c| rename_account_db(c, &name, &new_name))?;
            println!("renamed '{name}' to '{}'", new_name.trim());
        }
        Cmd::Account(AccountCmd::Delete { name }) => {
            write(conn, |c| delete_account_db(c, &name))?;
            println!("deleted account '{name}' and its rows, tokens, passkeys and shares");
        }
        Cmd::Passkey(PasskeyCmd::Label { account, id, label }) => {
            write(conn, |c| {
                label_passkey_db(c, &account, id, label.as_deref())
            })?;
            match label.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
                Some(l) => println!("labelled passkey {id} of '{account}' as '{l}'"),
                None => println!("cleared the label of passkey {id} of '{account}'"),
            }
        }
        Cmd::Passkey(PasskeyCmd::Delete { account, id }) => {
            write(conn, |c| delete_passkey_db(c, &account, id))?;
            println!("deleted passkey {id} of '{account}'");
        }
        Cmd::Token(TokenCmd::Revoke { account, id }) => {
            write(conn, |c| revoke_token_db(c, &account, id))?;
            println!(
                "revoked token {id} of '{account}'; that device is signed out on its next sync"
            );
        }
        Cmd::Password(PasswordCmd::Clear { account }) => {
            write(conn, |c| clear_password_db(c, &account))?;
            println!("cleared the password of '{account}'");
        }
        Cmd::Totp(TotpCmd::Clear { account }) => {
            write(conn, |c| clear_totp_db(c, &account))?;
            println!("cleared TOTP for '{account}'");
        }
        Cmd::Share(ShareCmd::List(JsonFlag { json })) => {
            let shares = list_shares_db(conn).map_err(|e| e.to_string())?;
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&shares).map_err(|e| e.to_string())?
                );
            } else if shares.is_empty() {
                println!("no shares");
            } else {
                for s in &shares {
                    print_share(s);
                }
            }
        }
        Cmd::Share(ShareCmd::Set {
            owner,
            grantee,
            calendar,
            todos,
        }) => {
            write(conn, |c| set_share_db(c, &owner, &grantee, calendar, todos))?;
            if calendar || todos {
                println!(
                    "'{grantee}' now reads '{owner}': {}",
                    scopes(calendar, todos)
                );
            } else {
                println!("no scope flags given: removed the share from '{owner}' to '{grantee}'");
            }
        }
        Cmd::Share(ShareCmd::Remove { owner, grantee }) => {
            write(conn, |c| set_share_db(c, &owner, &grantee, false, false))?;
            println!("removed the share from '{owner}' to '{grantee}'");
        }
        Cmd::Invite(InviteCmd::Create { name }) => {
            let (code, expires_at) =
                write(conn, |c| passkey::create_invite_db(c, name.as_deref()))?;
            match name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
                Some(n) => println!("invite for existing account '{n}' (adds a passkey to it)"),
                None => println!("signup invite (creates a new account)"),
            }
            println!("code: {code}");
            println!("single-use, expires {}", fmt_ts(expires_at));
        }
        Cmd::Health => unreachable!("handled in run() before the database is opened"),
    }
    Ok(())
}

fn print_account(a: &AccountDetail) {
    println!(
        "{}  id {}  created {}  rows {}  password {}  totp {}  google {}  grant_rev {}",
        a.name,
        a.id,
        fmt_ts(a.created_at),
        a.row_count,
        yes_no(a.has_password),
        yes_no(a.totp_enabled),
        a.google_email.as_deref().unwrap_or("-"),
        a.grant_rev,
    );
    for t in &a.tokens {
        println!(
            "  token    {:<6} {:<24} created {}",
            t.id,
            t.label,
            fmt_ts(t.created_at)
        );
    }
    for p in &a.passkeys {
        // Same derived name the console used when no label was set.
        let derived;
        let label = match p.label.as_deref() {
            Some(l) => l,
            None => {
                derived = format!("Passkey {}", &p.cred_id[..p.cred_id.len().min(8)]);
                &derived
            }
        };
        println!(
            "  passkey  {:<6} {:<24} created {}  cred {}",
            p.id,
            label,
            fmt_ts(p.created_at),
            p.cred_id
        );
    }
}

fn print_share(s: &AdminShare) {
    println!(
        "{} -> {}  {}",
        s.owner_name,
        s.grantee_name,
        scopes(s.calendar, s.todos)
    );
}

fn scopes(calendar: bool, todos: bool) -> String {
    match (calendar, todos) {
        (true, true) => "calendar, todos".into(),
        (true, false) => "calendar".into(),
        (false, true) => "todos".into(),
        (false, false) => "(nothing)".into(),
    }
}

fn yes_no(b: bool) -> &'static str {
    if b {
        "yes"
    } else {
        "no"
    }
}

/// `YYYY-MM-DD HH:MMZ` from epoch milliseconds — enough for an operator's eyes.
fn fmt_ts(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|t| t.format("%Y-%m-%d %H:%MZ").to_string())
        .unwrap_or_default()
}

/// `albas-sync health`: exit 0 when the server on this host answers
/// `GET /health` with 200. Used as the container healthcheck (the image has
/// no curl). The port is `Config::health_port`; an environment the server
/// itself would refuse to boot on reads as unhealthy too.
pub(crate) fn health() -> ExitCode {
    match Config::from_env().and_then(|cfg| probe(cfg.health_port)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("unhealthy: {e}");
            ExitCode::FAILURE
        }
    }
}

fn probe(port: u16) -> Result<(), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let timeout = Duration::from_secs(3);
    let mut s =
        TcpStream::connect_timeout(&addr, timeout).map_err(|e| format!("connect {addr}: {e}"))?;
    let _ = s.set_read_timeout(Some(timeout));
    let _ = s.set_write_timeout(Some(timeout));
    s.write_all(b"GET /health HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .map_err(|e| format!("write: {e}"))?;
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).map_err(|e| format!("read: {e}"))?;
    let head = String::from_utf8_lossy(&buf);
    let status = head.lines().next().unwrap_or("");
    let ok = status.starts_with("HTTP/1.") && status.split_whitespace().nth(1) == Some("200");
    if ok {
        Ok(())
    } else {
        Err(format!("unexpected response: {status:?}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn cli_definition_is_consistent() {
        Cli::command().debug_assert();
    }

    #[test]
    fn share_set_parses_scope_flags() {
        let cli = Cli::try_parse_from(["x", "share", "set", "alice", "bob", "--calendar"]).unwrap();
        match cli.cmd {
            Cmd::Share(ShareCmd::Set {
                owner,
                grantee,
                calendar,
                todos,
            }) => {
                assert_eq!(
                    (owner.as_str(), grantee.as_str(), calendar, todos),
                    ("alice", "bob", true, false)
                );
            }
            _ => panic!("wrong command"),
        }
        let cli = Cli::try_parse_from(["x", "passkey", "label", "alice", "7"]).unwrap();
        assert!(matches!(
            cli.cmd,
            Cmd::Passkey(PasskeyCmd::Label {
                id: 7,
                label: None,
                ..
            })
        ));
        assert!(
            Cli::try_parse_from(["x", "account", "create"]).is_err(),
            "name is required"
        );
    }

    #[test]
    fn timestamps_format() {
        assert_eq!(fmt_ts(0), "1970-01-01 00:00Z");
        assert_eq!(fmt_ts(1_756_684_800_000), "2025-09-01 00:00Z");
    }

    #[test]
    fn health_fails_fast_with_nothing_listening() {
        // Port 1 is never a listening HTTP server on a test box.
        assert!(probe(1).is_err());
    }
}
