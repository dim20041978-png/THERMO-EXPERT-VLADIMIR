package ua.thermoexpert.vladimir;

import android.content.*;
import android.graphics.*;
import android.graphics.pdf.PdfDocument;
import android.os.Build;
import android.provider.MediaStore;
import android.text.*;
import java.io.*;
import org.json.*;

final class ReportPdf implements AutoCloseable {
    private final PdfDocument doc = new PdfDocument();
    private PdfDocument.Page page;
    private int number=0, y;
    private final TextPaint paint=new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private void next(){
        if(page!=null)doc.finishPage(page);
        page=doc.startPage(new PdfDocument.PageInfo.Builder(595,842,++number).create());
        y=40;
        paint.setColor(Color.DKGRAY);paint.setTextSize(10);paint.setTypeface(Typeface.DEFAULT);
        page.getCanvas().drawText("THERMO EXPERT VLADIMIR  •  "+number,40,815,paint);
    }
    private void text(String value, boolean bold){
        paint.setColor(Color.BLACK);paint.setTextSize(bold?15:12);paint.setTypeface(bold?Typeface.DEFAULT_BOLD:Typeface.DEFAULT);
        StaticLayout layout=StaticLayout.Builder.obtain(value,0,value.length(),paint,515).setIncludePad(false).build();
        for(int i=0;i<layout.getLineCount();i++){
            int h=layout.getLineBottom(i)-layout.getLineTop(i);
            if(y+h>790){next();paint.setColor(Color.BLACK);paint.setTextSize(bold?15:12);paint.setTypeface(bold?Typeface.DEFAULT_BOLD:Typeface.DEFAULT);}
            Canvas canvas=page.getCanvas();canvas.save();canvas.clipRect(40,y,555,y+h);canvas.translate(40,y-layout.getLineTop(i));layout.draw(canvas);canvas.restore();y+=h;
        } y+=7;
    }
    private void photo(String value){
        if(!value.startsWith("data:image/"))return;
        try{
            byte[] bytes=android.util.Base64.decode(value.substring(value.indexOf(',')+1),android.util.Base64.DEFAULT);
            BitmapFactory.Options o=new BitmapFactory.Options();o.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,o);o.inSampleSize=1;
            while(Math.max(o.outWidth,o.outHeight)/o.inSampleSize>1800)o.inSampleSize*=2;
            o.inJustDecodeBounds=false;Bitmap b=BitmapFactory.decodeByteArray(bytes,0,bytes.length,o);if(b==null)throw new IOException();
            try{float scale=Math.min(515f/b.getWidth(),340f/b.getHeight());float w=b.getWidth()*scale,h=b.getHeight()*scale;if(y+h>790)next();page.getCanvas().drawBitmap(b,null,new RectF(40,y,40+w,y+h),new Paint(Paint.FILTER_BITMAP_FLAG));y+=(int)Math.ceil(h)+10;}finally{b.recycle();}
        }catch(Exception e){text("Фото не вдалося відобразити",false);}
    }
    static String save(Context context,String json)throws Exception{ return save(context,json,null); }
    static String save(Context context,String json,File[] result)throws Exception{
        JSONObject r=new JSONObject(json),c=r.getJSONObject("c");JSONArray fs=r.getJSONArray("fs");
        File dir=new File(context.getFilesDir(),"pdf_reports");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("Архів недоступний");
        String name="THERMO-"+new java.text.SimpleDateFormat("yyyy-MM-dd_HH-mm-ss",java.util.Locale.ROOT).format(new java.util.Date())+"-"+java.util.UUID.randomUUID().toString().substring(0,8)+".pdf";
        File file=new File(dir,name),tmp=new File(dir,name+".tmp");
        try(ReportPdf p=new ReportPdf()){
            p.next();p.text("ЗВІТ ТЕПЛОВІЗІЙНОГО ОБСТЕЖЕННЯ",true);p.text("THERMO EXPERT VLADIMIR",true);p.text("Дата: "+r.optString("date"),false);
            p.text("Замовник: "+c.optString("name")+"\nТелефон: "+c.optString("phone")+"\nАдреса: "+c.optString("address")+"\nТип об’єкта: "+c.optString("type"),false);
            for(int i=0;i<fs.length();i++){JSONObject f=fs.getJSONObject(i);p.text((i+1)+". "+f.optString("room",f.optString("type")),true);p.text("Напрямок: "+f.optString("type")+"\nТемпература повітря: "+f.optString("air")+" °C\nТемпература поверхні: "+f.optString("surface")+" °C\nВологість: "+f.optString("humidity")+" %\nСпостереження: "+f.optString("defect")+"\nРекомендації: "+f.optString("recommendation"),false);p.photo(f.optString("photo"));}
            p.text("Підсумковий висновок експерта",true);p.text(r.optString("conclusion")+"\nВиконавець: "+r.optString("expert")+"\nПідпис: ____________________",false);p.text("Висновок потребує перевірки й затвердження відповідальним фахівцем.",false);
            p.doc.finishPage(p.page);p.page=null;try(FileOutputStream out=new FileOutputStream(tmp)){p.doc.writeTo(out);out.getFD().sync();}if(!tmp.renameTo(file))throw new IOException("Не вдалося зберегти архів");
        }finally{tmp.delete();}
        if(result!=null)result[0]=file;
        if(Build.VERSION.SDK_INT<29)return "PDF збережено в архіві програми";
        android.net.Uri uri=null;try{
            ContentValues v=new ContentValues();v.put(MediaStore.MediaColumns.DISPLAY_NAME,name);v.put(MediaStore.MediaColumns.MIME_TYPE,"application/pdf");v.put(MediaStore.MediaColumns.RELATIVE_PATH,"Download/THERMO EXPERT");v.put(MediaStore.MediaColumns.IS_PENDING,1);
            ContentResolver resolver=context.getContentResolver();uri=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,v);if(uri==null)throw new IOException();
            try(InputStream in=new FileInputStream(file);OutputStream out=resolver.openOutputStream(uri)){if(out==null)throw new IOException();byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);}
            v.clear();v.put(MediaStore.MediaColumns.IS_PENDING,0);resolver.update(uri,v,null,null);return "PDF збережено в архіві та Завантаженнях";
        }catch(Exception e){if(uri!=null)try{context.getContentResolver().delete(uri,null,null);}catch(Exception ignored){}return "PDF в архіві; не вдалося скопіювати в Завантаження";}
    }
    public void close(){if(page!=null)doc.finishPage(page);doc.close();}
}
