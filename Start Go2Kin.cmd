@echo off
setlocal
cd /d "%~dp0" || goto failed

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo Node.js and npm must be available on PATH.
    goto failed
)
if not exist "frontend\Go2Kin\node_modules\.bin\vite.cmd" (
    echo Run npm install in frontend\Go2Kin first.
    goto failed
)

if /i "%CONDA_DEFAULT_ENV%"=="Go2Kin" goto launch
set "CONDA_BAT=%USERPROFILE%\miniconda3\condabin\conda.bat"
if exist "%CONDA_BAT%" goto activate
for /f "delims=" %%i in ('where.exe conda.bat 2^>nul') do (
    set "CONDA_BAT=%%i"
    goto activate
)
echo Could not find Conda. See the setup in README.md.
goto failed

:activate
call "%CONDA_BAT%" activate Go2Kin
if errorlevel 1 (
    echo Could not activate the Go2Kin Conda environment. See the setup in README.md.
    goto failed
)

:launch
netstat.exe -ano -p tcp | findstr.exe /r /c:":8000 .*LISTENING" /c:":5173 .*LISTENING" >nul
if not errorlevel 1 (
    echo Port 8000 or 5173 is already in use. Close the running server before launching Go2Kin.
    goto failed
)

start "Go2Kin API" cmd.exe /d /k python code\api\main.py
start "Go2Kin Frontend" /d "%~dp0frontend\Go2Kin" cmd.exe /d /k npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort

echo Waiting for Go2Kin to start...
for /l %%i in (1,1,60) do (
    curl.exe --noproxy "*" --fail --silent --max-time 1 http://127.0.0.1:8000/openapi.json >nul && curl.exe --noproxy "*" --fail --silent --max-time 1 http://127.0.0.1:5173/ >nul && goto open_browser
    timeout /t 1 /nobreak >nul
)
echo Go2Kin did not become ready. Check the API and frontend windows for errors.
goto failed

:open_browser
start "" "http://127.0.0.1:5173/"
exit /b 0

:failed
pause
exit /b 1
