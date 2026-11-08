#include "webview.h"
#include <objbase.h>
#include <cwctype>
#include "../core/globals.h"
#include "../utils/helpers.h"
#include "../mpv/player.h"

namespace {
HANDLE mangaJob = nullptr;
HANDLE mangaProcess = nullptr;
std::wstring mangaUrl;
bool starting = false;

void ShowStartError() {
    MessageBoxW(g_hWnd, L"Confira os arquivos da pasta manga e se a porta local 11680 esta livre.",
                L"Leitor indisponivel", MB_ICONERROR);
}
}

bool IsHomeWebUri(const std::wstring& uri) {
    const auto scheme = g_webuiUrl.find(L"://");
    if (scheme == std::wstring::npos) return false;
    const auto path = g_webuiUrl.find(L'/', scheme + 3);
    const std::wstring origin = g_webuiUrl.substr(0, path);
    return uri == origin || uri.starts_with(origin + L"/");
}

bool IsMangaUri(const std::wstring& uri) {
    return !mangaUrl.empty() && uri.starts_with(mangaUrl);
}

void StopMangaServer() {
    if (mangaJob) CloseHandle(mangaJob);
    if (mangaProcess) CloseHandle(mangaProcess);
    mangaJob = mangaProcess = nullptr;
    mangaUrl.clear();
    starting = false;
}

void OpenMangaTab() {
    if (!g_webview || starting) return;
    if (mangaProcess && WaitForSingleObject(mangaProcess, 0) == WAIT_TIMEOUT) {
        FinishMangaTab(true);
        return;
    }
    StopMangaServer();
    const auto folder = GetExeDirectory();
    const auto runtime = folder + L"\\stremio-runtime.exe";
    if (!FileExists(runtime) || !FileExists(folder + L"\\manga\\server.js")) {
        ShowStartError();
        return;
    }
    GUID guid{};
    wchar_t guidText[40]{};
    if (FAILED(CoCreateGuid(&guid)) || !StringFromGUID2(guid, guidText, _countof(guidText))) {
        ShowStartError();
        return;
    }
    std::wstring token;
    for (const auto character : guidText)
        if (std::iswxdigit(character)) token += static_cast<wchar_t>(std::towlower(character));

    mangaJob = CreateJobObjectW(nullptr, nullptr);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    STARTUPINFOW startup{sizeof(STARTUPINFOW)};
    PROCESS_INFORMATION process{};
    std::wstring command = L"\"stremio-runtime.exe\" \"manga\\server.js\" " + token;
    if (!mangaJob || !SetInformationJobObject(mangaJob, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) ||
        !CreateProcessW(runtime.c_str(), command.data(), nullptr, nullptr, FALSE,
                        CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, folder.c_str(), &startup, &process)) {
        StopMangaServer();
        ShowStartError();
        return;
    }
    mangaProcess = process.hProcess;
    if (!AssignProcessToJobObject(mangaJob, mangaProcess) || ResumeThread(process.hThread) == DWORD(-1)) {
        TerminateProcess(mangaProcess, 1);
        CloseHandle(process.hThread);
        StopMangaServer();
        ShowStartError();
        return;
    }
    CloseHandle(process.hThread);
    mangaUrl = L"http://127.0.0.1:11680/" + token + L"/";
    starting = true;
    std::thread([health = mangaUrl + L"health", window = g_hWnd]() {
        bool ready = false;
        for (int tries = 0; tries < 20 && !ready; ++tries) {
            ready = IsEndpointReachable(health);
            if (!ready) Sleep(150);
        }
        PostMessageW(window, WM_MANGA_READY, ready, 0);
    }).detach();
}

void FinishMangaTab(bool ready) {
    starting = false;
    if (!ready) {
        StopMangaServer();
        ShowStartError();
    } else if (g_webview && !mangaUrl.empty()) {
        HandleMpvCommand({"stop"});
        ShowWindow(g_hWnd, SW_SHOW);
        g_webview->Navigate(mangaUrl.c_str());
    }
}
