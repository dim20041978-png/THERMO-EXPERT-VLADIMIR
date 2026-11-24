package ua.thermoexpert.vladimir;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.*;

public class ProfessionalExpertTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private MainActivity activity;
    private WebView webView;

    @Test public void upgradeAndUseProfessionalExpert() throws Exception {
        Intent launch = new Intent(instrumentation.getTargetContext(), MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity = (MainActivity) instrumentation.startActivitySync(launch);
        instrumentation.runOnMainSync(() -> webView = (WebView)
            ((android.view.ViewGroup) activity.findViewById(android.R.id.content).getChildAt(0)).getChildAt(0));
        try {
            await("document.readyState === 'complete' && typeof goBack === 'function'");
            assertJs("document.images.length >= 12 && Array.from(document.images).every(i => i.naturalWidth > 0)");
            js("window.messages = []; window.alert = message => messages.push(message); window.confirm = () => true");
            assertJs("data.clients[0].name === 'Клієнт 1.1.5' && data.orders[0].total === 550"
                + " && data.reports[0].id === 'legacy-report' && data.prices[0][1] === 550");
            assertJs("data.findings[0].photo.startsWith('data:image/png;base64,')");
            assertJs("[...document.querySelectorAll('[data-inspection]')].length === 6");
            assertJs("[...document.querySelectorAll('[data-inspection]')].every(button => {"
                + " button.click(); const ok = document.querySelector('.panel.active').id === 'inspection'"
                + " && $('iType').value === button.dataset.inspection; $('backButton').click();"
                + " return ok && document.querySelector('.panel.active').id === 'home'; })");
            click("#home .tile:last-child");
            assertJs("document.querySelector('.panel.active').id === 'settings'");
            click("#settings > button");
            assertJs("$('price-0').value === '550'");
            js("$('price-0').value = 575.25");
            click("#prices .primary");
            assertJs("data.prices[0][1] === 575.25 && messages.at(-1) === 'Прайс збережено'");
            instrumentation.runOnMainSync(activity::onBackPressed);
            await("document.querySelector('.panel.active').id === 'settings'");
            click("nav [data-tab=info]");
            assertJs("$('info').classList.contains('active') && $('info').textContent.includes('1.2.0')");

            click("nav [data-tab=catalog]");
            click("#catalog button:first-child");
            js("$('cName').value = 'Новий клієнт'; $('cAddress').value = 'Нова адреса'");
            click("#clients .primary");
            assertJs("data.clients.length === 2 && $('clientList').textContent.includes('Новий клієнт')");
            click("nav [data-tab=catalog]");
            click("#catalog button:nth-child(2)");
            js("$('oClient').selectedIndex = 1; $('oService').selectedIndex = 1;"
                + " $('oService').dispatchEvent(new Event('change')); $('oQty').value = 2;"
                + " $('oDiscount').value = 50.25; $('oDiscount').dispatchEvent(new Event('input')); $('oPaid').value = 100.25");
            assertJs("$('oTotal').textContent === '1100.25'");
            click("#orders .primary");
            assertJs("data.orders.length === 2 && data.orders[0].total === 1100.25");

            click("nav [data-tab=home]");
            click("[data-inspection]:nth-child(3)");
            js("$('iClient').selectedIndex = 1; $('iClient').dispatchEvent(new Event('change'));"
                + " $('iRoom').value = 'Кухня'; $('iDefect').value = 'Ділянка біля вікна';"
                + " $('iAir').value = 19.5; $('iSurface').value = 0; $('iHumidity').value = 49;"
                + " const inputPhoto = new DataTransfer();"
                + " inputPhoto.items.add(new File([Uint8Array.from(atob(data.findings[0].photo.split(',')[1]),"
                + " c => c.charCodeAt(0))], 'thermal.png', {type:'image/png'})); $('iPhoto').files = inputPhoto.files;");
            click("#addFindingButton");
            await("data.findings.length === 2 && !$('addFindingButton').disabled");
            assertJs("$('findingList').textContent.includes('Кухня') && $('findingList').querySelector('img') !== null");
            js("$('iConclusion').value = 'Новий висновок'");
            click("#inspection button[onclick='makeReport()']");
            assertJs("$('reportContent').textContent.includes('Новий висновок') && $('report').classList.contains('active')");
            click("#report button[onclick='goBack()']");
            click("#inspection button[onclick='saveReport()']");
            assertJs("$('archive').classList.contains('active') && data.reports.length === 2");
            click("#archiveList .item:nth-child(2) button");
            assertJs("$('reportContent').textContent.includes('Висновок 1.1.5')"
                + " && $('reportContent').querySelector('img').getAttribute('src').startsWith('data:image/png;base64,')");

            click("#report button[onclick='savePdf()']");
            await("JSON.parse(Native.listPdfs()).length === 1");
            File report = verifyPdf();
            assertTrue(report.getName().endsWith(".pdf"));
            click("#report button[onclick='goBack()']");
            assertJs("$('archive').classList.contains('active') && $('pdfList').textContent.includes('.pdf')");
            checkPdfIntent("#pdfList button:first-child", Intent.ACTION_VIEW);
            checkPdfIntent("#pdfList button:nth-child(2)", Intent.ACTION_SEND);
            click("#archive .section-heading button");
            assertJs("$('pdfList').querySelectorAll('button').length === 2");

            click("nav [data-tab=home]");
            click("#home .tile:last-child");
            JSONObject manual = exportBackup("#settings .actions button:first-child");
            JSONObject daily = exportBackup("#settings .actions button:nth-child(2)");
            assertEquals(manual.toString(), daily.toString());
            assertEquals(2, daily.getJSONArray("clients").length());
            assertTrue(daily.getJSONArray("findings").getJSONObject(1).getString("photo").startsWith("data:image/png;base64,"));
            JSONArray storedFindings = new JSONObject(Files.readString(new File(activity.getFilesDir(), "database.json").toPath()))
                .getJSONArray("findings");
            assertTrue(storedFindings.getJSONObject(1).getString("photo").startsWith("photo:"));

            click("nav [data-tab=catalog]");
            click("#catalog button:first-child");
            click("#clientList .item:nth-child(2) button");
            assertJs("data.clients.length === 1 && data.orders.length === 2 && data.reports.length === 2");
            click("nav [data-tab=home]");
            click("#home .tile:last-child");
            js("const restoreInput = new DataTransfer(); restoreInput.items.add(new File(["
                + JSONObject.quote(daily.toString()) + "], 'backup.json', {type:'application/json'}));"
                + " $('restoreFile').files = restoreInput.files;"
                + " $('restoreFile').dispatchEvent(new Event('change'));");
            await("data.clients.length === 2 && messages.at(-1) === 'Резервну копію відновлено'");
            click("nav [data-tab=archive]");
            assertJs("$('archiveList').textContent.includes('Новий клієнт') && $('pdfList').textContent.includes('.pdf')");
            try (java.io.OutputStream screenshot = activity.openFileOutput("archive-test.png", 0)) {
                instrumentation.getUiAutomation().takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, screenshot);
            }
        } finally {
            instrumentation.runOnMainSync(activity::finish);
        }
    }

    private File verifyPdf() throws Exception {
        File[] reports = new File(activity.getFilesDir(), "pdf_reports").listFiles(file -> file.getName().endsWith(".pdf"));
        assertNotNull(reports);
        assertEquals(1, reports.length);
        try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(reports[0], ParcelFileDescriptor.MODE_READ_ONLY);
             PdfRenderer renderer = new PdfRenderer(descriptor);
             PdfRenderer.Page page = renderer.openPage(0)) {
            assertTrue(renderer.getPageCount() >= 1);
            Bitmap pixels = Bitmap.createBitmap(page.getWidth(), page.getHeight(), Bitmap.Config.ARGB_8888);
            try {
                page.render(pixels, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                assertTrue(pixels.getWidth() > 500);
            } finally {
                pixels.recycle();
            }
        }
        return reports[0];
    }

    private void checkPdfIntent(String selector, String expectedAction) throws Exception {
        Intent chooser = captureIntent(selector, Intent.ACTION_CHOOSER, new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null));
        Intent target = chooser.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        assertNotNull(target);
        assertEquals(expectedAction, target.getAction());
        assertEquals("application/pdf", target.getType());
        assertTrue((target.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
        Uri pdf = Intent.ACTION_VIEW.equals(expectedAction) ? target.getData()
            : target.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        assertNotNull(pdf);
        try (InputStream input = activity.getContentResolver().openInputStream(pdf)) {
            assertNotNull(input);
            assertArrayEquals("%PDF".getBytes(StandardCharsets.US_ASCII), input.readNBytes(4));
        }
    }

    private JSONObject exportBackup(String selector) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, "test-" + System.nanoTime() + ".json");
        values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
        Uri uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        assertNotNull(uri);
        try {
            Intent requested = captureIntent(selector, Intent.ACTION_CREATE_DOCUMENT,
                new Instrumentation.ActivityResult(Activity.RESULT_OK, new Intent().setData(uri)));
            assertEquals("application/json", requested.getType());
            for (int attempt = 0; attempt < 30; attempt++) {
                try (InputStream input = activity.getContentResolver().openInputStream(uri)) {
                    assertNotNull(input);
                    return new JSONObject(new String(input.readAllBytes(), StandardCharsets.UTF_8));
                } catch (org.json.JSONException incomplete) {
                    Thread.sleep(150);
                }
            }
            throw new AssertionError("Backup file was not written");
        } finally {
            activity.getContentResolver().delete(uri, null, null);
        }
    }

    private Intent captureIntent(String selector, String action, Instrumentation.ActivityResult response) throws Exception {
        ArrayBlockingQueue<Intent> result = new ArrayBlockingQueue<>(1);
        Instrumentation.ActivityMonitor monitor = new Instrumentation.ActivityMonitor() {
            @Override public Instrumentation.ActivityResult onStartActivity(Intent intent) {
                if (!action.equals(intent.getAction())) return null;
                result.offer(intent);
                return response;
            }
        };
        instrumentation.addMonitor(monitor);
        try {
            click(selector);
            Intent captured = result.poll(10, TimeUnit.SECONDS);
            assertNotNull("Expected " + action, captured);
            return captured;
        } finally {
            instrumentation.removeMonitor(monitor);
        }
    }

    private void click(String selector) throws Exception {
        assertJs("(() => { const button = document.querySelector(" + JSONObject.quote(selector)
            + "); if (!button || !button.getClientRects().length) return false; button.click(); return true; })()");
    }

    private void await(String condition) throws Exception {
        for (int attempt = 0; attempt < 40; attempt++) {
            if ("true".equals(js(condition))) return;
            Thread.sleep(250);
        }
        assertJs(condition);
    }

    private void assertJs(String script) throws Exception {
        assertEquals(script, "true", js(script));
    }

    private String js(String script) throws Exception {
        ArrayBlockingQueue<String> result = new ArrayBlockingQueue<>(1);
        instrumentation.runOnMainSync(() -> webView.evaluateJavascript(script, result::offer));
        String value = result.poll(15, TimeUnit.SECONDS);
        assertNotNull("WebView timed out: " + script, value);
        return value;
    }
}
