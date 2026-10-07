param([Parameter(Mandatory=$true)][string]$Directorio)
$ErrorActionPreference='Stop'
$conexiones=@{}
try {
  while (-not (Test-Path -LiteralPath (Join-Path $Directorio 'stop'))) {
    $peticiones=Get-ChildItem -LiteralPath $Directorio -Filter '*.request.json'
    foreach ($peticion in $peticiones) {
      $respuesta=Join-Path $Directorio ($peticion.Name.Replace('.request.json','.response.json'))
      try {
        $p=Get-Content -LiteralPath $peticion.FullName -Raw | ConvertFrom-Json
        if ($p.db -notmatch '^Wybix_(MigTest|SchemaTest|RebuildTest|Tmp[A-Za-z0-9]*|E2E_[A-Za-z0-9]+)$') { throw 'Base no temporal' }
        $k=$p.server+'|'+$p.db
        if (-not $conexiones.ContainsKey($k)) {
          $builder=New-Object System.Data.SqlClient.SqlConnectionStringBuilder
          $builder['Data Source']=$p.server; $builder['Initial Catalog']=$p.db
          $builder['Integrated Security']=$true; $builder['TrustServerCertificate']=$true
          $c=New-Object System.Data.SqlClient.SqlConnection $builder.ConnectionString
          $c.Open(); $conexiones[$k]=$c
        }
        $cmd=$conexiones[$k].CreateCommand(); $cmd.CommandTimeout=600; $cmd.CommandText=$p.sql
        $da=New-Object System.Data.SqlClient.SqlDataAdapter $cmd
        $ds=New-Object System.Data.DataSet
        [void]$da.Fill($ds)
        $sets=@()
        foreach($tabla in $ds.Tables) {
          $filas=@()
          foreach($fila in $tabla.Rows) {
            $h=@{}
            foreach($col in $tabla.Columns) {
              $v=$fila[$col.ColumnName]
              if ($v -is [System.DBNull]) { $h[$col.ColumnName]=$null }
              elseif ($v -is [byte[]]) { $h[$col.ColumnName]=[Convert]::ToBase64String($v) }
              else { $h[$col.ColumnName]=$v }
            }
            $filas+=,$h
          }
          $sets+=,@($filas)
        }
        $r=@{ok=$true;sets=@($sets)}
      } catch { $r=@{ok=$false;error=$_.Exception.Message;sets=@()} }
      $temporal=$respuesta+'.tmp'
      [System.IO.File]::WriteAllText($temporal,($r | ConvertTo-Json -Depth 30 -Compress))
      Move-Item -LiteralPath $temporal -Destination $respuesta
      Remove-Item -LiteralPath $peticion.FullName
    }
    Start-Sleep -Milliseconds 10
  }
} finally { foreach($c in $conexiones.Values) { $c.Dispose() } }
