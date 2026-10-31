import { hooks } from "./hooks.js";
import {
  state,
  historyBtn,
  historyMenu
} from "./state.js";
import {
  formatRelativeTime
} from "./vendor-deps.js";

export function renderHistoryMenu() {
  const entries = hooks.loadHistoryIndexEntries();
  historyMenu.replaceChildren();

  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No history yet";
    historyMenu.appendChild(empty);
    return;
  }

  entries.forEach((entry, index) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "option");

    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = entry.title || "Untitled";

    const meta = document.createElement("span");
    meta.className = "item-meta";
    meta.textContent = formatRelativeTime(entry.savedAt);

    btn.append(title, meta);
    btn.addEventListener("click", () => {
      void restoreHistoryEntry(index);
    });

    li.appendChild(btn);
    historyMenu.appendChild(li);
  });
}

export async function restoreHistoryEntry(index) {
  if (!hooks.confirmDiscardIfDirty()) return;
  const content = await hooks.materializeHistoryEntry(index);
  if (content == null) {
    hooks.showToast("Could not restore history item");
    return;
  }
  hooks.setEditorValue(content);
  state.lastHistoryContent = content;
  await hooks.persistDraft(content);
  hooks.renderMarkdown(content);
  hooks.clearCurrentFileBinding();
  // History is not a disk/URL baseline — stay dirty until save.
  hooks.markDirtyBaseline();
  hooks.setContentExternal(false);
  closeHistory();
  hooks.showToast("Restored from history");
}

export function openHistory() {
  renderHistoryMenu();
  historyMenu.hidden = false;
  historyBtn.setAttribute("aria-expanded", "true");
}

export function closeHistory() {
  historyMenu.hidden = true;
  historyBtn.setAttribute("aria-expanded", "false");
}

export function toggleHistory() {
  if (historyMenu.hidden) openHistory();
  else closeHistory();
}

hooks.renderHistoryMenu = renderHistoryMenu;
hooks.restoreHistoryEntry = restoreHistoryEntry;
hooks.openHistory = openHistory;
hooks.closeHistory = closeHistory;
hooks.toggleHistory = toggleHistory;
