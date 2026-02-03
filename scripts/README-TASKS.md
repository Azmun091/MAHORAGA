# Windows Scheduled Tasks para MAHORAGA

Este directorio contiene scripts para configurar tareas programadas de Windows que mantienen MAHORAGA corriendo automáticamente.

## Tareas Configuradas

1. **MAHORAGA-Startup**: Inicia los servicios PM2 cuando el usuario inicia sesión
2. **MAHORAGA-HealthCheck**: Verifica la salud de los servicios cada 10 minutos y los reinicia si es necesario

## Instalación

### Paso 1: Crear la tarea de Startup

Abre PowerShell **como Administrador** y ejecuta:

```powershell
cd C:\Users\azmunScripts\Documents\GitHub\MAHORAGA\scripts
.\setup-startup-task.ps1
```

Esto creará la tarea `MAHORAGA-Startup` que se ejecutará automáticamente cuando inicies sesión en Windows.

### Paso 2: Crear la tarea de Health Check

En la misma ventana de PowerShell (como Administrador), ejecuta:

```powershell
.\setup-health-check-task.ps1
```

Esto creará la tarea `MAHORAGA-HealthCheck` que se ejecutará cada 10 minutos para verificar y reparar servicios.

## Verificación

### Ver las tareas creadas

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -like "*MAHORAGA*" }
```

### Probar la tarea de Startup manualmente

```powershell
schtasks /run /tn "MAHORAGA-Startup"
```

### Probar la tarea de Health Check manualmente

```powershell
schtasks /run /tn "MAHORAGA-HealthCheck"
```

### Ver el historial de ejecución

1. Abre **Task Scheduler** (Programador de tareas)
2. Busca las tareas `MAHORAGA-Startup` y `MAHORAGA-HealthCheck`
3. Haz clic derecho en una tarea → **Historial**
4. Verifica que las ejecuciones sean exitosas (0x0)

## Logs

Los logs se guardan en:
- **Startup**: `C:\Users\azmunScripts\Documents\GitHub\MAHORAGA\logs\startup-services.log`
- **Health Check**: `C:\Users\azmunScripts\Documents\GitHub\MAHORAGA\logs\health-check.log`

## Desinstalación

Para eliminar las tareas programadas:

```powershell
# Como Administrador
Unregister-ScheduledTask -TaskName "MAHORAGA-Startup" -Confirm:$false
Unregister-ScheduledTask -TaskName "MAHORAGA-HealthCheck" -Confirm:$false
```

## Solución de Problemas

### La tarea no se ejecuta al iniciar sesión

1. Verifica que la tarea esté habilitada en Task Scheduler
2. Verifica que el trigger esté configurado para "At logon"
3. Revisa el historial de la tarea para ver errores

### El health check no funciona

1. Verifica que PM2 esté instalado globalmente: `pm2 --version`
2. Verifica que los servicios estén en `ecosystem.config.js`
3. Revisa los logs en `logs/health-check.log`

### Los servicios no inician

1. Verifica que todas las dependencias estén instaladas
2. Ejecuta manualmente `.\start-system.ps1` para ver errores
3. Revisa los logs de PM2: `pm2 logs`
