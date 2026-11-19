# Android app

The Android app is this same web app, bundled into a native shell with [Capacitor](https://capacitorjs.com). One codebase, 16 tools, no server. Files stay on the device, and the app declares **no Android permissions at all** (in particular no `INTERNET`), so the operating system itself stops it from sending anything over the network.

## Build a debug APK (to install on a phone)

Requirements: Node 22, JDK 21, the Android SDK (Android Studio installs both).

```bash
npm ci
npm run android:debug            # builds the web app, syncs it, runs Gradle
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Or open it in Android Studio: `npm run android:sync && npm run android:open`.

GitHub Actions builds the same APK on every push and pull request (`.github/workflows/android.yml`) and attaches it to the run as the `toolhaven-debug-apk` artifact. The job also fails if the APK ever asks for the `INTERNET` permission.

## What is different on Android

- **Saving files.** WebView cannot download files, so results are written to app-private cache storage and opened in Android's share sheet (`src/scripts/native.ts`). From there you pick "Save to Files", Drive, WhatsApp, email and so on. Large videos are written in 3 MB pieces.
- **Everything else is the web code**, unchanged: file pickers, PDF and image tools, calculators, and the video compressor (WebCodecs, hardware encoders where the phone has them). It needs a reasonably current Android System WebView (Chrome 94 or newer, kept up to date by Google Play).
- The app loads only its own bundled files over `https://localhost`. There is no remote content.

## Changing things

| To change | Do this |
| --- | --- |
| Name | `appName` in `capacitor.config.ts`, then `app_name` in `android/app/src/main/res/values/strings.xml` |
| Package id | `appId` in `capacitor.config.ts` and `applicationId`/`namespace` in `android/app/build.gradle`. **Choose it before your first Play Store upload: it can never change afterwards.** |
| Icons and splash | `npm run android:assets` (regenerates them from the logo; `SITE_NAME=Acme` rebrands) |
| Version | `versionCode` (must increase with every upload) and `versionName` in `android/app/build.gradle` |

After any web change run `npm run android:sync` so the APK contains it.

## Releasing on Google Play

1. Pick the final `appId` and brand name (see above).
2. Create an upload keystore and keep it, and its passwords, somewhere safe. Losing it blocks future updates:
   `keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`
3. Add a `signingConfigs.release` block to `android/app/build.gradle` that reads the keystore path and passwords from environment variables or `~/.gradle/gradle.properties` (never commit them).
4. Build the Play bundle: `cd android && ./gradlew bundleRelease` and upload `app/build/outputs/bundle/release/app-release.aab`.
5. In Play Console: the Data safety form can truthfully say the app collects no data and shares none; the privacy policy URL is the deployed `#/privacy` page. Test on a few real devices first, including a low-end one with video.

## Known limits

- Not yet tried on a physical device: build it, install it, and run each tool once before releasing.
- Video compression speed depends on the phone's hardware encoder. Some phones have none for AV1, so that option is hidden there. This is expected.
- The browser CSP headers (`public/_headers`) do not apply inside the app. The app has no remote content and no network permission, which is a stronger guarantee.
