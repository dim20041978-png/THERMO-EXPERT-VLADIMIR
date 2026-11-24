package ua.thermoexpert.vladimir;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private static final int FILE_CHOOSER_REQUEST = 1001;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        BackupJob.schedule(this);
        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
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
        if (savedInstanceState == null) webView.loadUrl("file:///android_asset/index.html");
        else webView.restoreState(savedInstanceState);
    }

    private String pendingBackup;
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
            java.io.File file = new java.io.File(getFilesDir(), "database.json");
            if (!file.exists() && !new java.io.File(file.getPath()+".bak").exists()) return "";
            try { return convertPhotos(new String(new android.util.AtomicFile(file).readFully(), java.nio.charset.StandardCharsets.UTF_8), true); }
            catch (Exception e) { return "ERROR"; }
        }
        @android.webkit.JavascriptInterface public boolean saveData(String json) {
            try { synchronized (BackupJob.class) { new org.json.JSONObject(json); writeAtomic(new java.io.File(getFilesDir(), "database.json"), convertPhotos(json, false)); return true; } }
            catch (Exception e) { return false; }
        }
        @android.webkit.JavascriptInterface public boolean dailyBackup(String json) {
            try { return BackupJob.backup(MainActivity.this); }
            catch (Exception e) { return false; }
        }

        @android.webkit.JavascriptInterface public void exportDailyBackup() {
            java.io.File dir = new java.io.File(getFilesDir(), "backups");
            java.io.File[] files = dir.listFiles((d,n) -> n.endsWith(".json"));
            if (files == null || files.length == 0) { runOnUiThread(() -> android.widget.Toast.makeText(MainActivity.this,"Немає автоматичних копій",0).show()); return; }
            java.util.Arrays.sort(files);
            try { exportBackup(new String(new android.util.AtomicFile(files[files.length-1]).readFully(), java.nio.charset.StandardCharsets.UTF_8)); }
            catch (Exception e) { runOnUiThread(() -> android.widget.Toast.makeText(MainActivity.this,"Помилка читання копії",1).show()); }
        }

        @android.webkit.JavascriptInterface public void savePdf(String json) {
            new Thread(() -> {
                String message;
                try { message = ReportPdf.save(MainActivity.this, json); }
                catch (Exception e) { message = "Помилка PDF: " + e.getMessage(); }
                final String result = message;
                runOnUiThread(() -> android.widget.Toast.makeText(MainActivity.this,result,1).show());
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
            runOnUiThread(() -> {
                pendingBackup = json;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE,"thermo-backup-"+System.currentTimeMillis()+".json");
                startActivityForResult(intent,1002);
            });
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
        if (requestCode == 1002) {
            if (resultCode == RESULT_OK && data != null && pendingBackup != null) {
                try (java.io.OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    if (out == null) throw new java.io.IOException();
                    out.write(pendingBackup.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    android.widget.Toast.makeText(this,"Копію збережено",0).show();
                } catch (Exception e) { android.widget.Toast.makeText(this,"Помилка збереження",1).show(); }
            }
            pendingBackup = null;
        }
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(results);
            fileCallback = null;
        }
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
