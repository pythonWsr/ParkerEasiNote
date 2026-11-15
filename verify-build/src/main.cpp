// 人机验证页面 → 极简单文件 EXE（WebView2 + Win32，无 Electron）
//
// 体积来源：仅 MSVC 静态 CRT + WebView2LoaderStatic，页面以 AES-256-CBC 密文
// 内嵌在二进制里，运行时解密为内存字符串后 NavigateToString。
//
// 加固：
//  * 明文页面不落盘（密文内嵌，运行时解密）
//  * 关闭 DevTools、F12 / Ctrl+Shift+I/J/C、Ctrl+U / Ctrl+S 等浏览器快捷键
//  * 关闭默认右键菜单、状态栏、缩放控件
//  * 禁止 NewWindowRequested（window.open）
//
// 加密方案与 scripts/encrypt.js 保持一致：PBKDF2-HMAC-SHA256(100000) → AES-256-CBC。
#include <windows.h>
#include <bcrypt.h>
#include <wrl.h>
#include <cstring>
#include <cwchar>
#include <string>
#include <vector>
#include "WebView2.h"
#include "payload_data.h"

#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {

/* 口令分段，与 scripts/encrypt.js 保持一致 */
const char* kPassA = "easi";
const char* kPassB = "note";
const char* kSalt = "ps.verify.2026";
const int kIter = 100000;

ComPtr<ICoreWebView2Controller> g_controller;
std::wstring g_html;

std::string DecryptPayload() {
    std::string pass = std::string(kPassA) + kPassB;
    BYTE key[32] = {0};

    BCRYPT_ALG_HANDLE hSha = nullptr;
    /* PBKDF2 的 PRF 句柄必须带 BCRYPT_ALG_HANDLE_HMAC_FLAG，否则 BCryptDeriveKeyPBKDF2
       返回 STATUS_INVALID_PARAMETER，表现为「页面数据解密失败」 */
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

std::wstring Utf8ToWide(const std::string& s) {
    if (s.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    if (n <= 0) return std::wstring();
    std::wstring w(static_cast<size_t>(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), &w[0], n);
    return w;
}

void InitWebView(HWND hwnd) {
    wchar_t buf[MAX_PATH] = {0};
    std::wstring userData;
    DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", buf, MAX_PATH);
    if (n > 0 && n < MAX_PATH) {
        userData = std::wstring(buf) + L"\\VerifyDemoWebView2";
    } else {
        userData = L".\\VerifyDemoWebView2";
    }
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
                    [hwnd](HRESULT hr2, ICoreWebView2Controller* controller) -> HRESULT {
                        if (FAILED(hr2) || !controller) return hr2;
                        g_controller = controller;

                        ComPtr<ICoreWebView2> webview;
                        controller->get_CoreWebView2(&webview);

                        ComPtr<ICoreWebView2Settings> settings;
                        if (webview) webview->get_Settings(&settings);
                        if (settings) {
                            settings->put_AreDevToolsEnabled(FALSE);
                            settings->put_AreDefaultContextMenusEnabled(FALSE);
                            settings->put_IsStatusBarEnabled(FALSE);
                            settings->put_IsZoomControlEnabled(FALSE);
                            ComPtr<ICoreWebView2Settings3> s3;
                            if (SUCCEEDED(settings.As(&s3))) {
                                s3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
                            }
                        }

                        if (webview) {
                            EventRegistrationToken token;
                            webview->add_NewWindowRequested(
                                Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                                    [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                                        args->put_Handled(TRUE);
                                        return S_OK;
                                    }).Get(), &token);
                            webview->NavigateToString(g_html.c_str());
                        }

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
    /* 自检模式：只跑解密链路，不建窗口。CI 用来验证真实二进制里的解密是否正常。
       返回 0 = 成功，2 = 解密失败。 */
    if (wcsstr(GetCommandLineW(), L"--selftest") != nullptr) {
        std::string probe = DecryptPayload();
        const bool ok = probe.size() > 100 && probe.compare(0, 14, "<!DOCTYPE html") == 0;
        SecureZeroMemory(&probe[0], probe.size());
        return ok ? 0 : 2;
    }

    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    std::string html8 = DecryptPayload();
    if (html8.empty()) {
        MessageBoxW(nullptr, L"页面数据解密失败。", L"启动失败", MB_ICONERROR | MB_OK);
        return 1;
    }
    g_html = Utf8ToWide(html8);
    SecureZeroMemory(&html8[0], html8.size());

    WNDCLASSEXW wc = {0};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    wc.lpszClassName = L"VerifyDemoWindow";
    if (!RegisterClassExW(&wc)) return 1;

    HWND hwnd = CreateWindowExW(0, wc.lpszClassName, L"机器人验证", WS_OVERLAPPEDWINDOW,
                                CW_USEDEFAULT, CW_USEDEFAULT, 1000, 760,
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
    CoUninitialize();
    return 0;
}
