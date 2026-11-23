package com.ParkerEasiNote;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * 极简 WebView 壳：页面从 assets/www/index.html 加载，不依赖 AndroidX。
 *
 * 与浏览器的差异在此补齐：
 *  - 文件选择：WebView 默认不弹系统选择器，必须实现 onShowFileChooser
 *  - 相机/麦克风：清单声明 + 运行时申请 + onPermissionRequest 放行
 *  - JS 报错：onConsoleMessage 写 logcat，未捕获异常用 Toast 提示（便于真机定位）
 */
public class MainActivity extends Activity {

    private static final String TAG = "EasiNote";
    private static final int REQ_MEDIA = 1001;
    private static final int REQ_FILE = 1002;

    /** 页面加载后挂 JS 错误钩子，未捕获异常通过 HostBridge 弹 Toast + 写 logcat。 */
    private static final String JS_ERROR_HOOK =
            "(function(){if(window.__enErrHooked)return;window.__enErrHooked=1;"
            + "window.addEventListener('error',function(e){try{EasiNoteHost.report("
            + "(e.message||'')+' @'+(e.filename||'').split('/').pop()+':'+(e.lineno||0));}catch(_){}});"
            + "window.addEventListener('unhandledrejection',function(e){try{EasiNoteHost.report("
            + "'Promise: '+((e.reason&&e.reason.message)||e.reason));}catch(_){}});})();";

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
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
        s.setJavaScriptCanOpenWindowsAutomatically(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(JS_ERROR_HOOK, null);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                // 只放行本地资源；外部链接交给系统浏览器，避免在无地址栏的壳里“卡死”
                if (url.startsWith("file://") || url.startsWith("about:") || url.startsWith("data:")) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {
                }
                return true;
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("file://") || url.startsWith("about:") || url.startsWith("data:")) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        web.addJavascriptInterface(new HostBridge(), "EasiNoteHost");
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        request.grant(request.getResources());
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception exc) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器：" + exc.getMessage(),
                            Toast.LENGTH_LONG).show();
                    return false;
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                Log.d(TAG, "[JS] " + msg.message() + " @" + msg.sourceId() + ":" + msg.lineNumber());
                return true;
            }

        });
        web.setBackgroundColor(0xFF0F261E);
        setContentView(web);

        requestMediaPermissions();
        web.loadUrl("file:///android_asset/www/index.html");
    }

    /** 页面脚本通过它上报未捕获异常，真机上能直接看到原因。 */
    private class HostBridge {
        @JavascriptInterface
        public void report(String message) {
            Log.e(TAG, "[JS-ERROR] " + message);
            final String text = message == null ? "" : message;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, "脚本错误：" + text, Toast.LENGTH_LONG).show();
                }
            });
        }
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
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback == null) {
                super.onActivityResult(requestCode, resultCode, data);
                return;
            }
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(results);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
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
