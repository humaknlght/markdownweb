import { hooks } from "./hooks.js";

export function setupBootListeners() {
  hooks.setupBootCoreListeners();
  hooks.setupBootUiListeners();
}

hooks.setupBootListeners = setupBootListeners;
