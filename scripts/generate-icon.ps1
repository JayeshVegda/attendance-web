Add-Type -AssemblyName System.Drawing
$size = 64
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Teal background with rounded rect
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 15, 118, 110))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 14
$d = $r * 2
$rect = New-Object System.Drawing.Rectangle(2, 2, ($size - 4), ($size - 4))
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
$path.CloseFigure()
$g.FillPath($brush, $path)

# White checkmark
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 6)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$points = @(
    (New-Object System.Drawing.PointF(16, 34)),
    (New-Object System.Drawing.PointF(27, 45)),
    (New-Object System.Drawing.PointF(48, 20))
)
$g.DrawLines($pen, $points)

$g.Flush()
$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$outPath = 'C:\Site_imp\attendance-web\pb\app-icon.ico'
$fs = [System.IO.File]::OpenWrite($outPath)
$icon.Save($fs)
$fs.Close()
$g.Dispose()
$bmp.Dispose()
Write-Output "Created $outPath successfully!"
