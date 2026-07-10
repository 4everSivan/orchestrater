import { isTrustedCommand } from "./config.mjs";
import { terminalError, policyError } from "./errors.mjs";
import { listItems } from "./orca.mjs";

function isConnected(terminal) {
  return terminal.connected !== false && terminal.status !== "disconnected";
}

function isWritable(terminal) {
  return terminal.writable !== false && terminal.readOnly !== true;
}

export function resolveTerminal(role, response) {
  const terminals = listItems(response).filter((terminal) => terminal.title === role.terminalTitle);
  if (terminals.length === 0) {
    throw terminalError("E_TERMINAL_MISSING", `No terminal titled ${role.terminalTitle}`, "confirm terminal creation or choose another role");
  }
  if (terminals.length > 1) {
    throw terminalError("E_TERMINAL_DUPLICATE", `Multiple terminals titled ${role.terminalTitle}`, "rename or close duplicate terminals before dispatching");
  }
  const terminal = terminals[0];
  if (!isConnected(terminal)) {
    throw terminalError("E_TERMINAL_STALE", `Terminal ${role.terminalTitle} is disconnected`, "restart the worker terminal and resolve again");
  }
  if (!isWritable(terminal)) {
    throw terminalError("E_TERMINAL_NOT_WRITABLE", `Terminal ${role.terminalTitle} is not writable`, "select a writable worker terminal");
  }
  const handle = terminal.handle ?? terminal.id;
  if (!handle) {
    throw terminalError("E_TERMINAL_HANDLE", `Terminal ${role.terminalTitle} has no handle`, "refresh Orca terminal list");
  }
  return { handle, title: role.terminalTitle };
}

export function assertCreatable(role, confirmedCommand) {
  if (!isTrustedCommand(role.command) && confirmedCommand !== true) {
    throw policyError("E_POLICY_COMMAND_UNTRUSTED", `Command ${role.command} requires user confirmation`, "confirm this command for the current task before creating a terminal");
  }
}
