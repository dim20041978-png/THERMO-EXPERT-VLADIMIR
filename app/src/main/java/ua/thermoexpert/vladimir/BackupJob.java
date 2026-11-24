package ua.thermoexpert.vladimir;

import android.app.job.JobService;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobInfo;
import android.content.ComponentName;
import android.content.Context;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

public class BackupJob extends JobService {
    private volatile Thread worker;
    public static void schedule(Context c) {
        JobScheduler scheduler = (JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        for (JobInfo job : scheduler.getAllPendingJobs()) if (job.getId() == 131) return;
        scheduler.schedule(new JobInfo.Builder(131, new ComponentName(c, BackupJob.class))
            .setPeriodic(24L * 60 * 60 * 1000).setPersisted(true).build());
    }
    public static synchronized boolean backup(Context c) throws Exception {
        File db = new File(c.getFilesDir(), "database.json");
        if (!db.exists() && !new File(db.getPath()+".bak").exists()) return true;
        File dir = new File(c.getFilesDir(), "backups");
        if (!dir.isDirectory() && !dir.mkdirs()) return false;
        String day = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT).format(new java.util.Date());
        File dest = new File(dir, day+".json");
        JSONObject root = new JSONObject(new String(new AtomicFile(db).readFully(), StandardCharsets.UTF_8));
        JSONArray findings = root.getJSONArray("findings");
        for (int i=0; i<findings.length(); i++) {
            JSONObject f = findings.getJSONObject(i);
            String photo = f.optString("photo", "");
            if (photo.startsWith("photo:")) {
                String key = photo.substring(6);
                if (!key.matches("[a-f0-9]{64}")) throw new IOException("Invalid photo key");
                File file = new File(new File(c.getFilesDir(), "photos"), key+".txt");
                f.put("photo", new String(new AtomicFile(file).readFully(), StandardCharsets.UTF_8));
            }
        }
        AtomicFile atomic = new AtomicFile(dest);
        FileOutputStream out = atomic.startWrite();
        try { out.write(root.toString().getBytes(StandardCharsets.UTF_8)); atomic.finishWrite(out); }
        catch (Exception e) { atomic.failWrite(out); throw e; }
        return true;
    }
    @Override public boolean onStartJob(JobParameters params) {
        worker = new Thread(() -> {
            boolean retry;
            try { retry = !backup(this); } catch (Exception e) { retry = true; }
            if (worker == Thread.currentThread()) jobFinished(params, retry);
        });
        worker.start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) {
        Thread t = worker; worker = null; if (t != null) t.interrupt(); return true;
    }
}
