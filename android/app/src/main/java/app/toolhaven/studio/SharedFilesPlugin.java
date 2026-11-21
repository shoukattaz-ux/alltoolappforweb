package app.toolhaven.studio;

import android.content.ContentResolver;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Receives files that other apps open with, or share to, ToolHaven (a file manager's "Open with", WhatsApp, Gmail, the Share sheet)
 * and tells the web page about them. Nothing is copied: the page reads each file straight through its content:// link, which Android
 * grants to this app only for the file that was shared. The app asks for no storage permission.
 *
 * The event is retained until the page registers its listener, so a file that starts the app cold is not lost.
 */
@CapacitorPlugin(name = "SharedFiles")
public class SharedFilesPlugin extends Plugin {

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (intent == null) return;
        // Re-opening the app from the recent-apps list re-delivers the old intent: that is not a new share.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        String action = intent.getAction();
        if (!Intent.ACTION_VIEW.equals(action) && !Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;

        List<Uri> uris = extractUris(intent, action);
        if (uris.isEmpty()) return;

        ContentResolver resolver = getContext().getContentResolver();
        JSArray files = new JSArray();
        Set<String> used = SharedFileUtil.newNameSet();
        int skipped = 0;
        for (int i = 0; i < uris.size(); i++) {
            if (files.length() >= SharedFileUtil.MAX_FILES) { skipped = uris.size() - i; break; }
            Uri uri = uris.get(i);
            String display = null; long size = -1;
            try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME), s = c.getColumnIndex(OpenableColumns.SIZE);
                    if (n >= 0 && !c.isNull(n)) display = c.getString(n);
                    if (s >= 0 && !c.isNull(s)) size = c.getLong(s);
                }
            } catch (Exception ignored) { /* the provider may not support the query: the name falls back below */ }
            String mime = null;
            try { mime = resolver.getType(uri); } catch (Exception ignored) { /* use the intent's type */ }
            if (mime == null) mime = intent.getType();
            JSObject f = new JSObject();
            f.put("uri", uri.toString());
            f.put("name", SharedFileUtil.uniqueName(SharedFileUtil.displayName(display, uri.getLastPathSegment(), mime, i), used));
            f.put("mimeType", mime == null ? "" : mime);
            f.put("size", size);
            files.put(f);
        }
        JSObject data = new JSObject();
        data.put("files", files);
        data.put("skipped", skipped);
        notifyListeners("sharedFiles", data, true);
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> extractUris(Intent intent, String action) {
        List<Uri> out = new ArrayList<>();
        if (Intent.ACTION_VIEW.equals(action)) {
            if (intent.getData() != null) out.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) out.add(u);
        } else {
            ArrayList<Uri> list = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class) : intent.<Uri>getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) for (Uri u : list) if (u != null) out.add(u);
        }
        if (out.isEmpty()) { // some apps put the file in the clip data instead
            ClipData clip = intent.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) { Uri u = clip.getItemAt(i).getUri(); if (u != null) out.add(u); }
        }
        return out;
    }
}
