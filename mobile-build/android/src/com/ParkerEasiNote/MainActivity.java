package com.ParkerEasiNote;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.List;

/**
 * 极简 WebView 壳：页面从 assets/www/index.html 加载，不依赖 AndroidX，
 * 因此 APK 只有几百 KB。
 *
 * 相机 / 麦克风：清单里声明权限，这里做运行时申请；WebChromeClient
 * 把 WebView 的 getUserMedia 请求转成运行时权限，避免"页面有按钮但没反应"。
 */
public class MainActivity extends Activity {

    private static final int REQ_MEDIA = 1001;

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage：应用存设置/手势参数
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);      // 本地多文件页面互访
        s.setAllowUniversalAccessFromFileURLs(true); // 本地页面访问 assets 子资源
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(false);           // 按 CSS 像素渲染，和桌面一致
        s.setLoadWithOverviewMode(false);

        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // WebView 只有拿到 grant 才会真正打开摄像头/麦克风
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        request.grant(request.getResources());
                    }
                });
            }
        });
        web.setBackgroundColor(0xFF0F261E);
        setContentView(web);

        requestMediaPermissions();
        web.loadUrl("file:///android_asset/www/index.html");
    }

    /** 首次启动申请相机/麦克风；拒绝后页面仍可用，只是相关功能不可用。 */
    private void requestMediaPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return;
        }
        List<String> missing = new ArrayList<String>();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.CAMERA);
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.RECORD_AUDIO);
        }
        if (!missing.isEmpty()) {
            requestPermissions(missing.toArray(new String[0]), REQ_MEDIA);
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
