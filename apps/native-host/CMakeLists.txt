add_executable(TranslateTer WIN32
  src/main.cpp
)

target_compile_features(TranslateTer PRIVATE cxx_std_20)
target_compile_definitions(TranslateTer PRIVATE UNICODE _UNICODE NOMINMAX)

set(WEBVIEW2_VERSION "1.0.3967.48")
set(WEBVIEW2_ROOT "${CMAKE_SOURCE_DIR}/.deps/Microsoft.Web.WebView2.${WEBVIEW2_VERSION}")
set(WEBVIEW2_NATIVE "${WEBVIEW2_ROOT}/build/native")

if(EXISTS "${WEBVIEW2_NATIVE}/include/WebView2.h")
  target_compile_definitions(TranslateTer PRIVATE TRANSLATE_TER_WITH_WEBVIEW2=1)
  target_include_directories(TranslateTer PRIVATE "${WEBVIEW2_NATIVE}/include")

  if(CMAKE_SIZEOF_VOID_P EQUAL 8)
    set(WEBVIEW2_ARCH "x64")
  else()
    set(WEBVIEW2_ARCH "x86")
  endif()

  target_link_libraries(TranslateTer PRIVATE
    "${WEBVIEW2_NATIVE}/${WEBVIEW2_ARCH}/WebView2Loader.dll.lib"
  )

  add_custom_command(TARGET TranslateTer POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${WEBVIEW2_NATIVE}/${WEBVIEW2_ARCH}/WebView2Loader.dll"
      "$<TARGET_FILE_DIR:TranslateTer>/WebView2Loader.dll"
  )
else()
  message(WARNING "WebView2 SDK not found at ${WEBVIEW2_ROOT}; TranslateTer will build a fallback host window.")
endif()

target_link_libraries(TranslateTer PRIVATE
  ole32
  user32
  gdi32
  shell32
  shlwapi
)
