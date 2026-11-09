# Registra (ou atualiza) a tarefa "Omni Actions - visita": todo dia às 7h, e "assim que possível" se o PC
# estava desligado nesse horário. Chama o .vbs (nada pisca na tela). Para tirar:
#   Unregister-ScheduledTask -TaskName 'Omni Actions - visita' -Confirm:$false
$nome = 'Omni Actions - visita'
$acao = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + (Join-Path $PSScriptRoot 'omni-actions-visita.vbs') + '" diaria')
$gatilho = New-ScheduledTaskTrigger -Daily -At '07:00'
$regras = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 45) -MultipleInstances IgnoreNew
$quem = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $regras -Principal $quem -Description 'Visita diária do Omni ao Actions (cruza ideias com projetos, testa, propõe vereditos). Desenho: Omni\docs\superpowers\specs\2026-10-21-actions-organizador-design.md' -Force | Out-Null
$t = Get-ScheduledTask -TaskName $nome
$i = $t | Get-ScheduledTaskInfo
"$($t.TaskName) · $($t.State) · próxima: $($i.NextRunTime) · StartWhenAvailable=$($t.Settings.StartWhenAvailable)"
