const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const packageName = 'com.zaparc.app';
const moduleSource = `package ${packageName}

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ZapArcMediaStoreModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "ZapArcMediaStore"

  @ReactMethod
  fun savePngToZapArcAlbum(sourceUri: String, fileName: String, promise: Promise) {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
      put(MediaStore.Images.Media.MIME_TYPE, "image/png")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        put(MediaStore.Images.Media.RELATIVE_PATH, "\${Environment.DIRECTORY_PICTURES}/ZapArc")
        put(MediaStore.Images.Media.IS_PENDING, 1)
      }
    }
    var destination: Uri? = null
    try {
      destination = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        ?: throw IllegalStateException("Unable to create gallery image")
      resolver.openInputStream(Uri.parse(sourceUri)).use { input ->
        requireNotNull(input) { "Unable to read captured QR image" }
        resolver.openOutputStream(destination).use { output ->
          requireNotNull(output) { "Unable to write gallery image" }
          input.copyTo(output)
        }
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        values.clear()
        values.put(MediaStore.Images.Media.IS_PENDING, 0)
        resolver.update(destination, values, null, null)
      }
      promise.resolve(destination.toString())
    } catch (error: Exception) {
      destination?.let { resolver.delete(it, null, null) }
      promise.reject("E_MEDIASTORE_SAVE", "Unable to save QR to ZapArc gallery", error)
    }
  }
}
`;

const packageSource = `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ZapArcMediaStorePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(ZapArcMediaStoreModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`;

module.exports = function withZapArcMediaStore(config) {
  return withDangerousMod(config, ['android', (modConfig) => {
    const sourceDir = path.join(modConfig.modRequest.platformProjectRoot, 'app/src/main/java', ...packageName.split('.'));
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'ZapArcMediaStoreModule.kt'), moduleSource);
    fs.writeFileSync(path.join(sourceDir, 'ZapArcMediaStorePackage.kt'), packageSource);

    const appPath = path.join(sourceDir, 'MainApplication.kt');
    const source = fs.readFileSync(appPath, 'utf8');
    const marker = 'packages.add(ZapArcMediaStorePackage())';
    if (!source.includes(marker)) {
      const updated = source.replace('val packages = PackageList(this).packages', `val packages = PackageList(this).packages\n            ${marker}`);
      if (updated === source) throw new Error('Unable to register ZapArcMediaStorePackage');
      fs.writeFileSync(appPath, updated);
    }
    return modConfig;
  }]);
};
