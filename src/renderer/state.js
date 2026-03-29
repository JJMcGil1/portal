// Shared application state

export const state = {
  tabs: [],
  activeTabId: null,
  saved: [],
};

let _tabIdCounter = 0;

export function setTabIdCounter(value) {
  _tabIdCounter = value;
}

export function nextTabId() {
  return ++_tabIdCounter;
}
