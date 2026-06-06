cmake_minimum_required(VERSION 3.20)

project(translate_ter_backend VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(translate-ter-backend
  src/main.cpp
)

target_compile_features(translate-ter-backend PRIVATE cxx_std_20)
