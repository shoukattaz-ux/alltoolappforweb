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
- **Scan to PDF, "Take a photo".** The button opens the phone's own camera app through the file picker, so the app needs **no camera permission**. The manifest only declares a `<queries>` entry for the camera action, which lets Android 11+ show the camera instead of silently falling back to the gallery. A `<queries>` entry is not a permission.
- **Open with / Share.** ToolHaven appears in other apps' "Open with" and Share menus for PDFs, images and videos (`ACTION_VIEW`, `ACTION_SEND`, `ACTION_SEND_MULTIPLE` in the manifest). `SharedFilesPlugin.java` reads each file's name, type, size and `content://` link and tells the page, which opens it through Capacitor's content URL and shows the same "what do you want to do?" list as the dashboard's file box. Nothing is copied to storage and no permission is needed: Android grants read access to just that file. The event is held until the page is listening, so a file that launches the app cold is not lost. The pure helpers have JVM unit tests (`./gradlew testDebugUnitTest`); the end-to-end flow is covered in the browser with a faked bridge, but it has **not** been run on a real phone.
- **Everything else is the web code**, unchanged: file pickers, PDF and image tools, calculators, and the video compressor (WebCodecs, hardware encoders where the phone has them). It needs a reasonably current Android System WebView (Chrome 94 or newer, kept up to date by Google Play).
- The app loads only its own bundled files over `https://localhost`. There is no remote content.

## Changing things

| To change | Do this |
| --- | --- |
| Name | `appName` in `capacitor.config.ts`, then `app_name` in `android/app/src/main/res/values/strings.xml` |
| Package id | `appId` in `capacitor.config.ts` and `applicationId`/`namespace` in `android/app/build.gradle`. **Choose it before your first Play Store upload: it can never change afterwards.** |
| Icons and splash | `npm run android:assets` (regenerates them from the logo; `SITE_NAME=Acme` rebrands) |
| Version | `VERSION_CODE` and `VERSION_NAME` environment variables (the release workflow sets them for you) |

After any web change run `npm run android:sync` so the APK contains it.

## Releasing on Google Play

The full, ordered checklist is in [PLAY-STORE.md](PLAY-STORE.md). In short: create a developer account, create an upload key and add four GitHub secrets, publish the privacy-policy page, run the **Android release** workflow to get a signed `.aab`, then create the app in Play Console and upload it to a closed-test track first.

Locally, a signed release build reads the key from environment variables (never from the repo):

```bash
export ANDROID_KEYSTORE_PATH=/path/to/upload.jks ANDROID_KEYSTORE_PASSWORD=... ANDROID_KEY_ALIAS=upload ANDROID_KEY_PASSWORD=...
export VERSION_CODE=2 VERSION_NAME=1.0.1     # VERSION_CODE must increase with every upload
npm run android:release                      # AAB: android/app/build/outputs/bundle/release/app-release.aab
```

## Known limits

- Not yet tried on a physical device: build it, install it, and run each tool once before releasing.
- Video compression speed depends on the phone's hardware encoder. Some phones have none for AV1, so that option is hidden there. This is expected.
- The browser CSP headers (`public/_headers`) do not apply inside the app. The app has no remote content and no network permission, which is a stronger guarantee.
