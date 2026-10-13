; ------------------------------------------------------------------
; FlowDesk installer: custom NSIS hooks (electron-builder)
; ------------------------------------------------------------------

!macro customHeader
  Caption "FlowDesk Setup"
!macroend

!macro customWelcomePage
  ; No welcome page: the installer goes straight to installing.
!macroend

!macro customInstall
  ; Shortcuts from versions before 1.0.4 used another name.
  Delete "$DESKTOP\FlowDesk Retro Workstation.lnk"
  Delete "$SMPROGRAMS\FlowDesk Retro Workstation.lnk"
!macroend
