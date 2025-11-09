Add-Type -AssemblyName System.Drawing

# 加载 PNG 图像
$img = [System.Drawing.Image]::FromFile("public\icons\icon.png")

# 创建 32x32 的位图
$bitmap = New-Object System.Drawing.Bitmap(32, 32)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.DrawImage($img, 0, 0, 32, 32)

# 保存为 ICO 格式
$bitmap.Save("src-tauri\icons\icon.ico", [System.Drawing.Imaging.ImageFormat]::Icon)

# 清理资源
$graphics.Dispose()
$bitmap.Dispose()
$img.Dispose()

Write-Host "ICO file created successfully"