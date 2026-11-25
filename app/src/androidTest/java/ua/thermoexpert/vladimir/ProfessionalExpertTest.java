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
import java.util.concurrent.CountDownLatch;
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
            ((android.view.ViewGroup) activity.<android.view.ViewGroup>findViewById(android.R.id.content).getChildAt(0)).getChildAt(0));
        try {
            await("document.readyState === 'complete' && typeof goBack === 'function'");
            await("document.querySelector('.mockup-home-art').naturalWidth === 1024"
                + " && document.querySelector('.mockup-home-art').naturalHeight === 1231"
                + " && [...document.querySelectorAll('nav button img')].every(img => img.complete && img.naturalWidth > 0)");
            assertJs("document.body.classList.contains('home-screen')"
                + " && $('home').querySelector('.mockup-version').textContent === '1.2.1'"
                + " && $('home').querySelectorAll('.tile').length === 8"
                + " && $('home').textContent.includes('Швидкий початок')"
                + " && !$('home').querySelector('.stats') && !$('home').querySelector('[onclick=\"backup()\"]')");
            assertJs("[...document.querySelectorAll('nav button')].map(b=>b.dataset.tab).join(',') === 'home,catalog,workspace,archive,data,info'"
                + " && [...document.querySelectorAll('nav button')].every(b=>b.getBoundingClientRect().width >= 44"
                + " && b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().right <= innerWidth)"
                + " && document.querySelector('nav [aria-current=page]').dataset.tab === 'home'");
            saveScreenshot("home-test.png", true);
            js("window.messages = []; window.alert = message => messages.push(message); window.confirm = () => true");
            assertJs("data.clients[0].name === 'Клієнт 1.1.5' && data.orders[0].total === 550"
                + " && data.reports[0].id === 'legacy-report' && data.prices[0][1] === 550");
            assertJs("data.findings[0].photo.startsWith('data:image/png;base64,')");
            assertJs("$('countClients').textContent === '1' && $('countOrders').textContent === '1'"
                + " && $('countReports').textContent === '1' && $('sumPaid').textContent === '400 ₴'");
            click("nav [data-tab=workspace]");
            assertJs("$('workspace').classList.contains('active') && $('workspace').querySelectorAll('.stat').length === 4"
                + " && document.querySelector('nav [aria-current=page]').dataset.tab === 'workspace'");
            assertJs("['clients', 'orders', 'archive', 'orders'].every((panel, index) => {"
                + " const button = $('workspace').querySelectorAll('.stat')[index]; button.click();"
                + " const opened = $(panel).classList.contains('active'); goBack();"
                + " return opened && $('workspace').classList.contains('active'); })");
            saveScreenshot("workspace-test.png", false);
            click("nav [data-tab=data]");
            assertJs("$('data').classList.contains('active') && $('data').querySelectorAll('.actions button').length === 2"
                + " && $('data').querySelector('input[type=file]') !== null"
                + " && document.querySelector('nav [aria-current=page]').dataset.tab === 'data'");
            saveScreenshot("data-test.png", false);
            click("#backButton");
            assertJs("$('home').classList.contains('active')");
            click("#home .card .primary");
            assertJs("$('clients').classList.contains('active')");
            click("#backButton");
            click("#home .card .secondary");
            assertJs("$('inspection').classList.contains('active')");
            click("#backButton");
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
            assertJs("$('info').classList.contains('active') && $('info').textContent.includes('1.2.1')");

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

            click("nav [data-tab=data]");
            JSONObject manual = exportBackup("#data .actions button:first-child");
            JSONObject daily = exportBackup("#data .actions button:nth-child(2)");
            assertEquals(manual.toString(), daily.toString());
            assertEquals(2, daily.getJSONArray("clients").length());
            assertTrue(daily.getJSONArray("findings").getJSONObject(1).getString("photo").startsWith("data:image/png;base64,"));
            JSONArray storedFindings = new JSONObject(new String(Files.readAllBytes(new File(activity.getFilesDir(), "database.json").toPath()), StandardCharsets.UTF_8))
                .getJSONArray("findings");
            assertTrue(storedFindings.getJSONObject(1).getString("photo").startsWith("photo:"));

            click("nav [data-tab=catalog]");
            click("#catalog button:first-child");
            click("#clientList .item:nth-child(2) button");
            assertJs("data.clients.length === 1 && data.orders.length === 2 && data.reports.length === 2");
            click("nav [data-tab=data]");
            js("const restoreInput = new DataTransfer(); restoreInput.items.add(new File(["
                + JSONObject.quote(daily.toString()) + "], 'backup.json', {type:'application/json'}));"
                + " const backupInput = $('data').querySelector('input[type=file]');"
                + " backupInput.files = restoreInput.files;"
                + " backupInput.dispatchEvent(new Event('change'));");
            await("data.clients.length === 2 && messages.at(-1) === 'Резервну копію відновлено'");
            click("nav [data-tab=archive]");
            assertJs("$('archiveList').textContent.includes('Новий клієнт') && $('pdfList').textContent.includes('.pdf')");
            saveScreenshot("archive-test.png", false);
        } finally {
            instrumentation.runOnMainSync(activity::finish);
        }
    }

    private void saveScreenshot(String name, boolean verifyThermalArt) throws Exception {
        CountDownLatch frame = new CountDownLatch(1);
        instrumentation.runOnMainSync(() -> webView.postVisualStateCallback(0, new WebView.VisualStateCallback() {
            @Override public void onComplete(long requestId) {
                webView.postOnAnimation(() -> webView.postOnAnimation(frame::countDown));
            }
        }));
        assertTrue("WebView did not draw", frame.await(10, TimeUnit.SECONDS));

        for (int attempt = 0; attempt < 25; attempt++) {
            Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
            assertNotNull(screenshot);
            try {
                if (!verifyThermalArt || hasThermalArt(screenshot)) {
                    try (java.io.OutputStream output = activity.openFileOutput(name, 0)) {
                        assertTrue(screenshot.compress(Bitmap.CompressFormat.PNG, 100, output));
                    }
                    return;
                }
            } finally {
                screenshot.recycle();
            }
            Thread.sleep(160);
        }
        fail("The home screen artwork did not appear on the emulator display");
    }

    private boolean hasThermalArt(Bitmap screenshot) {
        int coloredSamples = 0;
        for (int y = screenshot.getHeight() / 12; y < screenshot.getHeight() / 3; y += 4) {
            for (int x = 0; x < screenshot.getWidth(); x += 4) {
                int pixel = screenshot.getPixel(x, y);
                int red = android.graphics.Color.red(pixel);
                int green = android.graphics.Color.green(pixel);
                int blue = android.graphics.Color.blue(pixel);
                if (red > 160 && red > green + 25 && red > blue + 30) coloredSamples++;
            }
        }
        return coloredSamples >= 45;
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
            // ACTION_CREATE_DOCUMENT returns a document that already exists.
            // MediaStore inserts the row first and materializes it on open.
            try (java.io.OutputStream destination = activity.getContentResolver().openOutputStream(uri)) {
                assertNotNull(destination);
            }
            Intent requested = captureIntent(selector, Intent.ACTION_CREATE_DOCUMENT,
                new Instrumentation.ActivityResult(Activity.RESULT_OK, new Intent().setData(uri)));
            assertEquals("application/json", requested.getType());
            for (int attempt = 0; attempt < 50; attempt++) {
                try (InputStream input = activity.getContentResolver().openInputStream(uri)) {
                    assertNotNull(input);
                    return new JSONObject(new String(input.readAllBytes(), StandardCharsets.UTF_8));
                } catch (org.json.JSONException | java.io.FileNotFoundException incomplete) {
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
