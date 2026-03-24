// Shared state to avoid circular dependencies between bot.js and commands

let _notifyOwner = async () => {};
let _onClaudeExit = async () => {};
let _sendToChannel = async () => {};

export function setNotifyOwner(fn) {
  _notifyOwner = fn;
}

export function notifyOwner(msg) {
  return _notifyOwner(msg);
}

export function setOnClaudeExit(fn) {
  _onClaudeExit = fn;
}

export function onClaudeExit(code, signal) {
  return _onClaudeExit(code, signal);
}

export function setSendToChannel(fn) {
  _sendToChannel = fn;
}

export function sendToChannel(channelId, msg) {
  return _sendToChannel(channelId, msg);
}
