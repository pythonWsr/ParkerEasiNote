// 单文件 EXE 宿主：Win32 + WebView2（无 Electron），页面以 AES-256-CBC 密文内嵌。
//
// 同一份宿主可打包两种产品：
//   - 默认（无宏）          ：《人机验证》演示页，标题「机器人验证」
//   - /DPRODUCT_EASINOTE    ：快捷白板10，标题「快捷白板10」
//
// 装载方式：拦截 https://app.easinote.local/* 的请求，从内存返回解密后的 HTML，
// 这样页面运行在正常的 https 源上，localStorage / IndexedDB / 定时器等都能用
// （对比 NavigateToString 的不透明源，localStorage 会直接抛异常）。
//
// 加密方案与 scripts/encrypt.js 一致：PBKDF2-HMAC-SHA256(100000) → AES-256-CBC。
#include <windows.h>
#include <bcrypt.h>
#include <wrl.h>
#include <shlwapi.h>
#include <string>
#include <vector>
#include <cwchar>
#include <cstring>
#include "WebView2.h"
#include "payload_data.h"

#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "shell32.lib")

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

#ifdef PRODUCT_EASINOTE
#define APP_TITLE L"快捷白板10"
#define APP_W 1280
#define APP_H 820
#else
#define APP_TITLE L"机器人验证"
#define APP_W 1000
#define APP_H 760
#endif

namespace {

#define IDI_APP 101

const wchar_t* kOrigin = L"https://app.easinote.local/";
const wchar_t* kStartUrl = L"https://app.easinote.local/index.html";

/* 口令分段，与 scripts/encrypt.js 保持一致 */
const char* kPassA = "easi";
const char* kPassB = "note";
const char* kSalt = "ps.verify.2026";
const int kIter = 100000;

/* 清单里已声明 PerMonitorV2，这里再兜底调用一次（清单被剥离时也生效）。
   动态取函数，避免在旧系统上因缺少导出而加载失败。 */
void EnableDpiAwareness() {
    HMODULE user32 = GetModuleHandleW(L"user32.dll");
    if (!user32) return;
    typedef BOOL(WINAPI * SetDpiCtxFn)(HANDLE);
    auto fn = reinterpret_cast<SetDpiCtxFn>(GetProcAddress(user32, "SetProcessDpiAwarenessContext"));
    if (fn) fn(reinterpret_cast<HANDLE>(-4));  /* DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 */
}

ComPtr<ICoreWebView2Controller> g_controller;
std::string g_html;      /* 解密后的页面（UTF-8），仅存在内存 */
bool g_fullscreen = false;
LONG_PTR g_savedStyle = 0;
WINDOWPLACEMENT g_savedPlacement = {sizeof(WINDOWPLACEMENT)};

std::string DecryptPayload() {
    std::string pass = std::string(kPassA) + kPassB;
    BYTE key[32] = {0};

    BCRYPT_ALG_HANDLE hSha = nullptr;
    /* PBKDF2 的 PRF 句柄必须带 BCRYPT_ALG_HANDLE_HMAC_FLAG */
    if (BCryptOpenAlgorithmProvider(&hSha, BCRYPT_SHA256_ALGORITHM, nullptr,
                                    BCRYPT_ALG_HANDLE_HMAC_FLAG) != 0) {
        return std::string();
    }
    NTSTATUS st = BCryptDeriveKeyPBKDF2(
        hSha,
        reinterpret_cast<PUCHAR>(const_cast<char*>(pass.data())),
        static_cast<ULONG>(pass.size()),
        reinterpret_cast<PUCHAR>(const_cast<char*>(kSalt)),
        static_cast<ULONG>(strlen(kSalt)),
        kIter, key, sizeof(key), 0);
    BCryptCloseAlgorithmProvider(hSha, 0);
    if (st != 0) return std::string();

    BCRYPT_ALG_HANDLE hAes = nullptr;
    if (BCryptOpenAlgorithmProvider(&hAes, BCRYPT_AES_ALGORITHM, nullptr, 0) != 0) return std::string();
    BCryptSetProperty(hAes, BCRYPT_CHAINING_MODE,
        reinterpret_cast<PUCHAR>(const_cast<wchar_t*>(BCRYPT_CHAIN_MODE_CBC)),
        sizeof(BCRYPT_CHAIN_MODE_CBC), 0);

    BCRYPT_KEY_HANDLE hKey = nullptr;
    if (BCryptGenerateSymmetricKey(hAes, &hKey, nullptr, 0, key, sizeof(key), 0) != 0) {
        BCryptCloseAlgorithmProvider(hAes, 0);
        return std::string();
    }

    BYTE iv[16];
    DWORD outLen = 0;
    memcpy(iv, PAYLOAD_IV, sizeof(iv));
    if (BCryptDecrypt(hKey, const_cast<PUCHAR>(PAYLOAD_DATA), PAYLOAD_LEN, nullptr,
                      iv, sizeof(iv), nullptr, 0, &outLen, BCRYPT_BLOCK_PADDING) != 0) {
        BCryptDestroyKey(hKey);
        BCryptCloseAlgorithmProvider(hAes, 0);
        return std::string();
    }
    std::vector<BYTE> out(outLen);
    memcpy(iv, PAYLOAD_IV, sizeof(iv));
    NTSTATUS ds = BCryptDecrypt(hKey, const_cast<PUCHAR>(PAYLOAD_DATA), PAYLOAD_LEN, nullptr,
                                iv, sizeof(iv), out.data(), outLen, &outLen, BCRYPT_BLOCK_PADDING);
    BCryptDestroyKey(hKey);
    BCryptCloseAlgorithmProvider(hAes, 0);
    if (ds != 0) return std::string();

    out.resize(outLen);
    return std::string(out.begin(), out.end());
}

std::wstring GetModuleDir() {
    wchar_t path[MAX_PATH] = {0};
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    std::wstring s(path);
    size_t p = s.find_last_of(L"\\/");
    return p == std::wstring::npos ? std::wstring(L".") : s.substr(0, p);
}

std::wstring Basename(const std::wstring& path) {
    size_t p = path.find_last_of(L"\\/");
    return p == std::wstring::npos ? path : path.substr(p + 1);
}

std::wstring DownloadsDir() {
    wchar_t buf[MAX_PATH] = {0};
    DWORD n = GetEnvironmentVariableW(L"USERPROFILE", buf, MAX_PATH);
    if (n > 0 && n < MAX_PATH) return std::wstring(buf) + L"\\Downloads";
    return GetModuleDir();
}

void ToggleFullscreen(HWND hwnd, bool on) {
    if (on == g_fullscreen) return;
    g_fullscreen = on;
    if (on) {
        g_savedStyle = GetWindowLongPtrW(hwnd, GWL_STYLE);
        g_savedPlacement.length = sizeof(WINDOWPLACEMENT);
        GetWindowPlacement(hwnd, &g_savedPlacement);
        MONITORINFO mi = {sizeof(MONITORINFO)};
        if (GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mi)) {
            SetWindowLongPtrW(hwnd, GWL_STYLE, WS_POPUP | WS_VISIBLE);
            SetWindowPos(hwnd, HWND_TOP,
                         mi.rcMonitor.left, mi.rcMonitor.top,
                         mi.rcMonitor.right - mi.rcMonitor.left,
                         mi.rcMonitor.bottom - mi.rcMonitor.top,
                         SWP_FRAMECHANGED | SWP_NOOWNERZORDER);
        }
    } else {
        SetWindowLongPtrW(hwnd, GWL_STYLE, g_savedStyle);
        SetWindowPlacement(hwnd, &g_savedPlacement);
        SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOOWNERZORDER);
    }
}

/* 外部链接交给系统默认浏览器，不在应用内导航 */
bool OpenExternal(const std::wstring& url) {
    if (url.rfind(L"http://", 0) != 0 && url.rfind(L"https://", 0) != 0) return false;
    ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    return true;
}

void ServeRequest(ICoreWebView2Environment* env, ICoreWebView2WebResourceRequestedEventArgs* args) {
    ComPtr<ICoreWebView2WebResourceRequest> req;
    args->get_Request(&req);
    LPWSTR uriRaw = nullptr;
    if (req) req->get_Uri(&uriRaw);
    std::wstring uri = uriRaw ? uriRaw : L"";
    CoTaskMemFree(uriRaw);

    ComPtr<ICoreWebView2WebResourceResponse> response;
    const bool isIndex = (uri == kOrigin) || (uri == kStartUrl);
    if (isIndex) {
        IStream* stream = SHCreateMemStream(reinterpret_cast<const BYTE*>(g_html.data()),
                                            static_cast<UINT>(g_html.size()));
        env->CreateWebResourceResponse(stream, 200, L"OK", nullptr, &response);
        if (stream) stream->Release();
        if (response) {
            ComPtr<ICoreWebView2HttpResponseHeaders> headers;
            if (SUCCEEDED(response->get_Headers(&headers)) && headers) {
                headers->AppendHeader(L"Content-Type", L"text/html; charset=utf-8");
                headers->AppendHeader(L"Cache-Control", L"no-store");
            }
        }
    } else {
        /* 其余路径（src/*、DELETEME.md 等）一律 404，不触网 */
        env->CreateWebResourceResponse(nullptr, 404, L"Not Found", nullptr, &response);
    }
    args->put_Response(response.Get());
}

void InitWebView(HWND hwnd) {
    wchar_t buf[MAX_PATH] = {0};
    std::wstring userData;
    DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", buf, MAX_PATH);
    userData = (n > 0 && n < MAX_PATH) ? (std::wstring(buf) + L"\\ParkerEasiNoteWebView2")
                                       : (GetModuleDir() + L"\\ParkerEasiNoteWebView2");
    CreateDirectoryW(userData.c_str(), nullptr);

    auto envHandler = Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
        [hwnd](HRESULT hr, ICoreWebView2Environment* env) -> HRESULT {
            if (FAILED(hr) || !env) {
                MessageBoxW(hwnd,
                    L"未能初始化 WebView2。\n\n请先安装 Microsoft Edge WebView2 Runtime 后重试：\n"
                    L"https://go.microsoft.com/fwlink/p/?LinkId=2124703",
                    L"启动失败", MB_ICONERROR | MB_OK);
                return hr;
            }
            env->CreateCoreWebView2Controller(hwnd,
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [hwnd, env](HRESULT hr2, ICoreWebView2Controller* controller) -> HRESULT {
                        if (FAILED(hr2) || !controller) return hr2;
                        g_controller = controller;

                        ComPtr<ICoreWebView2> webview;
                        controller->get_CoreWebView2(&webview);
                        if (!webview) return E_FAIL;

                        ComPtr<ICoreWebView2Settings> settings;
                        webview->get_Settings(&settings);
                        if (settings) {
                            settings->put_AreDevToolsEnabled(FALSE);
                            settings->put_AreDefaultContextMenusEnabled(FALSE);
                            settings->put_IsStatusBarEnabled(FALSE);
                            settings->put_IsZoomControlEnabled(FALSE);
                            settings->put_AreDefaultScriptDialogsEnabled(TRUE);
                            settings->put_IsBuiltInErrorPageEnabled(FALSE);
                            ComPtr<ICoreWebView2Settings3> s3;
                            if (SUCCEEDED(settings.As(&s3))) {
                                s3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
                            }
                        }

                        EventRegistrationToken tok;

                        /* 内存服务页面：/ 与 /index.html 返回解密后的 HTML */
                        webview->AddWebResourceRequestedFilter(
                            L"https://app.easinote.local/*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
                        webview->add_WebResourceRequested(
                            Callback<ICoreWebView2WebResourceRequestedEventHandler>(
                                [env](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
                                    ServeRequest(env, args);
                                    return S_OK;
                                }).Get(), &tok);

                        /* 站外导航 → 系统浏览器 */
                        webview->add_NavigationStarting(
                            Callback<ICoreWebView2NavigationStartingEventHandler>(
                                [](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                                    LPWSTR uriRaw = nullptr;
                                    args->get_Uri(&uriRaw);
                                    std::wstring uri = uriRaw ? uriRaw : L"";
                                    CoTaskMemFree(uriRaw);
                                    if (uri.rfind(kOrigin, 0) == 0) return S_OK;
                                    args->put_Cancel(TRUE);
                                    OpenExternal(uri);
                                    return S_OK;
                                }).Get(), &tok);

                        /* window.open / target=_blank */
                        webview->add_NewWindowRequested(
                            Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                                [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                                    LPWSTR uriRaw = nullptr;
                                    args->get_Uri(&uriRaw);
                                    std::wstring uri = uriRaw ? uriRaw : L"";
                                    CoTaskMemFree(uriRaw);
                                    args->put_Handled(TRUE);
                                    OpenExternal(uri);
                                    return S_OK;
                                }).Get(), &tok);

                        /* 导出/下载：直接落到 下载 目录，不弹对话框
                           DownloadStarting 属于 ICoreWebView2_4，需要 QI */
                        ComPtr<ICoreWebView2_4> webview4;
                        if (SUCCEEDED(webview.As(&webview4))) webview4->add_DownloadStarting(
                            Callback<ICoreWebView2DownloadStartingEventHandler>(
                                [](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args) -> HRESULT {
                                    ComPtr<ICoreWebView2DownloadOperation> op;
                                    args->get_DownloadOperation(&op);
                                    LPWSTR pathRaw = nullptr;
                                    if (op) op->get_ResultFilePath(&pathRaw);
                                    std::wstring name = pathRaw ? Basename(pathRaw) : L"download.bin";
                                    CoTaskMemFree(pathRaw);
                                    if (name.empty()) name = L"download.bin";
                                    std::wstring target = DownloadsDir() + L"\\" + name;
                                    args->put_ResultFilePath(target.c_str());
                                    return S_OK;
                                }).Get(), &tok);

                        /* 页面进入全屏（放映模式）时同步窗口 */
                        webview->add_ContainsFullScreenElementChanged(
                            Callback<ICoreWebView2ContainsFullScreenElementChangedEventHandler>(
                                [hwnd](ICoreWebView2* sender, IUnknown*) -> HRESULT {
                                    BOOL fs = FALSE;
                                    sender->get_ContainsFullScreenElement(&fs);
                                    ToggleFullscreen(hwnd, fs != FALSE);
                                    return S_OK;
                                }).Get(), &tok);

                        webview->Navigate(kStartUrl);

                        RECT rc;
                        GetClientRect(hwnd, &rc);
                        controller->put_Bounds(rc);
                        return S_OK;
                    }).Get());
            return S_OK;
        });

    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(nullptr, userData.c_str(), nullptr,
                                                          envHandler.Get());
    if (FAILED(hr)) {
        MessageBoxW(hwnd,
            L"创建 WebView2 环境失败，请确认已安装 Microsoft Edge WebView2 Runtime。",
            L"启动失败", MB_ICONERROR | MB_OK);
    }
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_SIZE:
            if (g_controller) {
                RECT rc;
                GetClientRect(hwnd, &rc);
                g_controller->put_Bounds(rc);
            }
            return 0;
        case WM_DPICHANGED: {
            /* 跨屏移动时按系统建议的新矩形重排，避免缩放模糊 */
            RECT* r = reinterpret_cast<RECT*>(lp);
            if (r) {
                SetWindowPos(hwnd, nullptr, r->left, r->top,
                             r->right - r->left, r->bottom - r->top,
                             SWP_NOZORDER | SWP_NOACTIVATE);
            }
            return 0;
        }
        case WM_DESTROY:
            PostQuitMessage(0);
            return 0;
        default:
            break;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

}  // namespace

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, LPWSTR, int) {
    /* 自检模式：只跑解密链路，不建窗口。返回 0 = 成功，2 = 失败。 */
    if (wcsstr(GetCommandLineW(), L"--selftest") != nullptr) {
        std::string probe = DecryptPayload();
        const bool ok = probe.size() > 64 && probe.find("<!DOCTYPE") != std::string::npos;
        if (!probe.empty()) SecureZeroMemory(&probe[0], probe.size());
        return ok ? 0 : 2;
    }

    EnableDpiAwareness();
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    g_html = DecryptPayload();
    if (g_html.empty()) {
        MessageBoxW(nullptr, L"页面数据解密失败。", L"启动失败", MB_ICONERROR | MB_OK);
        return 1;
    }

    WNDCLASSEXW wc = {0};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    wc.hIcon = static_cast<HICON>(LoadImageW(hInst, MAKEINTRESOURCEW(IDI_APP), IMAGE_ICON,
                                             0, 0, LR_DEFAULTSIZE | LR_SHARED));
    wc.hIconSm = wc.hIcon;
    wc.lpszClassName = L"ParkerEasiNoteWindow";
    if (!RegisterClassExW(&wc)) return 1;

    HWND hwnd = CreateWindowExW(0, wc.lpszClassName, APP_TITLE, WS_OVERLAPPEDWINDOW,
                                CW_USEDEFAULT, CW_USEDEFAULT, APP_W, APP_H,
                                nullptr, nullptr, hInst, nullptr);
    if (!hwnd) return 1;

    ShowWindow(hwnd, SW_SHOW);
    UpdateWindow(hwnd);
    InitWebView(hwnd);

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    g_controller.Reset();
    g_html.clear();
    CoUninitialize();
    return 0;
}
