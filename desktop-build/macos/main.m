// 单文件 DMG 宿主：AppKit + WKWebView（无 Electron、无第三方依赖）
// 页面以单文件 index.html 放在 .app/Contents/Resources/ 里，启动后本地加载。
//
// 构建：desktop-build/macos/build.sh（在 macOS runner 上执行）

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface EN10AppDelegate : NSObject <NSApplicationDelegate>
@property (strong) NSWindow *window;
@property (strong) WKWebView *webView;
@end

@implementation EN10AppDelegate

- (void)installMenu
{
    NSMenu *bar = [[NSMenu alloc] init];

    NSMenuItem *appItem = [[NSMenuItem alloc] init];
    [bar addItem:appItem];

    NSMenu *appMenu = [[NSMenu alloc] init];
    [appMenu addItemWithTitle:@"关于 快捷白板10"
                       action:@selector(orderFrontStandardAboutPanel:)
                keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *hide = [[NSMenuItem alloc] initWithTitle:@"隐藏 快捷白板10"
                                                 action:@selector(hide:)
                                          keyEquivalent:@"h"];
    [appMenu addItem:hide];
    [appMenu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *quit = [[NSMenuItem alloc] initWithTitle:@"退出 快捷白板10"
                                                 action:@selector(terminate:)
                                          keyEquivalent:@"q"];
    [appMenu addItem:quit];

    appItem.submenu = appMenu;
    NSApp.mainMenu = bar;
}

- (void)applicationDidFinishLaunching:(NSNotification *)note
{
    [self installMenu];

    NSRect frame = NSMakeRect(0, 0, 1280, 800);
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                              NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;

    self.window = [[NSWindow alloc] initWithContentRect:frame
                                              styleMask:style
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    [self.window setTitle:@"快捷白板10"];
    [self.window setMinSize:NSMakeSize(800, 600)];
    [self.window setReleasedWhenClosed:NO];
    [self.window center];

    WKWebViewConfiguration *cfg = [[WKWebViewConfiguration alloc] init];
    self.webView = [[WKWebView alloc] initWithFrame:frame configuration:cfg];
    [self.webView setAutoresizingMask:NSViewWidthSizable | NSViewHeightSizable];
    [self.window setContentView:self.webView];

    NSString *path = [[NSBundle mainBundle] pathForResource:@"index" ofType:@"html"];
    if (path == nil) {
        NSLog(@"[EN10] 找不到 index.html");
        [NSApp terminate:nil];
        return;
    }
    NSURL *url = [NSURL fileURLWithPath:path];
    [self.webView loadFileURL:url allowingReadAccessToURL:[url URLByDeletingLastPathComponent]];

    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender
{
    return YES;
}

@end

int main(int argc, const char *argv[])
{
    @autoreleasepool {
        [NSApplication sharedApplication];
        EN10AppDelegate *delegate = [[EN10AppDelegate alloc] init];
        [NSApp setDelegate:delegate];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
        [NSApp run];
    }
    return 0;
}
