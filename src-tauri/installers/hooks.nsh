; 安装完成即可在新终端使用 CLI，无需先打开桌面软件。
!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToStack '"$INSTDIR\zerror-cli.exe" cli install'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "ZError CLI 自动配置未完成：$1"
  ${EndIf}
!macroend
