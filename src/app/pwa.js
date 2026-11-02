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

    const tracked = new WeakSet();
    const trackInstalled = (worker) => {
      if (!worker) return;
      // Already waiting (often installed by the other tab). `statechange`
      // will not fire again, which is why a refresh was required to see it.
      if (worker.state === "installed") {
        offerUpdate(worker);
        return;
      }
      if (tracked.has(worker)) return;
      tracked.add(worker);
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") offerUpdate(worker);
      });
    };

    trackInstalled(registration.waiting);
    trackInstalled(registration.installing);

    registration.addEventListener("updatefound", () => {
      trackInstalled(registration.installing || registration.waiting);
    });

    // A tab switch is not a navigation, so the browser will not fetch sw.js
    // by itself. Calling update() synchronously from `visibilitychange` is
    // also dropped: Chrome still treats the page as background for that turn
    // and never sends the request. Wait a frame, and also listen for focus /
    // pageshow — switching windows keeps visibilityState "visible", and a
    // restored page does not always emit visibilitychange.
    let updateFrame = 0;
    const checkForAppUpdate = () => {
      if (document.visibilityState !== "visible") return;
      trackInstalled(registration.waiting);
      trackInstalled(registration.installing);
      if (updateFrame) return;
      updateFrame = requestAnimationFrame(() => {
        updateFrame = 0;
        if (document.visibilityState !== "visible") return;
        registration.update().catch(() => {});
      });
    };

    checkForAppUpdate();
    document.addEventListener("visibilitychange", checkForAppUpdate);
    window.addEventListener("focus", checkForAppUpdate);
    window.addEventListener("pageshow", checkForAppUpdate);
  };

  // Revalidate sw.js on every update check instead of trusting a fresh
  // HTTP cache entry (which would skip the network for up to 24 hours).
  navigator.serviceWorker
    .register(resolveServiceWorkerUrl(), { updateViaCache: "none" })
    .then(watchRegistration)
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
