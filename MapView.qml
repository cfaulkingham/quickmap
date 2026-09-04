import QtQuick
import qs.Commons
import "Model.js" as Model

Item {
  id: root

  property var view: null
  property var markers: []
  property var route: []
  property string cacheDir: ""
  property bool tilesReady: false
  property bool interactive: false
  property color foreground: Color.foreground
  property color accent: Color.accent
  property color fromColor: "#2563eb"
  property color toColor: "#e11d48"
  property real pinRadius: interactive ? 9 : 8

  readonly property int cols: view && view.cols ? view.cols : 0
  readonly property int rows: view && view.rows ? view.rows : 0
  readonly property var tiles: view && view.tiles ? view.tiles : []

  clip: true

  signal tapped()
  signal panRequested(real dx, real dy)
  signal zoomRequested(int delta, real ax, real ay)

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
      ctx.lineWidth = root.interactive ? 4 : 3
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
        source: root.tilesReady && root.cacheDir !== ""
          ? "file://" + root.cacheDir + "/" + modelData.z + "-" + modelData.x + "-" + modelData.y + ".png"
          : ""
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
    cursorShape: root.interactive
      ? (dragActive ? Qt.ClosedHandCursor : Qt.OpenHandCursor)
      : Qt.PointingHandCursor

    property real lastX: 0
    property real lastY: 0
    property bool dragActive: false

    onPressed: function(mouse) {
      lastX = mouse.x
      lastY = mouse.y
      dragActive = false
    }

    onPositionChanged: function(mouse) {
      if (!pressed) return
      var dx = mouse.x - lastX
      var dy = mouse.y - lastY
      if (!dragActive && Math.abs(dx) + Math.abs(dy) < 4) return
      dragActive = true
      lastX = mouse.x
      lastY = mouse.y
      if (root.interactive) root.panRequested(dx, dy)
    }

    onReleased: function(mouse) {
      if (!dragActive) root.tapped()
      dragActive = false
    }
  }

  WheelHandler {
    enabled: root.interactive
    onWheel: function(event) {
      var d = event.angleDelta.y > 0 ? 1 : (event.angleDelta.y < 0 ? -1 : 0)
      if (d === 0) return
      root.zoomRequested(d, event.position.x, event.position.y)
      event.accepted = true
    }
  }

  onWidthChanged: overlay.requestPaint()
  onHeightChanged: overlay.requestPaint()
  onViewChanged: overlay.requestPaint()
  onMarkersChanged: overlay.requestPaint()
  onRouteChanged: overlay.requestPaint()
  onTilesReadyChanged: overlay.requestPaint()
  onToColorChanged: overlay.requestPaint()
  onFromColorChanged: overlay.requestPaint()
}
