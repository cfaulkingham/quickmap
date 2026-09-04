import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

Panel {
  id: root
  moduleName: "io.github.cfaulkingham.quickmap"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property string mode: "lookup"
  property var suggestions: []
  property int suggestionIndex: 0
  property string searchField: "query"
  property var place: null
  property var fromPlace: null
  property var toPlace: null
  property var route: null
  property var currentLocation: null
  property var mapView: null
  property var mapMarkers: []
  property var mapRoute: []
  property bool tilesReady: false
  property bool searching: false
  property bool routing: false
  property bool applyingText: false
  property string searchPending: ""
  property string searchActive: ""
  property string status: ""
  property bool modalOpen: false
  property var modalView: null
  property bool modalTilesReady: false
  property bool modalFetchQueued: false
  property var prefetchQueuedView: null
  property bool cachingOffline: false
  property bool offlineQueued: false
  property string modalStatus: ""
  property string printOutput: ""
  property bool offline: false
  property bool routeQueued: false

  readonly property var barIdentity: hostWidget || root
  readonly property color contentForeground: bar ? bar.barForeground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property bool imperial: Model.useImperial(Qt.locale().name)
  readonly property string cacheDir: {
    var xdg = Quickshell.env("XDG_CACHE_HOME")
    return (xdg ? xdg : Quickshell.env("HOME") + "/.cache") + "/quickmap/tiles"
  }
  readonly property bool usingCurrentOrigin: mode !== "lookup" && Model.trim(fromField.text) === ""
  readonly property var effectiveOrigin: usingCurrentOrigin ? currentLocation : fromPlace
  readonly property bool showSuggestions: suggestions.length > 0
  readonly property bool showMap: !showSuggestions && mapView && mapView.tiles && mapView.tiles.length > 0
  readonly property bool fieldFocused: queryField.activeFocus || fromField.activeFocus || toField.activeFocus
  readonly property string cacheRoot: {
    var xdg = Quickshell.env("XDG_CACHE_HOME")
    return (xdg ? xdg : Quickshell.env("HOME") + "/.cache") + "/quickmap"
  }
  readonly property var routeSteps: root.route && root.route.steps ? root.route.steps : []
  readonly property string modalTitle: Model.directionsTitle(root.effectiveOrigin, root.toPlace, root.place, root.mode)
  readonly property string modalSummary: root.route
    ? (Model.modeLabel(root.mode) + " · " + Model.formatSummary(root.route, root.imperial))
    : (root.place && root.place.description ? root.place.description : "")
  readonly property var modeOptions: [
    { value: "lookup", label: "Lookup" },
    { value: "drive", label: "Drive" },
    { value: "walk", label: "Walk" }
  ]
  readonly property string offlineSearchMessage: "Offline — search not available"
  readonly property bool hasMap: root.showMap
  readonly property string hint: {
    if (root.offline) return root.offlineSearchMessage
    if (root.searching) return "Searching…"
    if (root.routing) return "Routing…"
    if (root.status && !(root.status === "No results" && (root.place || root.route)))
      return root.status
    if (root.mode === "lookup")
      return root.place ? root.place.description : "Type an address, city, or coordinates"
    if (!root.effectiveOrigin) return "Type a starting point — current location unknown"
    if (!root.toPlace) return "Type a destination"
    if (root.route) return Model.formatSummary(root.route, root.imperial)
    return ""
  }

  function open() {
    root.controller.show()
    root.offline = false
    if (root.status === root.offlineSearchMessage) root.status = ""
    if (!root.currentLocation) root.fetchIpLocation()
    Qt.callLater(function() {
      if (!root.opened) return
      setCenterHoverRevealSuppressed(true)
      root.focusPrimaryField()
    })
  }

  function markOffline() {
    root.offline = true
    root.searching = false
    root.routing = false
    root.suggestions = []
    root.status = root.offlineSearchMessage
    searchDebounce.stop()
  }

  function markOnline() {
    if (!root.offline) return
    root.offline = false
    if (root.status === root.offlineSearchMessage) root.status = ""
  }

  function close() {
    root.closeModal()
    setCenterHoverRevealSuppressed(false)
    root.controller.hide()
  }

  function closeModal() {
    root.modalOpen = false
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && "centerHoverRevealSuppressed" in root.bar)
      root.bar.centerHoverRevealSuppressed = value
  }

  function focusPrimaryField() {
    if (root.offline) return
    if (root.mode === "lookup") {
      queryField.forceActiveFocus()
      queryField.selectAll()
    } else {
      toField.forceActiveFocus()
      toField.selectAll()
    }
  }

  function setMode(next) {
    if (!next || next === root.mode) return
    var prev = root.mode
    root.mode = next
    root.suggestions = []
    root.status = ""
    if (prev === "lookup" && root.place && !root.toPlace)
      root.setPlaceOnField("to", root.place)
    if (next === "lookup" && !root.place && root.toPlace)
      root.setPlaceOnField("query", root.toPlace)
    if (next === "lookup") root.route = null
    else root.maybeRoute()
    root.refreshMap()
    Qt.callLater(root.focusPrimaryField)
  }

  function activeFieldName() {
    if (fromField.activeFocus) return "from"
    if (toField.activeFocus) return "to"
    return "query"
  }

  function fieldText(name) {
    if (name === "from") return fromField.text
    if (name === "to") return toField.text
    return queryField.text
  }

  function setPlaceOnField(name, value) {
    root.applyingText = true
    if (name === "from") {
      root.fromPlace = value
      fromField.text = value ? value.name : ""
    } else if (name === "to") {
      root.toPlace = value
      toField.text = value ? value.name : ""
    } else {
      root.place = value
      queryField.text = value ? value.name : ""
    }
    root.applyingText = false
  }

  function onOriginTextChanged(text) {
    if (Model.trim(text) === "") {
      root.fromPlace = null
      root.suggestions = []
      searchDebounce.stop()
      root.maybeRoute()
      root.refreshMap()
      return
    }
    root.queueSearch("from", text)
  }

  function onDestinationTextChanged(text) {
    if (Model.trim(text) === "") {
      root.toPlace = null
      root.route = null
      root.suggestions = []
      searchDebounce.stop()
      root.refreshMap()
      return
    }
    root.queueSearch("to", text)
  }

  function queueSearch(name, text) {
    if (root.offline) {
      searchDebounce.stop()
      root.suggestions = []
      root.status = root.offlineSearchMessage
      return
    }
    root.searchField = name
    if (name === "from") root.fromPlace = null
    if (name === "to") root.toPlace = null
    if (name === "query") root.place = null
    root.route = null
    root.status = ""
    var coords = Model.parseCoords(text)
    if (coords) {
      root.suggestions = []
      searchDebounce.stop()
      return
    }
    var q = Model.trim(text)
    if (q.length < 2) {
      root.suggestions = []
      searchDebounce.stop()
      return
    }
    root.searchPending = q
    searchDebounce.restart()
  }

  function startSearch() {
    if (root.offline) {
      root.searching = false
      root.status = root.offlineSearchMessage
      return
    }
    if (!root.searchPending) return
    if (searchProc.running) return
    root.searchActive = root.searchPending
    root.searching = true
    searchProc.command = Model.curlCommand(Model.searchUrl(root.searchActive, 5))
    searchProc.running = true
  }

  function submitField(name) {
    root.searchField = name
    var text = root.fieldText(name)
    if (root.suggestions.length > 0) {
      root.pickSuggestion(root.suggestions[root.suggestionIndex])
      return
    }
    if (root.showMap) {
      root.openModal()
      return
    }
    var coords = Model.parseCoords(text)
    if (coords) {
      root.applyPlace(name, Model.coordsPlace(coords.lat, coords.lon))
      return
    }
    if (root.offline) {
      root.status = root.offlineSearchMessage
      return
    }
    var q = Model.trim(text)
    if (q.length < 2) return
    root.searchPending = q
    searchDebounce.stop()
    root.startSearch()
  }

  function pickSuggestion(item) {
    if (!item) return
    root.applyPlace(root.searchField, item)
  }

  function applyPlace(name, item) {
    if (!item) return
    root.suggestions = []
    root.status = ""
    searchDebounce.stop()
    root.setPlaceOnField(name, item)
    if (root.mode === "lookup") root.route = null
    else root.maybeRoute()
    root.refreshMap()
  }

  function maybeRoute() {
    if (root.mode !== "drive" && root.mode !== "walk") return
    if (root.offline) {
      root.status = root.offlineSearchMessage
      return
    }
    if (!root.effectiveOrigin || !root.toPlace) {
      root.route = null
      return
    }
    if (routeProc.running) {
      root.routeQueued = true
      return
    }
    root.routing = true
    root.status = ""
    routeProc.command = Model.curlCommand(Model.routeUrl(root.mode, root.effectiveOrigin, root.toPlace))
    routeProc.running = true
  }

  function refreshMap() {
    var lookupPlace = root.mode === "lookup" ? root.place : null
    var origin = root.mode === "lookup" ? null : root.effectiveOrigin
    var dest = root.mode === "lookup" ? null : root.toPlace
    var points = Model.pointsFrom(lookupPlace, origin, dest, root.route)
    root.mapView = Model.fitView(points)
    root.mapMarkers = Model.markersFor(root.mode, lookupPlace, origin, dest)
    root.mapRoute = root.route && root.route.coordinates
      ? Model.downsampleLine(root.route.coordinates, 160)
      : []
    root.tilesReady = false
    if (!root.mapView || !root.mapView.tiles || !root.mapView.tiles.length) return
    root.fetchTiles()
    if (root.modalOpen) root.resetModalView()
  }

  function fetchTiles() {
    if (tileProc.running) tileProc.running = false
    tileProc.command = ["bash", "-lc", Model.tileFetchScript(root.cacheDir, root.mapView.tiles, Model.userAgent())]
    tileProc.running = true
  }

  function prefetchAround(view) {
    if (!view || !view.tiles) return
    if (prefetchProc.running) {
      root.prefetchQueuedView = view
      return
    }
    prefetchProc.command = ["bash", "-lc", Model.tileFetchScript(root.cacheDir, Model.prefetchTiles(view), Model.userAgent())]
    prefetchProc.running = true
  }

  function mapPoints() {
    var lookupPlace = root.mode === "lookup" ? root.place : null
    var origin = root.mode === "lookup" ? null : root.effectiveOrigin
    var dest = root.mode === "lookup" ? null : root.toPlace
    return Model.pointsFrom(lookupPlace, origin, dest, root.route)
  }

  function resetModalView() {
    root.modalView = Model.fitView(root.mapPoints(), 3, 2)
    root.modalTilesReady = false
    root.fetchModalTiles()
  }

  function openModal() {
    if (!root.showMap) return
    root.resetModalView()
    root.modalOpen = true
  }

  function panModal(dx, dy) {
    if (!root.modalView || !mapModal.mapWidth) return
    root.modalView = Model.panView(root.modalView, dx, dy, mapModal.mapWidth, mapModal.mapHeight)
    modalTileDebounce.restart()
  }

  function zoomModal(delta, ax, ay) {
    if (!root.modalView || !mapModal.mapWidth) return
    root.modalView = Model.zoomView(root.modalView, delta, ax, ay, mapModal.mapWidth, mapModal.mapHeight)
    modalTileDebounce.restart()
  }

  function fetchModalTiles() {
    if (!root.modalView || !root.modalView.tiles) return
    if (modalTileProc.running) {
      root.modalFetchQueued = true
      return
    }
    modalTileProc.command = ["bash", "-lc", Model.tileFetchScript(root.cacheDir, root.modalView.tiles, Model.userAgent())]
    modalTileProc.running = true
  }

  function printDirections() {
    if (!root.route) return
    var text = Model.formatDirectionsText(root.route, root.effectiveOrigin, root.toPlace, root.mode, root.imperial)
    root.printOutput = ""
    root.modalStatus = "Sending to printer…"
    if (printProc.running) printProc.running = false
    printProc.command = Model.printCommand(root.cacheRoot + "/directions.txt", text)
    printProc.running = true
  }

  function cacheView() {
    return root.modalOpen && root.modalView ? root.modalView : root.mapView
  }

  function cacheOffline() {
    var view = root.cacheView()
    if (!view || !view.tiles) return
    if (root.cachingOffline) return
    if (prefetchProc.running || modalTileProc.running || tileProc.running) {
      root.offlineQueued = true
      root.modalStatus = "Waiting to save offline…"
      return
    }
    var tiles = Model.offlineTiles(view)
    if (!tiles.length) return
    root.cachingOffline = true
    root.modalStatus = "Saving " + tiles.length + " tiles for offline use…"
    root.status = root.modalStatus
    offlineProc.command = ["bash", "-lc", Model.tileFetchScript(root.cacheDir, tiles, Model.userAgent())]
    offlineProc.running = true
  }

  function fetchIpLocation() {
    if (ipProc.running || root.currentLocation) return
    ipProc.command = Model.curlCommand("https://ipwho.is/")
    ipProc.running = true
  }

  function openInOsm() {
    var url = Model.openUrl(root.place, root.effectiveOrigin, root.toPlace, root.mode)
    if (url) Quickshell.execDetached(["xdg-open", url])
  }

  function handleFieldKeys(event, name) {
    if (event.key === Qt.Key_Escape) {
      if (root.modalOpen) root.closeModal()
      else root.close()
      event.accepted = true
    } else if (event.key === Qt.Key_Down) {
      root.suggestionIndex = Model.moveSuggestion(root.suggestionIndex, 1, root.suggestions.length)
      event.accepted = true
    } else if (event.key === Qt.Key_Up) {
      root.suggestionIndex = Model.moveSuggestion(root.suggestionIndex, -1, root.suggestions.length)
      event.accepted = true
    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      root.submitField(name)
      event.accepted = true
    }
  }

  FileView {
    path: Quickshell.env("HOME") + "/.local/state/omarchy/settings/weather.json"
    watchChanges: true
    printErrors: false
    onLoaded: {
      var loc = Model.parseLocationFile(text())
      if (loc) root.currentLocation = loc
    }
  }

  Process {
    id: searchProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.searching = false
        if (root.searchPending !== root.searchActive) {
          Qt.callLater(root.startSearch)
          return
        }
        var raw = String(text || "").trim()
        if (!raw) return
        root.markOnline()
        root.suggestions = Model.parseSearchResults(raw)
        root.suggestionIndex = 0
        if (root.suggestions.length === 0 && Model.trim(root.fieldText(root.searchField)).length >= 2)
          root.status = "No results"
      }
    }
    onExited: function(code) {
      root.searching = false
      if (code === 0) return
      if (root.searchPending !== root.searchActive) {
        Qt.callLater(root.startSearch)
        return
      }
      root.markOffline()
    }
  }

  Process {
    id: routeProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.routing = false
        var raw = String(text || "").trim()
        if (!raw) return
        root.markOnline()
        var parsed = Model.parseRoute(raw)
        root.route = parsed
        if (!parsed) root.status = "No route found"
        root.refreshMap()
        if (root.routeQueued) {
          root.routeQueued = false
          Qt.callLater(root.maybeRoute)
        }
      }
    }
    onExited: function(code) {
      root.routing = false
      if (code !== 0) root.markOffline()
      else if (root.routeQueued) {
        root.routeQueued = false
        Qt.callLater(root.maybeRoute)
      }
    }
  }

  Process {
    id: tileProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var miss = String(text || "").indexOf("1") !== -1
        if (miss) {
          root.tilesReady = false
          Qt.callLater(function() { root.tilesReady = true })
        } else {
          root.tilesReady = true
        }
        root.prefetchAround(root.mapView)
        if (root.offlineQueued) {
          root.offlineQueued = false
          Qt.callLater(root.cacheOffline)
        }
      }
    }
  }

  Process {
    id: modalTileProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var miss = String(text || "").indexOf("1") !== -1
        if (miss) {
          root.modalTilesReady = false
          Qt.callLater(function() { root.modalTilesReady = true })
        } else {
          root.modalTilesReady = true
        }
        if (root.modalFetchQueued) {
          root.modalFetchQueued = false
          Qt.callLater(root.fetchModalTiles)
        } else if (root.offlineQueued) {
          root.offlineQueued = false
          Qt.callLater(root.cacheOffline)
        } else {
          root.prefetchAround(root.modalView)
        }
      }
    }
  }

  Process {
    id: prefetchProc
    onExited: {
      if (root.offlineQueued) {
        root.offlineQueued = false
        Qt.callLater(root.cacheOffline)
        return
      }
      if (!root.prefetchQueuedView) return
      var view = root.prefetchQueuedView
      root.prefetchQueuedView = null
      Qt.callLater(function() { root.prefetchAround(view) })
    }
  }

  Process {
    id: offlineProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.cachingOffline = false
        var miss = String(text || "").indexOf("1") !== -1
        var msg = miss ? "Offline cache saved" : "Already cached for offline use"
        root.modalStatus = msg
        root.status = msg
      }
    }
    onExited: function(code) {
      if (code === 0) return
      root.cachingOffline = false
      root.modalStatus = "Offline cache failed"
      root.status = root.modalStatus
    }
  }

  Process {
    id: printProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: { root.printOutput = String(text || "") }
    }
    onExited: function(code) {
      var out = String(root.printOutput || "")
      var msg = "Print failed"
      if (code === 0) msg = "Sent to printer"
      else if (out.indexOf("NO_PRINTER") !== -1) msg = "No printer configured"
      root.status = msg
      root.modalStatus = msg
    }
  }

  Timer {
    id: modalTileDebounce
    interval: 50
    onTriggered: root.fetchModalTiles()
  }

  Process {
    id: ipProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (root.currentLocation) return
        var loc = Model.parseIpLocation(text)
        if (loc) {
          root.currentLocation = loc
          if (root.mode !== "lookup") {
            root.maybeRoute()
            root.refreshMap()
          }
        }
      }
    }
  }

  Timer {
    id: searchDebounce
    interval: 400
    onTriggered: root.startSearch()
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(440))
    contentHeight: panel.fittedContentHeight(content.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.fieldFocused || root.modalOpen
      onCloseRequested: root.modalOpen ? root.closeModal() : root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onMoveRequested: function(dx, dy) {
        root.suggestionIndex = Model.moveSuggestion(root.suggestionIndex, dy === 0 ? dx : dy, root.suggestions.length)
      }
      onActivateRequested: {
        if (root.showSuggestions) root.pickSuggestion(root.suggestions[root.suggestionIndex])
        else if (root.showMap) root.openModal()
      }

      Column {
        id: content
        width: parent.width
        spacing: Style.space(10)

        ButtonGroup {
          width: parent.width
          options: root.modeOptions
          value: root.mode
          foreground: root.contentForeground
          fontFamily: root.contentFontFamily
          fontSize: Style.font.bodySmall
          focusable: false
          onChanged: function(value) { root.setMode(value) }
        }

        TextField {
          id: queryField
          width: parent.width
          visible: root.mode === "lookup"
          enabled: !root.offline
          placeholderText: root.offline ? root.offlineSearchMessage : "Search an address"
          foreground: root.contentForeground
          font.family: root.contentFontFamily
          onTextChanged: if (!root.applyingText && root.mode === "lookup") root.queueSearch("query", text)
          Keys.onPressed: function(event) { root.handleFieldKeys(event, "query") }
        }

        Column {
          width: parent.width
          visible: root.mode !== "lookup"
          spacing: Style.space(6)

          TextField {
            id: fromField
            width: parent.width
            enabled: !root.offline
            placeholderText: root.offline
              ? root.offlineSearchMessage
              : (root.currentLocation
                ? "From · " + root.currentLocation.name
                : "From · current location")
            foreground: root.contentForeground
            font.family: root.contentFontFamily
            onTextChanged: if (!root.applyingText && root.mode !== "lookup") root.onOriginTextChanged(text)
            Keys.onPressed: function(event) { root.handleFieldKeys(event, "from") }
          }

          TextField {
            id: toField
            width: parent.width
            enabled: !root.offline
            placeholderText: root.offline ? root.offlineSearchMessage : "To"
            foreground: root.contentForeground
            font.family: root.contentFontFamily
            onTextChanged: if (!root.applyingText && root.mode !== "lookup") root.onDestinationTextChanged(text)
            Keys.onPressed: function(event) { root.handleFieldKeys(event, "to") }
          }
        }

        Text {
          width: parent.width
          visible: root.hint !== ""
          text: root.hint
          color: Qt.darker(root.contentForeground, 1.45)
          font.family: root.contentFontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
          maximumLineCount: 2
          elide: Text.ElideRight
        }

        Column {
          width: parent.width
          visible: root.showSuggestions
          spacing: Style.space(2)

          Repeater {
            model: root.suggestions

            Rectangle {
              required property var modelData
              required property int index
              width: parent.width
              height: suggestionCol.implicitHeight + Style.space(10)
              radius: Style.cornerRadius
              color: index === root.suggestionIndex
                ? Style.hoverFillFor(root.contentForeground, Color.accent)
                : "transparent"

              Column {
                id: suggestionCol
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.leftMargin: Style.space(8)
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(1)

                Text {
                  width: parent.width
                  text: modelData.name
                  color: index === root.suggestionIndex
                    ? Style.hoverStateColor(root.contentForeground, Color.accent)
                    : root.contentForeground
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.body
                  elide: Text.ElideRight
                }

                Text {
                  width: parent.width
                  visible: modelData.description !== ""
                  text: modelData.description
                  color: Qt.darker(root.contentForeground, 1.5)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideRight
                }
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onPositionChanged: root.suggestionIndex = index
                onClicked: root.pickSuggestion(modelData)
              }
            }
          }
        }

        Item {
          width: parent.width
          height: Style.space(196)
          visible: root.showMap

          MapView {
            anchors.fill: parent
            view: root.mapView
            markers: root.mapMarkers
            route: root.mapRoute
            cacheDir: root.cacheDir
            tilesReady: root.tilesReady
            foreground: root.contentForeground
            accent: Color.accent
            onTapped: root.openModal()
          }

          Rectangle {
            z: 20
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.margins: Style.space(6)
            width: expandLabel.implicitWidth + Style.space(16)
            height: expandLabel.implicitHeight + Style.space(10)
            radius: Style.cornerRadius
            color: Qt.rgba(0, 0, 0, 0.62)

            Text {
              id: expandLabel
              anchors.centerIn: parent
              text: "Expand"
              color: "#ffffff"
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.caption
            }

            MouseArea {
              anchors.fill: parent
              cursorShape: Qt.PointingHandCursor
              onClicked: root.openModal()
            }
          }
        }

        Column {
          width: parent.width
          visible: root.showMap && root.routeSteps.length > 0
          spacing: Style.space(4)

          Repeater {
            model: root.routeSteps.slice(0, 4)

            Row {
              required property var modelData
              width: parent.width
              spacing: Style.space(8)

              Text {
                width: parent.width - Style.space(64)
                text: modelData.instruction
                color: root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
                wrapMode: Text.WordWrap
              }

              Text {
                visible: modelData.distance > 0
                text: Model.formatDistance(modelData.distance, root.imperial)
                color: Qt.darker(root.contentForeground, 1.5)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
              }
            }
          }

          Row {
            spacing: Style.space(8)

            Button {
              text: root.routeSteps.length > 4 ? "View all (" + root.routeSteps.length + ")" : "View all"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
              fontSize: Style.font.bodySmall
              bordered: true
              onClicked: root.openModal()
            }

            Button {
              text: "Print"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
              fontSize: Style.font.bodySmall
              bordered: true
              onClicked: root.printDirections()
            }
          }
        }

        Item {
          width: parent.width
          height: osmButton.implicitHeight

          Text {
            text: "© OpenStreetMap"
            color: Qt.darker(root.contentForeground, 1.6)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          Row {
            spacing: Style.space(8)
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter

            Button {
              text: root.cachingOffline ? "Saving…" : "Cache"
              enabled: root.hasMap && !root.cachingOffline
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
              fontSize: Style.font.bodySmall
              bordered: true
              onClicked: root.cacheOffline()
            }

            Button {
              id: osmButton
              text: "Open in browser"
              tooltipText: "Opens OpenStreetMap in another app"
              enabled: root.hasMap && Model.openUrl(root.place, root.effectiveOrigin, root.toPlace, root.mode) !== ""
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
              fontSize: Style.font.bodySmall
              bordered: true
              onClicked: root.openInOsm()
            }
          }
        }
      }
    }
  }

  MapModal {
    id: mapModal
    screen: panel.screen
    opened: root.modalOpen && root.opened
    view: root.modalView
    markers: root.mapMarkers
    route: root.mapRoute
    steps: root.routeSteps
    cacheDir: root.cacheDir
    tilesReady: root.modalTilesReady
    title: root.modalTitle
    summary: root.modalSummary
    canPrint: root.routeSteps.length > 0
    canCache: root.hasMap
    caching: root.cachingOffline
    statusText: root.modalStatus
    imperial: root.imperial
    foreground: root.contentForeground
    fontFamily: root.contentFontFamily
    onCloseRequested: root.closeModal()
    onPrintRequested: root.printDirections()
    onCacheRequested: root.cacheOffline()
    onPanRequested: function(dx, dy) { root.panModal(dx, dy) }
    onZoomRequested: function(delta, ax, ay) { root.zoomModal(delta, ax, ay) }
  }
}
