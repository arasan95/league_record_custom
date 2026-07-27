param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $ProjectRoot "app-icon.png"
$buildDir = Join-Path $ProjectRoot "build"
$source = [System.Drawing.Image]::FromFile($sourcePath)

function New-Canvas([int]$width, [int]$height, [System.Drawing.Color]$background) {
  $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear($background)
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  return @($bitmap, $graphics)
}

function Draw-SquareImage(
  [System.Drawing.Graphics]$graphics,
  [System.Drawing.Image]$image,
  [int]$x,
  [int]$y,
  [int]$size
) {
  # Always use one square destination rect. This prevents the circular icon
  # from being stretched independently in either direction.
  $destination = New-Object System.Drawing.Rectangle($x, $y, $size, $size)
  $graphics.DrawImage($image, $destination, 0, 0, $image.Width, $image.Height, [System.Drawing.GraphicsUnit]::Pixel)
}

$sidebarParts = New-Canvas 164 314 ([System.Drawing.Color]::FromArgb(9, 17, 30))
$sidebar = $sidebarParts[0]
$sidebarGraphics = $sidebarParts[1]
$accentBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(239, 51, 68))
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 247, 250))
$mutedBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(178, 190, 208))
$titleFont = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$captionFont = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$sidebarGraphics.FillRectangle($accentBrush, 0, 0, 4, 314)
Draw-SquareImage $sidebarGraphics $source 50 34 64
$titleFormat = New-Object System.Drawing.StringFormat
$titleFormat.Alignment = [System.Drawing.StringAlignment]::Center
$sidebarGraphics.DrawString("LeagueRecord", $titleFont, $whiteBrush, (New-Object System.Drawing.RectangleF(10, 126, 144, 22)), $titleFormat)
$sidebarGraphics.DrawString("ELECTRON", $captionFont, $mutedBrush, (New-Object System.Drawing.RectangleF(10, 151, 144, 18)), $titleFormat)
$sidebarGraphics.FillRectangle($accentBrush, 50, 187, 64, 2)
$sidebarGraphics.DrawString("CAPTURE  |  REVIEW", $captionFont, $mutedBrush, (New-Object System.Drawing.RectangleF(10, 211, 144, 18)), $titleFormat)
$sidebarGraphics.DrawString("SHARE", $captionFont, $mutedBrush, (New-Object System.Drawing.RectangleF(10, 229, 144, 18)), $titleFormat)
$sidebar.Save((Join-Path $buildDir "installerSidebar.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)

$headerParts = New-Canvas 150 57 ([System.Drawing.Color]::FromArgb(247, 249, 252))
$header = $headerParts[0]
$headerGraphics = $headerParts[1]
Draw-SquareImage $headerGraphics $source 101 9 39
$header.Save((Join-Path $buildDir "installerHeader.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)

$headerGraphics.Dispose()
$header.Dispose()
$sidebarGraphics.Dispose()
$sidebar.Dispose()
$titleFormat.Dispose()
$titleFont.Dispose()
$captionFont.Dispose()
$accentBrush.Dispose()
$whiteBrush.Dispose()
$mutedBrush.Dispose()
$source.Dispose()
