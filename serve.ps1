# LearneCN — https://github.com/clmpnn/LearneCN
# Copyright (C) 2026 clmpnn
#
# This program is free software: you can redistribute it and/or modify it under
# the terms of the GNU General Public License as published by the Free Software
# Foundation, either version 3 of the License, or (at your option) any later
# version.
#
# This program is distributed in the hope that it will be useful, but WITHOUT ANY
# WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
# PARTICULAR PURPOSE. See the GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License along with
# this program. If not, see <https://www.gnu.org/licenses/>.
#
# SPDX-License-Identifier: GPL-3.0-or-later
<#
  LearneCN — a static file server with no dependencies.

  Run it from the repo root (the folder containing html\, css\, js\ and data\):

      cd C:\path\to\LearneCN
      powershell -ExecutionPolicy Bypass -File .\serve.ps1

  Then open http://localhost:8000 — Ctrl+C stops it.
#>

param([int]$Port = 8000)

$root = (Get-Location).Path

# The pages load ../css, ../js and ../data, so the server root has to be the
# repo root. Serving from html\ makes every asset 404.
if (-not (Test-Path (Join-Path $root 'html\index.html'))) {
    Write-Host ""
    Write-Host "  Wrong folder." -ForegroundColor Red
    Write-Host "  Run this from the repo root — the one containing html\, css\, js\ and data\."
    Write-Host "  You are in: $root"
    Write-Host ""
    exit 1
}

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.md'   = 'text/plain; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.ico'  = 'image/x-icon'
    '.mp3'  = 'audio/mpeg'
    '.woff2' = 'font/woff2'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "  Could not open port $Port — something else is probably using it." -ForegroundColor Red
    Write-Host "  Try another one:  .\serve.ps1 -Port 8080"
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "  LearneCN is serving $root" -ForegroundColor Green
Write-Host "  http://localhost:$Port"
Write-Host "  Ctrl+C to stop."
Write-Host ""

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $rel = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
        if ($rel -eq '') { $rel = 'index.html' }

        $path = Join-Path $root ($rel -replace '/', '\')
        if (Test-Path $path -PathType Container) { $path = Join-Path $path 'index.html' }

        if (Test-Path $path -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($path)
            $ext = [System.IO.Path]::GetExtension($path).ToLower()
            $context.Response.ContentType = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
            $context.Response.ContentLength64 = $bytes.Length
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            Write-Host ("  200  /" + $rel)
        } else {
            $context.Response.StatusCode = 404
            Write-Host ("  404  /" + $rel) -ForegroundColor DarkGray
        }
        $context.Response.Close()
    }
} finally {
    $listener.Stop()
    $listener.Close()
    Write-Host ""
    Write-Host "  Stopped."
}
