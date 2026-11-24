package ua.thermoexpert.vladimir;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int BACKUP_REQUEST = 1002;
    private java.io.File pendingBackup;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        BackupJob.schedule(this);
        webView = new WebView(this);
        FrameLayout content = new FrameLayout(this);
        content.setBackgroundColor(0xff092443);
        content.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        if (Build.VERSION.SDK_INT >= 35) {
            content.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(content);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::navigateBack);
        }
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) { return true; }
        });
        webView.addJavascriptInterface(new Bridge(), "Native");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = params.createIntent();
                try { startActivityForResult(intent, FILE_CHOOSER_REQUEST); }
                catch (Exception e) { fileCallback.onReceiveValue(null); fileCallback = null; return true; }
                return true;
            }
        });
        if (savedInstanceState != null) {
            String name = savedInstanceState.getString("pendingBackup");
            if (name != null) pendingBackup = new java.io.File(getCacheDir(), name);
        }
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl("file:///android_asset/index.html");
        }
    }

    private synchronized void writeAtomic(java.io.File file, String value) throws java.io.IOException {
        android.util.AtomicFile atomic = new android.util.AtomicFile(file);
        java.io.FileOutputStream out = atomic.startWrite();
        try { out.write(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)); atomic.finishWrite(out); }
        catch (java.io.IOException e) { atomic.failWrite(out); throw e; }
    }
    public class Bridge {
        private java.io.File photoFile(String key) throws java.io.IOException {
            if (!key.matches("[a-f0-9]{64}")) throw new java.io.IOException("Invalid photo key");
            java.io.File dir = new java.io.File(getFilesDir(), "photos");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new java.io.IOException("Photo directory");
            return new java.io.File(dir, key + ".txt");
        }
        private String convertPhotos(String json, boolean export) throws Exception {
            org.json.JSONObject root = new org.json.JSONObject(json);
            org.json.JSONArray findings = root.getJSONArray("findings");
            for (int i=0;i<findings.length();i++) {
                org.json.JSONObject f = findings.getJSONObject(i);
                String photo = f.optString("photo", "");
                if (photo.startsWith("data:image/") && !export) {
                    byte[] hash = java.security.MessageDigest.getInstance("SHA-256").digest(photo.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    StringBuilder key = new StringBuilder();
                    for (byte b:hash) key.append(String.format(java.util.Locale.ROOT,"%02x", b & 255));
                    java.io.File file = photoFile(key.toString());
                    if (!file.exists()) writeAtomic(file, photo);
                    f.put("photo", "photo:" + key);
                } else if (photo.startsWith("photo:")) {
                    java.io.File file = photoFile(photo.substring(6));
                    if (export) f.put("photo", new String(new android.util.AtomicFile(file).readFully(), java.nio.charset.StandardCharsets.UTF_8));
                    else if (!file.exists()) throw new java.io.IOException("Missing photo");
                }
            }
            return root.toString();
        }
        @android.webkit.JavascriptInterface public String loadData() {
            synchronized (BackupJob.class) {
                java.io.File file = new java.io.File(getFilesDir(), "database.json");
                if (!file.exists() && !new java.io.File(file.getPath() + ".bak").exists()) return "";
                try {
                    byte[] bytes = new android.util.AtomicFile(file).readFully();
                    return convertPhotos(new String(bytes, java.nio.charset.StandardCharsets.UTF_8), true);
                } catch (Exception error) {
                    return "ERROR";
                }
            }
        }

        @android.webkit.JavascriptInterface public boolean saveData(String json) {
            synchronized (BackupJob.class) {
                try {
                    writeAtomic(new java.io.File(getFilesDir(), "database.json"), convertPhotos(json, false));
                    return true;
                } catch (Exception error) {
                    return false;
                }
            }
        }

        @android.webkit.JavascriptInterface public boolean dailyBackup() {
            try { return BackupJob.backup(MainActivity.this); }
            catch (Exception error) { return false; }
        }

        @android.webkit.JavascriptInterface public void exportDailyBackup() {
            synchronized (BackupJob.class) {
                java.io.File dir = new java.io.File(getFilesDir(), "backups");
                java.io.File[] files = dir.listFiles((parent, name) -> name.matches("\\d{4}-\\d{2}-\\d{2}\\.json"));
                if (files == null || files.length == 0) {
                    toast("Немає автоматичних копій");
                    return;
                }
                java.util.Arrays.sort(files);
                try {
                    byte[] bytes = new android.util.AtomicFile(files[files.length - 1]).readFully();
                    exportBackup(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
                } catch (Exception error) {
                    toast("Помилка читання копії");
                }
            }
        }

        @android.webkit.JavascriptInterface public void savePdf(String json) {
            new Thread(() -> {
                String message;
                try { message = ReportPdf.save(MainActivity.this, json); }
                catch (Exception e) { message = "Помилка PDF: " + e.getMessage(); }
                final String result = message;
                toast(result);
            }).start();
        }
        @android.webkit.JavascriptInterface public void sharePdf(String json) {
            new Thread(() -> {
                try { java.io.File[] file = new java.io.File[1]; ReportPdf.save(MainActivity.this,json,file); runOnUiThread(() -> openPdf(file[0],true)); }
                catch(Exception e) { runOnUiThread(() -> android.widget.Toast.makeText(MainActivity.this,"Помилка створення PDF",1).show()); }
            }).start();
        }
        @android.webkit.JavascriptInterface public String listPdfs() {
            org.json.JSONArray a=new org.json.JSONArray();
            java.io.File[] files=new java.io.File(getFilesDir(),"pdf_reports").listFiles((d,n)->n.endsWith(".pdf"));
            if(files!=null){java.util.Arrays.sort(files,java.util.Comparator.comparing(java.io.File::getName).reversed());for(java.io.File f:files)a.put(f.getName());}
            return a.toString();
        }
        @android.webkit.JavascriptInterface public void archivedPdf(String name,boolean share) {
            if(!name.matches("THERMO-[a-zA-Z0-9_-]+\\.pdf"))return;
            java.io.File f=new java.io.File(new java.io.File(getFilesDir(),"pdf_reports"),name);
            runOnUiThread(() -> openPdf(f,share));
        }
        @android.webkit.JavascriptInterface public void printReport() {
            runOnUiThread(() -> {
                android.print.PrintManager pm = (android.print.PrintManager)getSystemService(PRINT_SERVICE);
                pm.print("THERMO-EXPERT-" + System.currentTimeMillis(), webView.createPrintDocumentAdapter("THERMO EXPERT"), new android.print.PrintAttributes.Builder().setMediaSize(android.print.PrintAttributes.MediaSize.ISO_A4).build());
            });
        }
        @android.webkit.JavascriptInterface public void exportBackup(String json) {
            try {
                java.io.File snapshot = java.io.File.createTempFile("backup-export-", ".json", getCacheDir());
                try {
                    writeAtomic(snapshot, json);
                } catch (java.io.IOException error) {
                    snapshot.delete();
                    throw error;
                }
                runOnUiThread(() -> chooseBackupDestination(snapshot));
            } catch (java.io.IOException error) {
                toast("Не вдалося підготувати резервну копію");
            }
        }
    }

    private void toast(String message) {
        runOnUiThread(() -> android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show());
    }

    private void chooseBackupDestination(java.io.File snapshot) {
        if (pendingBackup != null) {
            snapshot.delete();
            return;
        }
        pendingBackup = snapshot;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json").putExtra(Intent.EXTRA_TITLE,
                "thermo-backup-" + System.currentTimeMillis() + ".json");
        try {
            startActivityForResult(intent, BACKUP_REQUEST);
        } catch (android.content.ActivityNotFoundException error) {
            pendingBackup = null;
            snapshot.delete();
            toast("Не знайдено програму для збереження копії");
        }
    }

    private void openPdf(java.io.File file,boolean share) {
        try {
            if(file==null||!file.isFile())throw new java.io.IOException();
            Uri uri=androidx.core.content.FileProvider.getUriForFile(this,getPackageName()+".pdfprovider",file);
            Intent intent=new Intent(share?Intent.ACTION_SEND:Intent.ACTION_VIEW);
            if(share){intent.setType("application/pdf");intent.putExtra(Intent.EXTRA_STREAM,uri);}else intent.setDataAndType(uri,"application/pdf");
            intent.setClipData(android.content.ClipData.newRawUri("PDF",uri));intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(intent,share?"Надіслати PDF":"Відкрити PDF"));
        }catch(Exception e){android.widget.Toast.makeText(this,"Не вдалося відкрити PDF. Перевірте наявність програми перегляду.",1).show();}
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == BACKUP_REQUEST && pendingBackup != null) {
            java.io.File snapshot = pendingBackup;
            pendingBackup = null;
            Uri destination = data == null ? null : data.getData();
            if (resultCode != RESULT_OK || destination == null) {
                snapshot.delete();
            } else {
                new Thread(() -> saveBackupTo(snapshot, destination)).start();
            }
        }
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(results);
            fileCallback = null;
        }
    }

    private void saveBackupTo(java.io.File snapshot, Uri destination) {
        try (java.io.InputStream in = new java.io.FileInputStream(snapshot);
             java.io.OutputStream out = getContentResolver().openOutputStream(destination, "wt")) {
            if (out == null) throw new java.io.IOException("Backup destination unavailable");
            byte[] buffer = new byte[8192];
            int size;
            while ((size = in.read(buffer)) != -1) out.write(buffer, 0, size);
            toast("Копію збережено");
        } catch (Exception error) {
            toast("Помилка збереження копії");
        } finally {
            snapshot.delete();
        }
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
        if (pendingBackup != null) outState.putString("pendingBackup", pendingBackup.getName());
    }

    private void navigateBack() {
        webView.evaluateJavascript("typeof goBack === 'function' && goBack()", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    @Override public void onBackPressed() {
        navigateBack();
    }
}
