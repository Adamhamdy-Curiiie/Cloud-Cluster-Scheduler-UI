@echo off
setlocal
set "PROJECT_ROOT=%~dp0.."
pushd "%PROJECT_ROOT%"
if errorlevel 1 exit /b 1
set "BUILD_DIR=%CD%\bin\golden-bat"
if not exist "%BUILD_DIR%\classes" mkdir "%BUILD_DIR%\classes"
if not exist "%BUILD_DIR%\actual" mkdir "%BUILD_DIR%\actual"

javac -d "%BUILD_DIR%\classes" *.java
if errorlevel 1 goto :compile_failed

set "FAILED=0"
for %%I in ("tests\inputs\*.txt") do (
    java -cp "%BUILD_DIR%\classes" Main < "%%~fI" > "%BUILD_DIR%\actual\%%~nI.txt"
    if errorlevel 1 (
        echo FAIL: %%~nI ^(program failed^)
        set "FAILED=1"
    ) else (
        fc /b "tests\golden\%%~nI.txt" "%BUILD_DIR%\actual\%%~nI.txt" >nul
        if errorlevel 1 (
            echo FAIL: %%~nI ^(console output differs^)
            fc /b "tests\golden\%%~nI.txt" "%BUILD_DIR%\actual\%%~nI.txt"
            set "FAILED=1"
        ) else (
            echo PASS: %%~nI
        )
    )
)

if "%FAILED%"=="1" goto :tests_failed
echo All golden tests passed.
popd
exit /b 0

:compile_failed
echo FAIL: compilation failed.
popd
exit /b 1

:tests_failed
popd
exit /b 1
