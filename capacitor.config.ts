import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android wrapper. The web app in dist/ is bundled into the APK and served locally over https://localhost,
 * which is a secure context (needed for WebCodecs, the clipboard and the file APIs). There is no remote content.
 * `appId` is the permanent Play Store identity: change it BEFORE the first release, never after.
 */
const config: CapacitorConfig = {
  appId: 'app.toolhaven.studio',
  appName: 'ToolHaven',
  webDir: 'dist',
  android: { backgroundColor: '#0d1730' },
  server: { androidScheme: 'https' },
  // Light status/navigation-bar icons on the dark navy backing colour.
  plugins: { SystemBars: { style: 'DARK' } },
};
export default config;
