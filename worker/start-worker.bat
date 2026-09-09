@echo off
REM ===========================================================================
REM  LinkedIn Lead Finder - start the scraper worker on this PC.
REM
REM  Double-click this file. It creates a Python virtual environment, installs
REM  the dependencies and Chromium, then runs the worker.
REM
REM  No Docker and no cloud host: the only contract between the web app and the
REM  worker is a row in the scraping_jobs table, so the worker just needs
REM  outbound internet access. Nothing has to reach it from outside.
REM
REM  Leave this window open while a search runs. Closing it stops the worker;
REM  an unfinished job returns to the queue after its heartbeat goes stale and
REM  is picked up on the next start, so nothing is lost.
REM ===========================================================================

cd /d "%~dp0"
title LinkedIn Lead Finder - scraper worker

echo.
echo  ============================================
echo   LinkedIn Lead Finder - scraper worker
echo  ============================================
echo.

REM --- Find a Python interpreter ---------------------------------------------
set "PY="
py -3 --version >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if defined PY goto HAVE_PYTHON

python --version >nul 2>&1
if not errorlevel 1 set "PY=python"
if defined PY goto HAVE_PYTHON
goto NO_PYTHON

:HAVE_PYTHON
REM Both ends matter. The pinned dependencies ship wheels for cp310-cp313 only;
REM on 3.14 pip finds none, falls back to building pydantic-core and greenlet
REM from source, and fails on a missing Rust toolchain and MSVC linker. Exit 2
REM means too new, 1 means too old. errorlevel is a >= test, so check 2 first.
%PY% -c "import sys; v=sys.version_info; raise SystemExit(0 if (3,10) <= v < (3,14) else (1 if v < (3,10) else 2))"
if errorlevel 2 goto NEW_PYTHON
if errorlevel 1 goto OLD_PYTHON

REM --- Virtual environment ----------------------------------------------------
if exist ".venv\Scripts\python.exe" goto VENV_READY
echo  [1/4] Creating a virtual environment in worker\.venv ...
%PY% -m venv .venv
if errorlevel 1 goto VENV_FAILED
goto VENV_READY

:VENV_READY
set "VPY=.venv\Scripts\python.exe"

REM The venv keeps whichever interpreter created it. Someone who hits the 3.14
REM failure, installs 3.12 and runs this again would otherwise reuse the 3.14
REM environment and fail identically, with nothing on screen to explain why.
"%VPY%" -c "import sys; v=sys.version_info; raise SystemExit(0 if (3,10) <= v < (3,14) else 1)"
if not errorlevel 1 goto DEPS
echo  The existing worker\.venv was built by an unsupported Python. Rebuilding it ...
rmdir /s /q .venv
%PY% -m venv .venv
if errorlevel 1 goto VENV_FAILED

:DEPS

REM --- Dependencies -----------------------------------------------------------
REM pip is quick when everything is already satisfied, and running it every time
REM means a changed requirements.txt is picked up without anyone remembering to.
echo  [2/4] Checking Python packages ...
"%VPY%" -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto PIP_FAILED

REM playwright install checks for an existing browser and skips the download.
echo  [3/4] Checking Chromium ...
"%VPY%" -m playwright install chromium
if errorlevel 1 goto PLAYWRIGHT_FAILED

REM --- Configuration ----------------------------------------------------------
if exist ".env" goto LOAD_ENV

echo.
echo  No .env file found - creating one for you to fill in.
echo.
> .env echo # LinkedIn Lead Finder - worker configuration.
>> .env echo # Fill in all four values below, save the file, then run start-worker.bat again.
>> .env echo # This file holds live credentials. Never commit or share it.
>> .env echo.
>> .env echo # Supabase - the same two values your Vercel project uses.
>> .env echo # Dashboard: Project Settings, then Data API and API Keys.
>> .env echo NEXT_PUBLIC_SUPABASE_URL=
>> .env echo SUPABASE_SERVICE_ROLE_KEY=
>> .env echo.
>> .env echo # LinkedIn - the account the scraper signs in as.
>> .env echo # Use a dedicated account, not your main one.
>> .env echo LINKEDIN_EMAIL=
>> .env echo LINKEDIN_PASSWORD=
>> .env echo.
>> .env echo # Where the LinkedIn session is cached, so restarts do not sign in again.
>> .env echo SCRAPER_SESSION_DIR=.session

echo  Opening it in Notepad. Fill in the four values, save, close Notepad,
echo  then run this file again.
echo.
notepad .env
goto END

:LOAD_ENV
REM config.py reads os.environ, so .env has to be loaded into this shell first.
REM eol=# skips comments; tokens=1,* keeps any = inside a value intact.
echo  [4/4] Loading configuration from .env ...
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do if not "%%A"=="" set "%%A=%%B"

echo.
echo  ------------------------------------------------------------
echo   Worker running. Leave this window open.
echo   Press Ctrl+C to stop.
echo  ------------------------------------------------------------
echo.

"%VPY%" -m linkedin_lead_worker.main
echo.
echo  Worker stopped.
goto END

REM --- Failure paths ----------------------------------------------------------
:NO_PYTHON
echo  Python was not found on this PC.
echo.
echo  Install Python 3.10 or newer from https://www.python.org/downloads/
echo  and tick "Add python.exe to PATH" in the installer. Then run this again.
goto END

:OLD_PYTHON
echo  Your Python is too old. This worker needs 3.10 or newer.
%PY% --version
echo.
echo  Install 3.12 from https://www.python.org/downloads/
goto END

:NEW_PYTHON
%PY% --version
echo.
echo  That Python is too new for this project's pinned dependencies.
echo  pydantic-core and greenlet publish prebuilt wheels up to 3.13 only, so on
echo  3.14 pip tries to compile them and fails on a missing Rust toolchain and
echo  Visual Studio linker.
echo.
echo  Install Python 3.12 from https://www.python.org/downloads/ and tick
echo  "Add python.exe to PATH". You do not have to uninstall the newer one -
echo  this script rebuilds worker\.venv against whichever Python it finds.
goto END

:VENV_FAILED
echo  Could not create the virtual environment in worker\.venv
echo  Check that you can write to this folder, then try again.
goto END

:PIP_FAILED
echo  Installing the Python packages failed. The output above says why.
echo  A company network or VPN blocking pypi.org is a common cause.
goto END

:PLAYWRIGHT_FAILED
echo  Downloading Chromium failed. The output above says why.
echo  This step needs about 150 MB and a working internet connection.
goto END

:END
echo.
pause
