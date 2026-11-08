#ifndef WEBVIEW_H
#define WEBVIEW_H

#include <windows.h>
#include <string>

void InitWebView2(HWND hWnd);
void WaitAndRefreshIfNeeded();
void refreshWeb(bool refreshAll);
void OpenMangaTab();
void FinishMangaTab(bool ready);
void StopMangaServer();
bool IsMangaUri(const std::wstring& uri);
bool IsHomeWebUri(const std::wstring& uri);
static void SetupWebMessageHandler();
static void SetupExtensions();
static void SetupWebMods();

#endif // WEBVIEW_H
