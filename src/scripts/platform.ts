/** True inside the Android app. The Capacitor bridge injects window.Capacitor before the page runs; on the web it does not exist. Kept free of plugin imports so the web build never pulls native code. */
export const isNativeApp = (): boolean => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
