# Configuration pare-feu D-aona (executé en admin via UAC)
$log = "d:\Project\D-Aona\Root\d-aona-server\fw_result.txt"
try {
    netsh advfirewall firewall delete rule name="D-aona Server 8080" 2>$null | Out-Null
    netsh advfirewall firewall delete rule name="D-aona node" 2>$null | Out-Null
    netsh advfirewall firewall add rule name="D-aona Server 8080" dir=in action=allow protocol=TCP localport=8080 profile=any | Out-Null
    $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
    if ($nodePath) {
        netsh advfirewall firewall add rule name="D-aona node" dir=in action=allow program="$nodePath" enable=yes profile=any | Out-Null
    }
    $r = netsh advfirewall firewall show rule name="D-aona Server 8080"
    "OK`n$r" | Out-File -Encoding utf8 $log
} catch {
    "ERREUR: $_" | Out-File -Encoding utf8 $log
}
