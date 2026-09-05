# Active le Point d'acces mobile Windows (hotspot WiFi) pour D-aona
# Les telephones se connectent au hotspot → le PC est accessible en 192.168.137.1
$log = "d:\Project\D-Aona\Root\d-aona-server\hotspot_result.txt"
try {
    [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType=WindowsRuntime] | Out-Null
    [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType=WindowsRuntime] | Out-Null
    Add-Type -AssemblyName System.Runtime.WindowsRuntime

    # Helper : await d'une IAsyncOperation WinRT
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    function Await-WinRT($op, $resultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
        $task = $asTask.Invoke($null, @($op))
        $task.Wait(20000) | Out-Null
        return $task.Result
    }

    $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
    if (-not $profile) {
        $profiles = [Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles()
        $profile = $profiles | Where-Object { $_.IsWlanConnectionProfile } | Select-Object -First 1
    }
    if (-not $profile) { "ERREUR: aucun profil reseau trouve" | Out-File -Encoding utf8 $log; exit 1 }

    $mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)

    # Configurer SSID + mot de passe si possible
    try {
        $cfg = $mgr.GetCurrentAccessPointConfiguration()
        if ($cfg.Ssid -notlike "D-aona*") {
            $newCfg = New-Object Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration
            $newCfg.Ssid = "D-aona-Game"
            $newCfg.Passphrase = "fanorona2026"
            Await-WinRT ($mgr.ConfigureAccessPointAsync($newCfg)) ([object]) | Out-Null
        }
    } catch { }

    if ($mgr.TetheringOperationalState -eq 1) {
        "OK: hotspot deja actif" | Out-File -Encoding utf8 $log
    } else {
        $res = Await-WinRT ($mgr.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
        "OK: StartTethering Status=$($res.Status)" | Out-File -Encoding utf8 $log
    }
    Start-Sleep -Seconds 2
    $cfg = $mgr.GetCurrentAccessPointConfiguration()
    $mgr2 = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
    "SSID=$($cfg.Ssid)`nPASS=$($cfg.Passphrase)`nETAT=$($mgr2.TetheringOperationalState) (1=On)" | Out-File -Append -Encoding utf8 $log
} catch {
    "ERREUR: $_" | Out-File -Encoding utf8 $log
}
