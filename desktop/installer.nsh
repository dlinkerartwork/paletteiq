; Runs elevated because this installer is per-machine. No separate runtime setup.
!macro customInstall
  DetailPrint "Installing bundled Microsoft Visual C++ Runtime..."
  ExecWait '"$INSTDIR\resources\prerequisites\vc_redist.x64.exe" /install /quiet /norestart' $0
  StrCmp $0 "0" paletteiq_vc_done
  StrCmp $0 "1638" paletteiq_vc_done
  StrCmp $0 "3010" paletteiq_vc_reboot
  MessageBox MB_OK|MB_ICONSTOP "Microsoft Visual C++ Runtime installation failed (exit $0). Restart Windows and run PaletteIQ Setup again."
  Abort
paletteiq_vc_reboot:
  SetRebootFlag true
paletteiq_vc_done:
!macroend
