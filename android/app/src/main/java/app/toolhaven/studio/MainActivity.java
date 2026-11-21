package app.toolhaven.studio;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SharedFilesPlugin.class); // must happen before super.onCreate
        super.onCreate(savedInstanceState);
    }
}
