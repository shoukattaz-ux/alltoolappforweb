package app.toolhaven.studio;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Pure helpers for files that other apps hand to ToolHaven ("Open with" and "Share"). Deliberately free of Android classes
 * so they can be unit-tested on a plain JVM.
 */
final class SharedFileUtil {
    /** At most this many files are taken from one share, matching the tools' own limit. */
    static final int MAX_FILES = 40;

    private SharedFileUtil() {}

    /** The file extension (with dot) that goes with a MIME type, or "" when unknown. */
    static String extensionFor(String mime) {
        if (mime == null) return "";
        switch (mime.toLowerCase(Locale.US)) {
            case "application/pdf": return ".pdf";
            case "image/jpeg": case "image/jpg": return ".jpg";
            case "image/png": return ".png";
            case "image/webp": return ".webp";
            case "video/mp4": return ".mp4";
            case "video/webm": return ".webm";
            case "video/quicktime": return ".mov";
            case "video/x-matroska": return ".mkv";
            default: return "";
        }
    }

    /** A safe display name: no path separators or control characters, a sensible length, and an extension when the MIME type implies one. */
    static String displayName(String raw, String lastPathSegment, String mime, int index) {
        String name = raw != null && !raw.trim().isEmpty() ? raw : lastPathSegment;
        if (name == null || name.trim().isEmpty()) name = "shared-file-" + (index + 1);
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) name = name.substring(slash + 1);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            sb.append(c < 32 || "<>:\"|?*".indexOf(c) >= 0 ? '_' : c);
        }
        name = sb.toString().trim();
        while (name.startsWith(".")) name = name.substring(1);
        if (name.length() > 120) {
            int dot = name.lastIndexOf('.');
            String ext = dot > 0 && name.length() - dot <= 8 ? name.substring(dot) : "";
            name = name.substring(0, 120 - ext.length()) + ext;
        }
        if (name.isEmpty()) name = "shared-file-" + (index + 1);
        String ext = extensionFor(mime);
        if (!ext.isEmpty() && !name.toLowerCase(Locale.US).endsWith(ext) && !hasKnownExtension(name)) name += ext;
        return name;
    }

    private static boolean hasKnownExtension(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0 || name.length() - dot > 6) return false;
        String e = name.substring(dot).toLowerCase(Locale.US);
        return e.equals(".pdf") || e.equals(".jpg") || e.equals(".jpeg") || e.equals(".png") || e.equals(".webp") || e.equals(".mp4") || e.equals(".m4v")
            || e.equals(".webm") || e.equals(".mov") || e.equals(".mkv");
    }

    /** Make names unique within one share ("a.pdf", "a (2).pdf"), so that two attachments called scan.pdf do not collide. */
    static String uniqueName(String name, Set<String> used) {
        String candidate = name; int n = 2;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name, ext = dot > 0 ? name.substring(dot) : "";
        while (!used.add(candidate.toLowerCase(Locale.US))) candidate = base + " (" + (n++) + ")" + ext;
        return candidate;
    }

    static Set<String> newNameSet() { return new HashSet<>(); }
}
