import { hooks } from "./hooks.js";
import {
  state,
  installBtn,
  updateToast,
  updateReloadBtn,
  isStandaloneDisplay
} from "./state.js";

export function resolveServiceWorkerUrl() {
  try {
    const configured = window.__MD_SW__;
    if (typeof configured === "string" && configured && configured !== "__SW_URL__") {
      return configured;
    }
  } catch {
    /* ignore */
  }
  return "./sw.js";
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  let waitingForUpdateReload = false;
  const desiredSwUrl = new URL(resolveServiceWorkerUrl(), window.location.href).href;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (waitingForUpdateReload) window.location.reload();
  });

  const activateWaiting = (worker) => {
    if (!worker) return;
    waitingForUpdateReload = true;
    worker.postMessage("SKIP_WAITING");
  };

  const watchRegistration = (registration) => {
    const offerUpdate = (worker) => {
      if (!worker) return;
      const activeUrl = registration.active?.scriptURL || "";
      // Hashed → stable sw.js (or any script-URL change): activate immediately so
      // users are not stuck on a deleted sw.<hash>.js with only a tiny toast.
      if (activeUrl && activeUrl !== desiredSwUrl) {
        activateWaiting(worker);
        return;
      }
      if (!updateToast || !navigator.serviceWorker.controller) return;
      updateToast.hidden = false;
      updateReloadBtn.onclick = () => activateWaiting(worker);
    };

    if (registration.waiting) offerUpdate(registration.waiting);

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") offerUpdate(worker);
      });
    });
  };

  navigator.serviceWorker
    .register(resolveServiceWorkerUrl())
    .then((registration) => {
      watchRegistration(registration);
      registration.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          registration.update().catch(() => {});
        }
      });
    })
    .catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
}

export function setupPwa() {
  if (installBtn) {
    if (isStandaloneDisplay()) {
      installBtn.hidden = true;
    } else if (state.deferredInstallPrompt) {
      // BIP may have fired before init finished.
      installBtn.hidden = false;
    }

    installBtn.addEventListener("click", async () => {
      if (!state.deferredInstallPrompt) return;
      installBtn.hidden = true;
      state.deferredInstallPrompt.prompt();
      try {
        await state.deferredInstallPrompt.userChoice;
      } catch {
        /* user dismissed or browser cancelled */
      }
      state.deferredInstallPrompt = null;
    });
  }

  // Register immediately — module scripts often run after `load`.
  registerServiceWorker();
}

hooks.resolveServiceWorkerUrl = resolveServiceWorkerUrl;
hooks.registerServiceWorker = registerServiceWorker;
hooks.setupPwa = setupPwa;
