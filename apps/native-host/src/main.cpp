#include <windows.h>

#if defined(TRANSLATE_TER_WITH_WEBVIEW2)
#include <WebView2.h>
#include <wrl.h>
#endif

#include <array>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace {

constexpr wchar_t kWindowClassName[] = L"TranslateTerNativeHostWindow";
constexpr wchar_t kFrontendVirtualHost[] = L"translate-ter.local";

struct BackendProcess {
  HANDLE process = nullptr;
  HANDLE thread = nullptr;
  HANDLE job = nullptr;
  HANDLE stdin_write = nullptr;
  HANDLE stdout_read = nullptr;
  HANDLE stderr_read = nullptr;
  std::wstring executable;
  std::wstring status = L"Backend has not started.";

  ~BackendProcess() {
    stop();
  }

  BackendProcess() = default;
  BackendProcess(const BackendProcess&) = delete;
  BackendProcess& operator=(const BackendProcess&) = delete;

  void stop() {
    if (stdin_write) {
      CloseHandle(stdin_write);
      stdin_write = nullptr;
    }
    if (stdout_read) {
      CloseHandle(stdout_read);
      stdout_read = nullptr;
    }
    if (stderr_read) {
      CloseHandle(stderr_read);
      stderr_read = nullptr;
    }

    if (process) {
      DWORD exit_code = 0;
      if (GetExitCodeProcess(process, &exit_code) && exit_code == STILL_ACTIVE) {
        TerminateProcess(process, 0);
        WaitForSingleObject(process, 3000);
      }
    }

    if (thread) {
      CloseHandle(thread);
      thread = nullptr;
    }
    if (process) {
      CloseHandle(process);
      process = nullptr;
    }
    if (job) {
      CloseHandle(job);
      job = nullptr;
    }
  }
};

BackendProcess g_backend;
std::wstring g_status = L"Translate-Ter native host is starting.";

#if defined(TRANSLATE_TER_WITH_WEBVIEW2)
ICoreWebView2Controller* g_webview_controller = nullptr;
ICoreWebView2* g_webview = nullptr;
#endif

std::wstring get_last_error_message(DWORD error_code) {
  LPWSTR buffer = nullptr;
  const DWORD size = FormatMessageW(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
      nullptr,
      error_code,
      MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
      reinterpret_cast<LPWSTR>(&buffer),
      0,
      nullptr);

  std::wstring message = size > 0 && buffer ? std::wstring(buffer, size) : L"Unknown Windows error.";
  if (buffer) LocalFree(buffer);
  while (!message.empty() && (message.back() == L'\r' || message.back() == L'\n' || message.back() == L'.')) {
    message.pop_back();
  }
  return message;
}

std::filesystem::path executable_dir() {
  std::array<wchar_t, MAX_PATH> buffer{};
  const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  return std::filesystem::path(std::wstring(buffer.data(), length)).parent_path();
}

std::vector<std::filesystem::path> backend_candidates() {
  const auto base = executable_dir();
  return {
      base / L"app" / L"backend" / L"translate-ter-backend.exe",
      base / L"translate-ter-backend.exe",
      base.parent_path() / L"backend" / L"cpp" / L"build" / L"bin" / L"translate-ter-backend.exe",
      std::filesystem::current_path() / L"backend" / L"cpp" / L"build" / L"bin" / L"translate-ter-backend.exe",
      std::filesystem::current_path() / L"backend" / L"cpp" / L"build" / L"Release" / L"translate-ter-backend.exe",
  };
}

std::vector<std::filesystem::path> frontend_candidates() {
  const auto base = executable_dir();
  return {
      base / L"app" / L"frontend" / L"index.html",
      base.parent_path().parent_path().parent_path() / L"out" / L"renderer" / L"index.html",
      std::filesystem::current_path() / L"out" / L"renderer" / L"index.html",
  };
}

std::wstring quote_arg(const std::filesystem::path& value) {
  std::wstring escaped = L"\"";
  for (wchar_t ch : value.wstring()) {
    if (ch == L'"') escaped += L'\\';
    escaped += ch;
  }
  escaped += L"\"";
  return escaped;
}

bool start_backend() {
  for (const auto& candidate : backend_candidates()) {
    if (!std::filesystem::exists(candidate)) continue;

    SECURITY_ATTRIBUTES pipe_security{};
    pipe_security.nLength = sizeof(pipe_security);
    pipe_security.bInheritHandle = TRUE;

    HANDLE stdin_read = nullptr;
    HANDLE stdin_write = nullptr;
    HANDLE stdout_read = nullptr;
    HANDLE stdout_write = nullptr;
    HANDLE stderr_read = nullptr;
    HANDLE stderr_write = nullptr;

    auto close_local_handles = [&]() {
      if (stdin_read) CloseHandle(stdin_read);
      if (stdin_write) CloseHandle(stdin_write);
      if (stdout_read) CloseHandle(stdout_read);
      if (stdout_write) CloseHandle(stdout_write);
      if (stderr_read) CloseHandle(stderr_read);
      if (stderr_write) CloseHandle(stderr_write);
    };

    if (!CreatePipe(&stdin_read, &stdin_write, &pipe_security, 0) ||
        !CreatePipe(&stdout_read, &stdout_write, &pipe_security, 0) ||
        !CreatePipe(&stderr_read, &stderr_write, &pipe_security, 0)) {
      const auto error = GetLastError();
      close_local_handles();
      g_backend.status = L"Failed to create backend stdio pipes: " + get_last_error_message(error);
      return false;
    }

    SetHandleInformation(stdin_write, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(stderr_read, HANDLE_FLAG_INHERIT, 0);

    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    if (!job) {
      close_local_handles();
      g_backend.status = L"Failed to create backend cleanup job: " + get_last_error_message(GetLastError());
      return false;
    }

    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
      const auto error = GetLastError();
      CloseHandle(job);
      close_local_handles();
      g_backend.status = L"Failed to configure backend cleanup job: " + get_last_error_message(error);
      return false;
    }

    std::wstring command_line = quote_arg(candidate) + L" --stdio-json";
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = stdin_read;
    startup.hStdOutput = stdout_write;
    startup.hStdError = stderr_write;
    PROCESS_INFORMATION process_info{};

    const BOOL created = CreateProcessW(
        nullptr,
        command_line.data(),
        nullptr,
        nullptr,
        TRUE,
        CREATE_NO_WINDOW,
        nullptr,
        candidate.parent_path().c_str(),
        &startup,
        &process_info);

    if (!created) {
      const auto error = GetLastError();
      CloseHandle(job);
      close_local_handles();
      g_backend.status = L"Failed to start backend: " + get_last_error_message(error);
      return false;
    }

    CloseHandle(stdin_read);
    stdin_read = nullptr;
    CloseHandle(stdout_write);
    stdout_write = nullptr;
    CloseHandle(stderr_write);
    stderr_write = nullptr;

    if (!AssignProcessToJobObject(job, process_info.hProcess)) {
      const auto error = GetLastError();
      TerminateProcess(process_info.hProcess, 1);
      CloseHandle(process_info.hThread);
      CloseHandle(process_info.hProcess);
      CloseHandle(job);
      close_local_handles();
      g_backend.status = L"Failed to attach backend cleanup job: " + get_last_error_message(error);
      return false;
    }

    g_backend.job = job;
    g_backend.process = process_info.hProcess;
    g_backend.thread = process_info.hThread;
    g_backend.stdin_write = stdin_write;
    g_backend.stdout_read = stdout_read;
    g_backend.stderr_read = stderr_read;
    g_backend.executable = candidate.wstring();
    g_backend.status = L"Backend running: " + candidate.wstring();
    return true;
  }

  g_backend.status = L"Backend executable was not found. Build it or package app/backend/translate-ter-backend.exe.";
  return false;
}

void draw_text_block(HDC dc, RECT rect, std::wstring_view title, std::wstring_view body) {
  SetBkMode(dc, TRANSPARENT);
  SetTextColor(dc, RGB(28, 31, 36));

  HFONT title_font = CreateFontW(26, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                                 CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
  HFONT body_font = CreateFontW(16, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                                CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");

  const auto old_font = SelectObject(dc, title_font);
  RECT title_rect = rect;
  title_rect.bottom = title_rect.top + 48;
  DrawTextW(dc, title.data(), static_cast<int>(title.size()), &title_rect, DT_LEFT | DT_TOP | DT_SINGLELINE);

  SelectObject(dc, body_font);
  RECT body_rect = rect;
  body_rect.top += 58;
  DrawTextW(dc, body.data(), static_cast<int>(body.size()), &body_rect, DT_LEFT | DT_TOP | DT_WORDBREAK);

  SelectObject(dc, old_font);
  DeleteObject(title_font);
  DeleteObject(body_font);
}

#if defined(TRANSLATE_TER_WITH_WEBVIEW2)
std::wstring frontend_host_script() {
  return LR"JS(
(() => {
  const now = () => new Date().toISOString();
  const settings = {
    schemaVersion: 1,
    uiLanguage: 'en-US',
    sourceLanguage: 'auto',
    targetLanguage: 'zh-CN',
    asrProviderId: 'mock.asr',
    whisperModelId: 'ggml-base',
    translationProviderPriority: ['mock.local'],
    translationConcurrency: 2
  };
  const mockSegments = () => ([
    { id: 'seg-0001', index: 1, startMs: 900, endMs: 3100, sourceText: 'Welcome to Translate-Ter.', status: 'transcribed', confidence: 0.92 },
    { id: 'seg-0002', index: 2, startMs: 3600, endMs: 6200, sourceText: 'The native entry host is now rendering this web UI.', status: 'transcribed', confidence: 0.92 }
  ]);
  const makeJob = (input = {}) => ({
    id: 'native-preview-job',
    mediaPath: input.mediaPath || '',
    fileName: input.mediaPath ? input.mediaPath.split(/[\\/]/).pop() : 'Native host preview',
    step: 'subtitles',
    stage: 'completed',
    progress: 100,
    sourceLanguage: input.sourceLanguage || settings.sourceLanguage,
    targetLanguage: input.targetLanguage || settings.targetLanguage,
    asrProviderId: input.asrProviderId || settings.asrProviderId,
    whisperModelId: input.whisperModelId || settings.whisperModelId,
    translationProviderPriority: input.translationProviderPriority || settings.translationProviderPriority,
    subtitleDocument: {
      id: 'native-preview-document',
      format: 'srt',
      sourceLanguage: input.sourceLanguage || settings.sourceLanguage,
      targetLanguage: input.targetLanguage || settings.targetLanguage,
      segments: mockSegments(),
      metadata: { inputMediaPath: input.mediaPath || '', createdAt: now(), asrProvider: 'mock.asr', warnings: [] }
    },
    warnings: [],
    createdAt: now(),
    updatedAt: now()
  });
  let lastJob = makeJob();
  window.translateTer = {
    selectVideo: async () => undefined,
    startTranscription: async (input) => (lastJob = makeJob(input)),
    startTranslation: async () => {
      lastJob.subtitleDocument.segments = lastJob.subtitleDocument.segments.map((segment) => ({
        ...segment,
        translatedText: segment.translatedText || `[mock] ${segment.sourceText}`,
        status: 'translated'
      }));
      lastJob.step = 'export';
      lastJob.updatedAt = now();
      return lastJob;
    },
    exportSrt: async () => undefined,
    getSettings: async () => settings,
    saveSettings: async (patch) => Object.assign(settings, patch),
    desktop: { selectMedia: async () => undefined },
    jobs: {
      create: async (input) => (lastJob = makeJob(input)),
      start: async () => undefined,
      translate: async () => window.translateTer.startTranslation(lastJob.id),
      cancel: async () => undefined,
      get: async () => lastJob,
      onEvent: () => () => undefined
    },
    subtitles: {
      importSrt: async () => lastJob.subtitleDocument,
      exportSrt: async () => undefined,
      updateSegment: async (_jobId, segment) => {
        lastJob.subtitleDocument.segments = lastJob.subtitleDocument.segments.map((item) => item.id === segment.id ? segment : item);
        lastJob.updatedAt = now();
        return lastJob;
      }
    },
    settings: {
      get: async () => settings,
      update: async (patch) => Object.assign(settings, patch),
      setSecret: async () => undefined,
      testProvider: async (providerId) => ({ providerId, ok: true, status: 'healthy' })
    },
    assets: {
      listWhisperModels: async () => [{ id: 'base', displayName: 'Whisper base', languageScope: 'multilingual', sizeBytes: 0, installed: false, sha256: '' }],
      ensureWhisperRuntime: async (request) => ({
        provider: 'whisper.cpp',
        platformKey: 'win-x64',
        cacheDir: '',
        binary: { expectedPath: '', installed: false, verified: false },
        model: { id: request.modelId, expectedPath: '', installed: false, verified: false },
        acceleration: { requested: 'auto', selected: 'cpu' },
        actionRequired: 'manifest-not-configured',
        message: 'The bundled whisper manifest is disabled until trusted URLs and pinned SHA-256 values are provided.'
      }),
      deleteModel: async () => undefined
    },
    native: {
      health: async () => ({
        protocolVersion: 1,
        backendVersion: 'native-host-preview',
        status: 'degraded',
        capabilities: ['runtime.health', 'media.probe', 'audio.extract', 'srt.parse', 'srt.serialize', 'asr.transcribe', 'job.cancel'],
        whisperRuntimeAvailable: false,
        ffmpegAvailable: false,
        ffprobeAvailable: false,
        hardwareAcceleration: 'cpu'
      })
    }
  };
})();
)JS";
}

void release_webview() {
  if (g_webview) {
    g_webview->Release();
    g_webview = nullptr;
  }
  if (g_webview_controller) {
    g_webview_controller->Close();
    g_webview_controller->Release();
    g_webview_controller = nullptr;
  }
}

void resize_webview(HWND hwnd) {
  if (!g_webview_controller) return;
  RECT bounds{};
  GetClientRect(hwnd, &bounds);
  g_webview_controller->put_Bounds(bounds);
}

void navigate_error_page(const wchar_t* body) {
  if (!g_webview) return;

  std::wstring html =
      L"<html><body style=\"font-family:Segoe UI,sans-serif;padding:32px;color:#1c1f24\">"
      L"<h1>Translate-Ter</h1><p>";
  html += body;
  html += L"</p></body></html>";
  g_webview->NavigateToString(html.c_str());
}

std::filesystem::path find_frontend_index() {
  for (const auto& candidate : frontend_candidates()) {
    if (std::filesystem::exists(candidate)) return candidate;
  }
  return {};
}

void initialize_webview(HWND hwnd) {
  using Microsoft::WRL::Callback;
  using Microsoft::WRL::ComPtr;

  const auto user_data = executable_dir() / L"app" / L"webview-data";
  const auto frontend_index = find_frontend_index();
  if (frontend_index.empty()) {
    g_status = L"Frontend assets were not found. Build the renderer or package app/frontend/index.html.";
    InvalidateRect(hwnd, nullptr, TRUE);
    return;
  }

  CreateCoreWebView2EnvironmentWithOptions(
      nullptr,
      user_data.c_str(),
      nullptr,
      Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
          [hwnd, frontend_index](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
            if (FAILED(result) || !environment) {
              g_status = L"Failed to initialize WebView2. Install the Microsoft Edge WebView2 Runtime.";
              InvalidateRect(hwnd, nullptr, TRUE);
              return S_OK;
            }

            environment->CreateCoreWebView2Controller(
                hwnd,
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [hwnd, frontend_index](HRESULT controller_result, ICoreWebView2Controller* controller) -> HRESULT {
                      if (FAILED(controller_result) || !controller) {
                        g_status = L"Failed to create the WebView2 controller.";
                        InvalidateRect(hwnd, nullptr, TRUE);
                        return S_OK;
                      }

                      controller->AddRef();
                      g_webview_controller = controller;
                      controller->get_CoreWebView2(&g_webview);
                      resize_webview(hwnd);

                      if (g_webview) {
                        ComPtr<ICoreWebView2_3> webview3;
                        if (FAILED(g_webview->QueryInterface(IID_PPV_ARGS(&webview3))) || !webview3) {
                          navigate_error_page(
                              L"Your Microsoft Edge WebView2 Runtime is too old to load the packaged app. "
                              L"Install the latest WebView2 Runtime and reopen Translate-Ter.");
                          return S_OK;
                        }

                        const auto frontend_dir = frontend_index.parent_path();
                        const HRESULT mapping_result = webview3->SetVirtualHostNameToFolderMapping(
                            kFrontendVirtualHost,
                            frontend_dir.c_str(),
                            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                        if (FAILED(mapping_result)) {
                          navigate_error_page(
                              L"Failed to map packaged frontend assets into WebView2. "
                              L"Please extract the full zip before running TranslateTer.exe.");
                          return S_OK;
                        }

                        const HRESULT script_result = g_webview->AddScriptToExecuteOnDocumentCreated(
                            frontend_host_script().c_str(),
                            Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
                                [](HRESULT script_error, LPCWSTR) -> HRESULT {
                                  if (FAILED(script_error)) {
                                    navigate_error_page(
                                        L"Failed to prepare the packaged desktop bridge before loading the app.");
                                    return S_OK;
                                  }
                                  g_webview->Navigate(L"https://translate-ter.local/index.html");
                                  return S_OK;
                                })
                                .Get());
                        if (FAILED(script_result)) {
                          navigate_error_page(L"Failed to install the packaged desktop bridge into WebView2.");
                        }
                      }
                      return S_OK;
                    })
                    .Get());
            return S_OK;
          })
          .Get());
}
#endif

LRESULT CALLBACK window_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_CREATE:
      if (start_backend()) {
        g_status = L"Native entry host is running.\n\n" + g_backend.status;
      } else {
        g_status = L"Native entry host opened, but backend startup needs attention.\n\n" + g_backend.status;
      }
#if defined(TRANSLATE_TER_WITH_WEBVIEW2)
      initialize_webview(hwnd);
#endif
      return 0;
    case WM_SIZE:
#if defined(TRANSLATE_TER_WITH_WEBVIEW2)
      resize_webview(hwnd);
#endif
      return 0;
    case WM_PAINT: {
      PAINTSTRUCT paint{};
      HDC dc = BeginPaint(hwnd, &paint);
      RECT rect{};
      GetClientRect(hwnd, &rect);

      HBRUSH background = CreateSolidBrush(RGB(246, 247, 249));
      FillRect(dc, &rect, background);
      DeleteObject(background);

      RECT content = rect;
      content.left += 36;
      content.top += 32;
      content.right -= 36;
      content.bottom -= 32;
      draw_text_block(dc, content, L"Translate-Ter", g_status);

      EndPaint(hwnd, &paint);
      return 0;
    }
    case WM_CLOSE:
      DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY:
#if defined(TRANSLATE_TER_WITH_WEBVIEW2)
      release_webview();
#endif
      g_backend.stop();
      PostQuitMessage(0);
      return 0;
    default:
      return DefWindowProcW(hwnd, message, wparam, lparam);
  }
}

int run(HINSTANCE instance, int show_command) {
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  WNDCLASSEXW window_class{};
  window_class.cbSize = sizeof(window_class);
  window_class.lpfnWndProc = window_proc;
  window_class.hInstance = instance;
  window_class.hCursor = LoadCursor(nullptr, IDC_ARROW);
  window_class.hIcon = LoadIcon(nullptr, IDI_APPLICATION);
  window_class.hIconSm = LoadIcon(nullptr, IDI_APPLICATION);
  window_class.lpszClassName = kWindowClassName;

  if (!RegisterClassExW(&window_class)) {
    MessageBoxW(nullptr, L"Failed to register Translate-Ter window class.", L"Translate-Ter", MB_ICONERROR);
    CoUninitialize();
    return 1;
  }

  HWND window = CreateWindowExW(
      0,
      kWindowClassName,
      L"Translate-Ter",
      WS_OVERLAPPEDWINDOW,
      CW_USEDEFAULT,
      CW_USEDEFAULT,
      1280,
      820,
      nullptr,
      nullptr,
      instance,
      nullptr);

  if (!window) {
    MessageBoxW(nullptr, L"Failed to create Translate-Ter window.", L"Translate-Ter", MB_ICONERROR);
    CoUninitialize();
    return 1;
  }

  ShowWindow(window, show_command);
  UpdateWindow(window);

  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }

  CoUninitialize();
  return static_cast<int>(message.wParam);
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show_command) {
  return run(instance, show_command);
}
