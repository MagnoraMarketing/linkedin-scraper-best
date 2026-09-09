@echo off
REM ===========================================================================
REM  LinkedIn Lead Finder - run the web app on this PC.
REM
REM  Double-click this file. It installs the Node packages if needed and starts
REM  the app, then opens it in your browser at http://localhost:3000
REM
REM  This is still a web app, not a desktop program: it runs a small web server
REM  here and you view it in a browser. The only difference from the Vercel
REM  deployment is where the server runs. Both read the same Supabase project,
REM  so the accounts, leads and jobs are identical either way.
REM
REM  Leave this window open while you use the app. Closing it stops the server.
REM ===========================================================================

cd /d "%~dp0"
title LinkedIn Lead Finder - web app

echo.
echo  ============================================
echo   LinkedIn Lead Finder - web app
echo  ============================================
echo.

REM --- Node.js ----------------------------------------------------------------
node --version >nul 2>&1
if errorlevel 1 goto NO_NODE

REM package.json requires Node 20 or newer.
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 goto OLD_NODE

REM --- Configuration ----------------------------------------------------------
REM Next.js loads .env.local by itself, so this only has to exist.
if exist ".env.local" goto DEPS

echo.
echo  No .env.local file found - creating one for you to fill in.
echo.
> .env.local echo # LinkedIn Lead Finder - local web app configuration.
>> .env.local echo # Fill in all three values below, save the file, then run start-app.bat again.
>> .env.local echo # This file holds live credentials. Never commit or share it.
>> .env.local echo.
>> .env.local echo # Supabase dashboard: Project Settings, then Data API for the URL
>> .env.local echo # and API Keys for the two keys below.
>> .env.local echo.
>> .env.local echo NEXT_PUBLIC_SUPABASE_URL=
>> .env.local echo NEXT_PUBLIC_SUPABASE_ANON_KEY=
>> .env.local echo SUPABASE_SERVICE_ROLE_KEY=

echo  Opening it in Notepad. Fill in the three values, save, close Notepad,
echo  then run this file again.
echo.
echo  These are the same three values your Vercel project uses. Note that the
echo  app needs the anon key as well, which the scraper worker does not.
echo.
notepad .env.local
goto END

REM --- Dependencies -----------------------------------------------------------
:DEPS
if exist "node_modules" goto RUN
echo  Installing Node packages. The first run takes a couple of minutes ...
call npm install
if errorlevel 1 goto NPM_FAILED

REM --- Run --------------------------------------------------------------------
:RUN
echo.
echo  ------------------------------------------------------------
echo   Starting the app at http://localhost:3000
echo   Your browser opens automatically in a few seconds.
echo   Leave this window open. Press Ctrl+C to stop.
echo  ------------------------------------------------------------
echo.

REM Open the browser once the dev server has had time to boot. Detached, so it
REM does not hold up the server starting below.
start "Open browser" /min powershell -NoProfile -Command "Start-Sleep -Seconds 8; Start-Process 'http://localhost:3000'"

call npm run dev
echo.
echo  App stopped.
goto END

REM --- Failure paths ----------------------------------------------------------
:NO_NODE
echo  Node.js was not found on this PC.
echo.
echo  Install the LTS version from https://nodejs.org/
echo  then close this window, open it again and run this file.
goto END

:OLD_NODE
echo  Your Node.js is too old. This app needs version 20 or newer.
node --version
echo.
echo  Install the current LTS from https://nodejs.org/
goto END

:NPM_FAILED
echo  Installing the Node packages failed. The output above says why.
echo  A company network or VPN blocking registry.npmjs.org is a common cause.
goto END

:END
echo.
pause
