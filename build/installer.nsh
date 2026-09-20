!include LogicLib.nsh

!macro customRemoveFiles
  ; Electron Builder removes the whole install directory during an update.
  ; Move persistent data to a same-volume sibling, clean the application, then
  ; restore the data before the new application files are installed.
  StrCpy $R8 "$INSTDIR.__magine-user-data-preserve"

  ; Recover a preserve directory left by an interrupted previous update.
  ${If} ${FileExists} "$R8\MagineCanvas-UserData\*.*"
    CreateDirectory "$INSTDIR"
    ClearErrors
    Rename "$R8\MagineCanvas-UserData" "$INSTDIR\MagineCanvas-UserData"
    ${If} ${Errors}
      Abort "Cannot restore MagineCanvas user data. Update aborted."
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$R8\magine-cache\*.*"
    CreateDirectory "$INSTDIR"
    ClearErrors
    Rename "$R8\magine-cache" "$INSTDIR\magine-cache"
    ${If} ${Errors}
      Abort "Cannot restore legacy MagineCanvas media cache. Update aborted."
    ${EndIf}
  ${EndIf}
  RMDir "$R8"
  CreateDirectory "$R8"

  ${If} ${FileExists} "$INSTDIR\MagineCanvas-UserData\*.*"
    ClearErrors
    Rename "$INSTDIR\MagineCanvas-UserData" "$R8\MagineCanvas-UserData"
    ${If} ${Errors}
      Abort "Cannot preserve MagineCanvas user data. Update aborted."
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\magine-cache\*.*"
    ClearErrors
    Rename "$INSTDIR\magine-cache" "$R8\magine-cache"
    ${If} ${Errors}
      Abort "Cannot preserve legacy MagineCanvas media cache. Update aborted."
    ${EndIf}
  ${EndIf}

  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR"
  CreateDirectory "$INSTDIR"

  ${If} ${FileExists} "$R8\MagineCanvas-UserData\*.*"
    Rename "$R8\MagineCanvas-UserData" "$INSTDIR\MagineCanvas-UserData"
  ${EndIf}
  ${If} ${FileExists} "$R8\magine-cache\*.*"
    Rename "$R8\magine-cache" "$INSTDIR\magine-cache"
  ${EndIf}
  RMDir "$R8"
  RMDir "$INSTDIR"
!macroend
