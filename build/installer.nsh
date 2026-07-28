!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!define /ifndef INSTALL_REGISTRY_KEY "Software\${APP_GUID}"
!define /ifndef UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
!define LR_PBM_SETPOS 0x0402
!define LR_PBM_SETRANGE32 0x0406
!define LR_PBM_SETMARQUEE 0x040A
!define LR_GWL_STYLE -16
!define LR_PBS_MARQUEE 0x00000008
!define MUI_HEADERIMAGE_BITMAP_STRETCH AspectFitHeight
!define MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH AspectFitHeight
!define MUI_UNWELCOMEFINISHPAGE_BITMAP_STRETCH AspectFitHeight

# Always install for the signed-in Windows user. The stock assisted installer
# otherwise shows a current-user/all-users page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

# Match only the real Electron executable. electron-builder's default
# PowerShell check treats every process under $INSTDIR as the app and older
# releases could report a false "cannot be closed" error.
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
  lrCheckAppAgain:
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      ${IfNot} ${Silent}
        MessageBox MB_OKCANCEL|MB_ICONINFORMATION \
          "$lrTextRunning" \
          /SD IDOK IDOK lrCloseApp
        Quit
      ${EndIf}

      lrCloseApp:
        DetailPrint "$lrTextClosing"
        ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        Sleep 1200
        ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        ${If} $R0 == 0
          ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
          Sleep 800
          ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
          ${If} $R0 == 0
            ${If} ${Silent}
              Quit
            ${Else}
              MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
                "$lrTextCannotClose" \
                /SD IDCANCEL IDRETRY lrCheckAppAgain
              Quit
            ${EndIf}
          ${EndIf}
        ${EndIf}
    ${EndIf}

    SetDetailsPrint both
    SetDetailsView show
    Call lrPrepareExistingInstall
    DetailPrint "$lrTextInstallApp"
  !endif
!macroend

!ifndef BUILD_UNINSTALLER

Var lrInstallChoice
Var lrHasExistingUserInstall
Var lrExistingUserInstallDir
Var lrLegacyMachineInstallDir
Var lrUpdateRadio
Var lrReinstallRadio
Var lrExistingInstallPrepared
Var lrProgressBar
Var lrTextRunning
Var lrTextCannotClose
Var lrTextClosing
Var lrTextChooseTitle
Var lrTextInstallTitle
Var lrTextCurrentUser
Var lrTextExisting
Var lrTextUpdateTitle
Var lrTextUpdateDescription
Var lrTextReinstallTitle
Var lrTextReinstallDescription
Var lrTextLocation
Var lrTextIntroduction
Var lrTextInstallation
Var lrTextInstallFor
Var lrTextNoAdmin
Var lrTextLegacyInstall
Var lrTextDataPreserved
Var lrTextPrepareExisting
Var lrTextRemoveOld
Var lrTextPrepareUser
Var lrTextInstallApp
Var lrTextKeepRuntime
Var lrTextInstallRuntime
Var lrTextKeepTooltip
Var lrTextInstallTooltip
Var lrTextFinalize

Function lrLoadLocalizedText
  # Use the Windows language ID directly. During electron-builder's temporary
  # uninstaller compile, the named MUI language constants are not defined yet.
  ${If} $LANGUAGE == 1041
    StrCpy $lrTextRunning "LeagueRecord が起動しています。$\r$\n$\r$\n［OK］を押すと安全に終了してインストールを続行します。"
    StrCpy $lrTextCannotClose "LeagueRecord を終了できませんでした。$\r$\nタスク マネージャーから終了して［再試行］を押してください。"
    StrCpy $lrTextClosing "1/5  LeagueRecord を終了しています..."
    StrCpy $lrTextChooseTitle "インストール方法の選択"
    StrCpy $lrTextInstallTitle "LeagueRecord のインストール"
    StrCpy $lrTextCurrentUser "現在のユーザー"
    StrCpy $lrTextExisting "LeagueRecord は、このWindowsユーザー用に既にインストールされています。"
    StrCpy $lrTextUpdateTitle "アップデート（推奨）"
    StrCpy $lrTextUpdateDescription "録画ランタイムとツールチップデータベースを保持します。"
    StrCpy $lrTextReinstallTitle "再インストール"
    StrCpy $lrTextReinstallDescription "アプリを入れ直します。設定と録画データは保持されます。"
    StrCpy $lrTextLocation "インストール先："
    StrCpy $lrTextIntroduction "ローカル録画、YouTubeアップロード、共有リプレイ再生を1つのデスクトップアプリで利用できます。"
    StrCpy $lrTextInstallation "インストール設定"
    StrCpy $lrTextInstallFor "インストール対象：現在のWindowsユーザー"
    StrCpy $lrTextNoAdmin "通常のインストールと今後のアップデートに管理者権限は必要ありません。"
    StrCpy $lrTextLegacyInstall "以前の全ユーザー版が見つかりました。今回は現在のユーザー用にインストールします。動作確認後、古い版はWindowsの設定から削除できます。"
    StrCpy $lrTextDataPreserved "設定と録画データは別に保存され、アプリのアップデートでは削除されません。"
    StrCpy $lrTextPrepareExisting "2/5  既存のインストールを準備しています..."
    StrCpy $lrTextRemoveOld "2/5  古いアプリファイルを削除しています..."
    StrCpy $lrTextPrepareUser "2/5  現在のユーザー用インストールを準備しています..."
    StrCpy $lrTextInstallApp "3/5  LeagueRecordのアプリファイルをインストールしています..."
    StrCpy $lrTextKeepRuntime "4/5  既存の録画ランタイムを保持します。"
    StrCpy $lrTextInstallRuntime "4/5  録画ランタイムをインストールしています..."
    StrCpy $lrTextKeepTooltip "4/5  既存のツールチップデータベースを保持します。"
    StrCpy $lrTextInstallTooltip "4/5  ツールチップデータベースをインストールしています..."
    StrCpy $lrTextFinalize "5/5  ショートカットを作成し、インストールを完了しています..."
  ${Else}
    StrCpy $lrTextRunning "LeagueRecord is running.$\r$\n$\r$\nClick OK to close it safely and continue."
    StrCpy $lrTextCannotClose "LeagueRecord could not be closed.$\r$\nClose it from Task Manager, then click Retry."
    StrCpy $lrTextClosing "1/5  Closing LeagueRecord..."
    StrCpy $lrTextChooseTitle "Choose how to install"
    StrCpy $lrTextInstallTitle "Install LeagueRecord"
    StrCpy $lrTextCurrentUser "Current user"
    StrCpy $lrTextExisting "LeagueRecord is already installed for this Windows user."
    StrCpy $lrTextUpdateTitle "Update (recommended)"
    StrCpy $lrTextUpdateDescription "Keeps the recording runtime and tooltip database."
    StrCpy $lrTextReinstallTitle "Reinstall"
    StrCpy $lrTextReinstallDescription "Replaces app files. Settings and recordings are preserved."
    StrCpy $lrTextLocation "Location:"
    StrCpy $lrTextIntroduction "Fast local recording, YouTube uploads, and shared replay playback in one desktop app."
    StrCpy $lrTextInstallation "Installation"
    StrCpy $lrTextInstallFor "Install for: Current Windows user"
    StrCpy $lrTextNoAdmin "No administrator permission is required for normal installation or future updates."
    StrCpy $lrTextLegacyInstall "An older all-users copy was found. This version will be installed for the current user. After confirming it works, remove the older copy from Windows Settings."
    StrCpy $lrTextDataPreserved "Your settings and recordings are stored separately and are not removed by app updates."
    StrCpy $lrTextPrepareExisting "2/5  Preparing the existing installation..."
    StrCpy $lrTextRemoveOld "2/5  Removing old application files..."
    StrCpy $lrTextPrepareUser "2/5  Preparing a current-user installation..."
    StrCpy $lrTextInstallApp "3/5  Installing LeagueRecord application files..."
    StrCpy $lrTextKeepRuntime "4/5  Keeping the existing recording runtime."
    StrCpy $lrTextInstallRuntime "4/5  Installing the recording runtime..."
    StrCpy $lrTextKeepTooltip "4/5  Keeping the existing tooltip database."
    StrCpy $lrTextInstallTooltip "4/5  Installing the tooltip database..."
    StrCpy $lrTextFinalize "5/5  Creating shortcuts and finalizing installation..."
  ${EndIf}
FunctionEnd

Function lrInstFilesShow
  # electron-builder first extracts its embedded archive and then extracts the
  # application package. Each operation resets the stock determinate bar.
  # Use one continuous activity indicator instead, while the details list
  # reports the exact numbered stage. It is finalized at 100% below.
  FindWindow $0 "#32770" "" $HWNDPARENT
  FindWindow $lrProgressBar "msctls_progress32" "" $0
  ${If} $lrProgressBar == 0
    GetDlgItem $lrProgressBar $HWNDPARENT 1004
  ${EndIf}
  ${If} $lrProgressBar == 0
    Return
  ${EndIf}
  System::Call 'user32::GetWindowLongW(p $lrProgressBar, i ${LR_GWL_STYLE}) i.r1'
  IntOp $1 $1 | ${LR_PBS_MARQUEE}
  System::Call 'user32::SetWindowLongW(p $lrProgressBar, i ${LR_GWL_STYLE}, i r1)'
  SendMessage $lrProgressBar ${LR_PBM_SETMARQUEE} 1 35
FunctionEnd

!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW lrInstFilesShow
!macroend

Function lrPrepareExistingInstall
  ${If} $lrExistingInstallPrepared == "1"
    Return
  ${EndIf}
  StrCpy $lrExistingInstallPrepared "1"

  ${If} $lrHasExistingUserInstall == "1"
    DetailPrint "$lrTextPrepareExisting"
    # Releases through 1.2.2 have a broken silent uninstaller process check.
    # Bypass it and let the new package overlay the current-user installation.
    ${If} $lrInstallChoice == "reinstall"
    ${AndIf} $lrExistingUserInstallDir != ""
    ${AndIf} ${FileExists} "$lrExistingUserInstallDir\LeagueRecordElectron.exe"
      DetailPrint "$lrTextRemoveOld"
      RMDir /r "$lrExistingUserInstallDir"
    ${EndIf}
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY_2}"
    !endif
    DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  ${Else}
    DetailPrint "$lrTextPrepareUser"
  ${EndIf}
FunctionEnd

Function lrInstallPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  GetDlgItem $0 $HWNDPARENT 1037
  ${If} $lrHasExistingUserInstall == "1"
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$lrTextChooseTitle"
  ${Else}
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$lrTextInstallTitle"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:LeagueRecord Electron ${VERSION} · $lrTextCurrentUser"

  ${If} $lrHasExistingUserInstall == "1"
    ${NSD_CreateLabel} 0 0 100% 24u "$lrTextExisting"
    Pop $0

    ${NSD_CreateGroupBox} 0 27u 100% 52u ""
    Pop $0
    ${NSD_CreateRadioButton} 10u 36u 88% 15u "$lrTextUpdateTitle"
    Pop $lrUpdateRadio
    ${NSD_Check} $lrUpdateRadio
    ${NSD_CreateLabel} 28u 53u 68% 18u "$lrTextUpdateDescription"
    Pop $0
    SetCtlColors $0 0x667085 transparent

    ${NSD_CreateGroupBox} 0 85u 100% 52u ""
    Pop $0
    ${NSD_CreateRadioButton} 10u 94u 88% 15u "$lrTextReinstallTitle"
    Pop $lrReinstallRadio
    ${NSD_CreateLabel} 28u 111u 68% 18u "$lrTextReinstallDescription"
    Pop $0
    SetCtlColors $0 0x667085 transparent

    ${NSD_CreateLabel} 0 -16u 100% 12u "$lrTextLocation $lrExistingUserInstallDir"
    Pop $0
    SetCtlColors $0 0x7A8494 transparent
  ${Else}
    ${NSD_CreateLabel} 0 0 100% 28u "$lrTextIntroduction"
    Pop $0

    ${NSD_CreateGroupBox} 0 38u 100% 76u "$lrTextInstallation"
    Pop $0
    ${NSD_CreateLabel} 14u 57u 82% 18u "$lrTextInstallFor"
    Pop $0
    ${NSD_CreateLabel} 14u 78u 82% 26u "$lrTextNoAdmin"
    Pop $0
    SetCtlColors $0 0x667085 transparent

    ${If} $lrLegacyMachineInstallDir != ""
      ${NSD_CreateLabel} 0 129u 100% 42u "$lrTextLegacyInstall"
      Pop $0
      SetCtlColors $0 0x8A6D1F transparent
    ${Else}
      ${NSD_CreateLabel} 0 134u 100% 30u "$lrTextDataPreserved"
      Pop $0
      SetCtlColors $0 0x7A8494 transparent
    ${EndIf}
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function lrInstallPageLeave
  ${If} $lrHasExistingUserInstall == "1"
    ${NSD_GetState} $lrReinstallRadio $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $lrInstallChoice "reinstall"
    ${Else}
      StrCpy $lrInstallChoice "update"
    ${EndIf}
  ${Else}
    StrCpy $lrInstallChoice "install"
  ${EndIf}
FunctionEnd

!macro customWelcomePage
  Page custom lrInstallPageCreate lrInstallPageLeave
!macroend

!macro customInit
  Call lrLoadLocalizedText
  StrCpy $lrExistingInstallPrepared "0"
  StrCpy $lrHasExistingUserInstall "0"
  StrCpy $lrExistingUserInstallDir ""
  StrCpy $lrLegacyMachineInstallDir ""
  StrCpy $lrInstallChoice "install"

  ReadRegStr $lrExistingUserInstallDir HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $lrExistingUserInstallDir != ""
    StrCpy $lrHasExistingUserInstall "1"
    StrCpy $lrInstallChoice "update"
  ${EndIf}
  ReadRegStr $lrLegacyMachineInstallDir HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation

  ${If} ${Silent}
    Call lrPrepareExistingInstall
  ${EndIf}
!macroend

!macro customInstall
  SetDetailsPrint both
  SetDetailsView show
  CreateDirectory "$INSTDIR\resources"

  ${If} $lrInstallChoice == "update"
  ${AndIf} ${FileExists} "$INSTDIR\resources\libobs\*.*"
    DetailPrint "$lrTextKeepRuntime"
  ${Else}
    DetailPrint "$lrTextInstallRuntime"
    SetOutPath "$INSTDIR\resources\libobs"
    File /r "${PROJECT_DIR}\src-tauri\target\libobs\*.*"
  ${EndIf}

  ${If} $lrInstallChoice == "update"
  ${AndIf} ${FileExists} "$INSTDIR\resources\tooltip_data.db"
    DetailPrint "$lrTextKeepTooltip"
  ${Else}
    DetailPrint "$lrTextInstallTooltip"
    SetOutPath "$INSTDIR\resources"
    File /oname=tooltip_data.db "${PROJECT_DIR}\src-tauri\resources\tooltip_data.db"
  ${EndIf}

  DetailPrint "$lrTextFinalize"
  SetOutPath "$INSTDIR"
  ${If} $lrProgressBar != ""
    SendMessage $lrProgressBar ${LR_PBM_SETMARQUEE} 0 0
    SendMessage $lrProgressBar ${LR_PBM_SETRANGE32} 0 100
    SendMessage $lrProgressBar ${LR_PBM_SETPOS} 100 0
  ${EndIf}
!macroend

!endif
