/**
 * Barrel for the sign-in method registry.
 *
 * Importing this module is what registers the built-in methods — each side
 * module calls `registerAuthMethod()` at import time. The import list below is
 * fixed so that adding a method never means editing a file another agent might
 * also be editing: fill in the named module, and it appears.
 *
 * A module that is not implemented yet registers nothing, so an unfinished
 * method can never show a row for a credential that does not exist.
 */
import './passkey';
import './password';
import './totp';

export * from './registry';
