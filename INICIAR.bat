@echo off
rem Abre o app ENEM Azul num servidor local (necessario para as explicacoes com IA).
cd /d "%~dp0app"
echo Abrindo http://localhost:8765  (feche esta janela para encerrar)
start "" http://localhost:8765
py -m http.server 8765 2>nul || python -m http.server 8765
