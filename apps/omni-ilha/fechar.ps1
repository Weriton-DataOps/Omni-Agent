# Fecha só os processos da demo da ilha (filtra pela pasta omni-ilha na linha de comando).
Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
  Where-Object { $_.CommandLine -match 'omni-ilha' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
