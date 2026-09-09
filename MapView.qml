import QtQuick
import qs.Commons
import "Model.js" as Model

Item {
  id: root

  property var view: null
  property var markers: []
  property var vias: []
  property var route: []
  property string cacheDir: ""
  property bool tilesReady: false
  property bool interactive: false
  property bool routeEditable: false
  property color foreground: Color.foreground
  property color accent: Color.accent
  property color fromColor: "#2563eb"
  property color toColor: "#e11d48"
  property real pinRadius: interactive ? 9 : 8
  property real viaRadius: interactive ? 7 : 5

  readonly property real cols: view && view.cols ? view.cols : 0
  readonly property real rows: view && view.rows ? view.rows : 0
  readonly property var tiles: view && view.tiles ? view.tiles : []

  clip: true

  signal tapped()
  signal panRequested(real dx, real dy)
  signal zoomRequested(int delta, real ax, real ay)
  signal viaCommitted(int index, real lat, real lon, bool isNew)
  signal viaRemoved(int index)

  property real wheelRemain: 0

  function consumeWheel(wheel, ax, ay) {
    if (!root.interactive) return false
    if (wheel.phase === Qt.ScrollMomentum) return true
    var dy = wheel.angleDelta.y
    if (dy === 0) dy = wheel.pixelDelta.y * 8
    dy = Number(dy)
    if (!isFinite(dy) || dy === 0) return false
    if (pointer.draggingVia) return true
    if (root.wheelRemain !== 0 && (root.wheelRemain > 0) !== (dy > 0))
      root.wheelRemain = 0
    root.wheelRemain += dy
    if (Math.abs(root.wheelRemain) < 120) return true
    var d = root.wheelRemain > 0 ? 1 : -1
    root.wheelRemain = 0
    root.zoomRequested(d, ax, ay)
    return true
  }

  function paintOverlay() {
    var ctx = overlay.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    if (!root.view || !root.cols || !root.rows) return

    var w = overlay.width
    var h = overlay.height
    var coords = root.route || []
    if (coords.length > 1) {
      ctx.strokeStyle = "" + root.accent
      ctx.lineWidth = pointer.routeHot || pointer.draggingVia
        ? (root.interactive ? 6 : 4)
        : (root.interactive ? 4 : 3)
      ctx.lineJoin = "round"
      ctx.lineCap = "round"
      ctx.beginPath()
      for (var i = 0; i < coords.length; i++) {
        var c = coords[i]
        if (!c || c.length < 2) continue
        var p = Model.projectOnView(c[1], c[0], root.view, w, h)
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    }

    var viaDots = []
    var stops = root.vias || []
    for (var v = 0; v < stops.length; v++) {
      var via = stops[v]
      if (!via) continue
      var vlat = via.lat
      var vlon = via.lon
      if (pointer.draggingVia && !pointer.draggingNew && pointer.dragViaIndex === v) {
        vlat = pointer.dragLat
        vlon = pointer.dragLon
      }
      viaDots.push({
        lat: vlat,
        lon: vlon,
        active: pointer.viaHotIndex === v || (pointer.draggingVia && pointer.dragViaIndex === v)
      })
    }
    if (pointer.draggingVia && pointer.draggingNew)
      viaDots.push({ lat: pointer.dragLat, lon: pointer.dragLon, active: true })
    for (var d = 0; d < viaDots.length; d++) {
      var dot = viaDots[d]
      var vp = Model.projectOnView(dot.lat, dot.lon, root.view, w, h)
      var vr = dot.active ? root.viaRadius + 2 : root.viaRadius
      ctx.beginPath()
      ctx.strokeStyle = "rgba(0,0,0,0.5)"
      ctx.lineWidth = 2.5
      ctx.arc(vp.x, vp.y, vr + 1, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.fillStyle = "#ffffff"
      ctx.strokeStyle = "" + root.accent
      ctx.lineWidth = dot.active ? 3 : 2.5
      ctx.arc(vp.x, vp.y, vr, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    var pins = root.markers || []
    for (var j = 0; j < pins.length; j++) {
      var m = pins[j]
      if (!m) continue
      var q = Model.projectOnView(m.lat, m.lon, root.view, w, h)
      var fill = m.role === "from" ? ("" + root.fromColor) : ("" + root.toColor)
      var r = root.pinRadius
      ctx.beginPath()
      ctx.strokeStyle = "rgba(0,0,0,0.55)"
      ctx.lineWidth = 3
      ctx.arc(q.x, q.y, r + 1.5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.fillStyle = fill
      ctx.strokeStyle = "#ffffff"
      ctx.lineWidth = 2.5
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }

  Rectangle {
    anchors.fill: parent
    radius: Style.cornerRadius
    color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.06)
  }

  Item {
    id: tileLayer
    visible: root.cols > 0
    anchors.fill: parent

    Repeater {
      model: root.tiles

      Image {
        required property var modelData
        x: root.cols > 0
          ? (modelData.col - (root.view.tileX - root.view.minTx)) / root.cols * root.width
          : 0
        y: root.rows > 0
          ? (modelData.row - (root.view.tileY - root.view.minTy)) / root.rows * root.height
          : 0
        width: root.cols > 0 ? root.width / root.cols : 0
        height: root.rows > 0 ? root.height / root.rows : 0
        source: {
          var name = Model.tileFileName(modelData)
          return root.tilesReady && root.cacheDir !== "" && name !== ""
            ? "file://" + root.cacheDir + "/" + name
            : ""
        }
        sourceSize.width: Model.tileSize()
        sourceSize.height: Model.tileSize()
        fillMode: Image.Stretch
        asynchronous: true
        cache: true
      }
    }
  }

  Canvas {
    id: overlay
    anchors.fill: parent
    onPaint: root.paintOverlay()
  }

  MouseArea {
    id: pointer
    anchors.fill: parent
    hoverEnabled: true
    acceptedButtons: Qt.LeftButton
    cursorShape: {
      if (draggingVia || viaHotIndex >= 0 || routeHot) return Qt.PointingHandCursor
      if (root.interactive) return dragActive ? Qt.ClosedHandCursor : Qt.OpenHandCursor
      return Qt.PointingHandCursor
    }

    property real lastX: 0
    property real lastY: 0
    property bool dragActive: false
    property bool draggingVia: false
    property bool draggingNew: false
    property bool dragMoved: false
    property int dragViaIndex: -1
    property real dragLat: 0
    property real dragLon: 0
    property bool routeHot: false
    property int viaHotIndex: -1

    function updateHover(mx, my) {
      if (!root.routeEditable || !root.view) {
        if (routeHot || viaHotIndex !== -1) {
          routeHot = false
          viaHotIndex = -1
          overlay.requestPaint()
        }
        return
      }
      var w = overlay.width
      var h = overlay.height
      var viaHit = Model.hitIndex(root.vias, root.view, w, h, mx, my, Model.viaHitPx())
      var pinHit = Model.hitIndex(root.markers, root.view, w, h, mx, my, root.pinRadius + 4)
      var hot = false
      if (pinHit < 0 && viaHit < 0) {
        var hit = Model.nearestOnRoute(root.route, root.view, w, h, mx, my)
        hot = !!(hit && hit.dist <= Model.routeHitPx())
        if (hot && root.vias && root.vias.length >= Model.maxVias()) hot = false
      }
      if (hot !== routeHot || viaHit !== viaHotIndex) {
        routeHot = hot
        viaHotIndex = viaHit
        overlay.requestPaint()
      }
    }

    onPressed: function(mouse) {
      lastX = mouse.x
      lastY = mouse.y
      dragActive = false
      draggingVia = false
      draggingNew = false
      dragMoved = false
      dragViaIndex = -1
      if (!root.routeEditable || !root.view) return
      var w = overlay.width
      var h = overlay.height
      var pinHit = Model.hitIndex(root.markers, root.view, w, h, mouse.x, mouse.y, root.pinRadius + 4)
      if (pinHit >= 0) return
      var viaHit = Model.hitIndex(root.vias, root.view, w, h, mouse.x, mouse.y, Model.viaHitPx())
      if (viaHit >= 0) {
        draggingVia = true
        draggingNew = false
        dragViaIndex = viaHit
        dragLat = root.vias[viaHit].lat
        dragLon = root.vias[viaHit].lon
        overlay.requestPaint()
        return
      }
      var canAdd = !root.vias || root.vias.length < Model.maxVias()
      if (!canAdd) return
      var hit = Model.nearestOnRoute(root.route, root.view, w, h, mouse.x, mouse.y)
      if (hit && hit.dist <= Model.routeHitPx()) {
        draggingVia = true
        draggingNew = true
        dragViaIndex = -1
        dragLat = hit.lat
        dragLon = hit.lon
        overlay.requestPaint()
      }
    }

    onPositionChanged: function(mouse) {
      if (!pressed) {
        updateHover(mouse.x, mouse.y)
        return
      }
      var dx = mouse.x - lastX
      var dy = mouse.y - lastY
      if (!dragMoved && Math.abs(dx) + Math.abs(dy) < 4) return
      dragMoved = true
      lastX = mouse.x
      lastY = mouse.y
      if (draggingVia) {
        var geo = Model.unprojectOnView(mouse.x, mouse.y, root.view, overlay.width, overlay.height)
        dragLat = geo.lat
        dragLon = geo.lon
        overlay.requestPaint()
        return
      }
      dragActive = true
      if (root.interactive) root.panRequested(dx, dy)
    }

    onReleased: function(mouse) {
      if (draggingVia) {
        if (!dragMoved && !draggingNew && dragViaIndex >= 0)
          root.viaRemoved(dragViaIndex)
        else if (dragMoved)
          root.viaCommitted(dragViaIndex, dragLat, dragLon, draggingNew)
        draggingVia = false
        draggingNew = false
        dragViaIndex = -1
        overlay.requestPaint()
        updateHover(mouse.x, mouse.y)
        dragActive = false
        dragMoved = false
        return
      }
      if (!dragActive) root.tapped()
      dragActive = false
      dragMoved = false
    }

    onExited: {
      if (pressed) return
      routeHot = false
      viaHotIndex = -1
      overlay.requestPaint()
    }

    onWheel: function(wheel) {
      if (root.consumeWheel(wheel, wheel.x, wheel.y))
        wheel.accepted = true
    }
  }

  onWidthChanged: overlay.requestPaint()
  onHeightChanged: overlay.requestPaint()
  onViewChanged: {
    root.wheelRemain = 0
    overlay.requestPaint()
  }
  onMarkersChanged: overlay.requestPaint()
  onRouteChanged: overlay.requestPaint()
  onViasChanged: overlay.requestPaint()
  onRouteEditableChanged: overlay.requestPaint()
  onTilesReadyChanged: overlay.requestPaint()
  onToColorChanged: overlay.requestPaint()
  onFromColorChanged: overlay.requestPaint()
}
