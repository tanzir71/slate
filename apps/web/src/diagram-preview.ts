import "../../../packages/editor/src/diagramFrame";
import { observeFirstUseAssets } from "./firstUseCache";

const firstUse = observeFirstUseAssets();
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistration().then(value => firstUse.registered(value)).catch(() => undefined);
  void navigator.serviceWorker.ready.then(value => firstUse.registered(value)).catch(() => undefined);
}
window.addEventListener("pagehide", () => firstUse.dispose(), { once: true });
