package app.toolhaven.studio;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Set;
import org.junit.Test;

public class SharedFileUtilTest {
    @Test public void extensionsMatchTheSupportedTypes() {
        assertEquals(".pdf", SharedFileUtil.extensionFor("application/pdf")); assertEquals(".jpg", SharedFileUtil.extensionFor("IMAGE/JPEG"));
        assertEquals(".mp4", SharedFileUtil.extensionFor("video/mp4")); assertEquals(".mov", SharedFileUtil.extensionFor("video/quicktime"));
        assertEquals("", SharedFileUtil.extensionFor("text/plain")); assertEquals("", SharedFileUtil.extensionFor(null));
    }

    @Test public void usesTheProvidedNameAndFallsBackSensibly() {
        assertEquals("Invoice.pdf", SharedFileUtil.displayName("Invoice.pdf", null, "application/pdf", 0));
        assertEquals("fromPath.pdf", SharedFileUtil.displayName(null, "fromPath", "application/pdf", 0));
        assertEquals("shared-file-3.png", SharedFileUtil.displayName("", "  ", "image/png", 2));
        assertEquals("shared-file-1", SharedFileUtil.displayName(null, null, "text/plain", 0));
    }

    @Test public void addsAnExtensionOnlyWhenMissing() {
        assertEquals("scan.pdf", SharedFileUtil.displayName("scan", null, "application/pdf", 0));
        assertEquals("photo.jpeg", SharedFileUtil.displayName("photo.jpeg", null, "image/jpeg", 0));
        assertEquals("IMG.JPG", SharedFileUtil.displayName("IMG.JPG", null, "image/jpeg", 0));
    }

    @Test public void stripsPathsAndUnsafeCharacters() {
        assertEquals("passwd.pdf", SharedFileUtil.displayName("../../etc/passwd.pdf", null, "application/pdf", 0));
        assertEquals("c_d.pdf", SharedFileUtil.displayName("a\\b\\c:d.pdf", null, "application/pdf", 0));
        assertEquals("hidden.png", SharedFileUtil.displayName(".hidden.png", null, "image/png", 0));
        assertFalse(SharedFileUtil.displayName("a\u0000b\nc?.pdf", null, "application/pdf", 0).matches(".*[\\u0000-\\u001f?].*"));
    }

    @Test public void longNamesAreShortenedButKeepTheirExtension() {
        StringBuilder sb = new StringBuilder(); for (int i = 0; i < 300; i++) sb.append('x');
        String n = SharedFileUtil.displayName(sb + ".pdf", null, "application/pdf", 0);
        assertTrue(n.length() <= 120); assertTrue(n.endsWith(".pdf"));
    }

    @Test public void duplicateNamesGetNumbered() {
        Set<String> used = SharedFileUtil.newNameSet();
        assertEquals("scan.pdf", SharedFileUtil.uniqueName("scan.pdf", used));
        assertEquals("scan (2).pdf", SharedFileUtil.uniqueName("scan.pdf", used));
        assertEquals("SCAN (3).pdf", SharedFileUtil.uniqueName("SCAN.pdf", used)); // clashes ignore case; the name keeps the caller's capitalisation
        assertEquals("noext", SharedFileUtil.uniqueName("noext", used));
        assertEquals("noext (2)", SharedFileUtil.uniqueName("noext", used));
    }

    @Test public void theFileLimitMatchesTheTools() { assertEquals(40, SharedFileUtil.MAX_FILES); }
}
