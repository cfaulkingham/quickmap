import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Model.js" as Model

Item {
  id: root

  property var screen: null
  property bool opened: false
  property var view: null
  property var markers: []
  property var vias: []
  property var route: []
  property var steps: []
  property bool routeEditable: false
  property string cacheDir: ""
  property bool tilesReady: false
  property string title: ""
  property string summary: ""
  property bool canPrint: false
  property bool canCache: false
  property bool caching: false
  property string statusText: ""
  property bool imperial: false
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family

  readonly property color background: Color.popups.background
  readonly property var borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.space(2)))
  readonly property color scrim: Util.alpha(Color.background, 0.72)

  readonly property real mapWidth: map.width
  readonly property real mapHeight: map.height
  readonly property var fitSize: Model.viewSizeForPixels(
    map.width >= 32 ? map.width : 800,
    map.height >= 32 ? map.height : 320
  )
  readonly property real viewCols: fitSize.cols
  readonly property real viewRows: fitSize.rows

  signal closeRequested()
  signal printRequested()
  signal cacheRequested()
  signal panRequested(real dx, real dy)
  signal zoomRequested(int delta, real ax, real ay)
  signal viaCommitted(int index, real lat, real lon, bool isNew)
  signal viaRemoved(int index)
  signal mapSizeChanged()

  function zoomIn() {
    if (!map.width || !map.height) return
    root.zoomRequested(1, map.width / 2, map.height / 2)
  }

  function zoomOut() {
    if (!map.width || !map.height) return
    root.zoomRequested(-1, map.width / 2, map.height / 2)
  }

  function handleMapWheel(wheel, item) {
    var p = item ? map.mapFromItem(item, wheel.x, wheel.y) : { x: wheel.x, y: wheel.y }
    if (map.consumeWheel(wheel, p.x, p.y))
      wheel.accepted = true
  }

  PanelWindow {
    id: window
    visible: root.opened
    screen: root.screen
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    anchors { top: true; bottom: true; left: true; right: true }

    WlrLayershell.namespace: "quickmap-modal"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: root.opened ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

    readonly property int cardWidth: Math.min(width - Style.space(40), Style.space(920))
    readonly property int cardHeight: Math.min(height - Style.space(40), Style.space(680))
    readonly property bool showSteps: root.steps && root.steps.length > 0
    readonly property int mapHeight: showSteps
      ? Math.max(Style.space(200), Math.round(cardHeight * 0.44))
      : Math.max(Style.space(200), cardHeight - Style.space(176))

    onVisibleChanged: if (visible) Qt.callLater(function() { keyCatcher.forceActiveFocus() })

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.closeRequested()
    }

    BorderSurface {
      id: card
      width: window.cardWidth
      height: window.cardHeight
      radius: Style.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec
      padding: Style.space(14)

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keyCatcher
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        focus: true

        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) {
            root.closeRequested()
            event.accepted = true
          } else if (event.key === Qt.Key_Plus || event.key === Qt.Key_Equal) {
            root.zoomIn()
            event.accepted = true
          } else if (event.key === Qt.Key_Minus) {
            root.zoomOut()
            event.accepted = true
          }
        }

        Item {
          id: header
          width: parent.width
          height: Math.max(closeButton.implicitHeight, titleCol.implicitHeight)
          anchors.top: parent.top

          Column {
            id: titleCol
            anchors.left: parent.left
            anchors.right: closeButton.left
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: root.title
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.subtitle
              font.bold: true
              elide: Text.ElideRight
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              visible: root.summary !== ""
              text: root.summary
              color: Qt.darker(root.foreground, 1.45)
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              elide: Text.ElideRight
            }
          }

          Button {
            id: closeButton
            text: "Close"
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            bordered: true
            onClicked: root.closeRequested()
          }
        }

        Item {
          id: mapFrame
          anchors.top: header.bottom
          anchors.topMargin: Style.space(10)
          anchors.left: parent.left
          anchors.right: parent.right
          height: window.mapHeight

          MapView {
            id: map
            anchors.fill: parent
            interactive: true
            routeEditable: root.routeEditable
            view: root.view
            markers: root.markers
            vias: root.vias
            route: root.route
            cacheDir: root.cacheDir
            tilesReady: root.tilesReady
            foreground: root.foreground
            accent: Color.accent
            onPanRequested: function(dx, dy) { root.panRequested(dx, dy) }
            onZoomRequested: function(delta, ax, ay) { root.zoomRequested(delta, ax, ay) }
            onViaCommitted: function(index, lat, lon, isNew) {
              root.viaCommitted(index, lat, lon, isNew)
            }
            onViaRemoved: function(index) { root.viaRemoved(index) }
            onWidthChanged: root.mapSizeChanged()
            onHeightChanged: root.mapSizeChanged()
          }

          Column {
            z: 20
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.margins: Style.space(8)
            spacing: Style.space(6)

            Rectangle {
              width: Style.space(32)
              height: Style.space(32)
              radius: Style.cornerRadius
              color: Qt.rgba(0, 0, 0, 0.72)
              border.color: Qt.rgba(1, 1, 1, 0.35)
              border.width: 1
              Text {
                textFormat: Text.PlainText
                anchors.centerIn: parent
                text: "+"
                color: "#ffffff"
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
              }
              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: root.zoomIn()
                onWheel: function(wheel) { root.handleMapWheel(wheel, this) }
              }
            }

            Rectangle {
              width: Style.space(32)
              height: Style.space(32)
              radius: Style.cornerRadius
              color: Qt.rgba(0, 0, 0, 0.72)
              border.color: Qt.rgba(1, 1, 1, 0.35)
              border.width: 1
              Text {
                textFormat: Text.PlainText
                anchors.centerIn: parent
                text: "−"
                color: "#ffffff"
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
              }
              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: root.zoomOut()
                onWheel: function(wheel) { root.handleMapWheel(wheel, this) }
              }
            }
          }
        }

        Item {
          id: footer
          height: Math.max(printButton.implicitHeight, cacheButton.implicitHeight)
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.bottom: parent.bottom

          Text {
            textFormat: Text.PlainText
            text: root.statusText !== ""
              ? root.statusText
              : (root.routeEditable
                ? "Drag the route to change it · scroll to zoom · © OpenStreetMap"
                : "Drag to pan · scroll to zoom · © OpenStreetMap")
            color: Qt.darker(root.foreground, 1.6)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
            anchors.left: parent.left
            anchors.right: footerBtns.left
            anchors.rightMargin: Style.space(8)
            anchors.verticalCenter: parent.verticalCenter
          }

          Row {
            id: footerBtns
            spacing: Style.space(8)
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter

            Button {
              id: cacheButton
              text: root.caching ? "Saving…" : "Cache offline"
              enabled: root.canCache && !root.caching
              foreground: root.foreground
              fontFamily: root.fontFamily
              fontSize: Style.font.bodySmall
              bordered: true
              onClicked: root.cacheRequested()
            }

            Button {
              id: printButton
              visible: root.canPrint
              text: "Print"
              foreground: root.foreground
              fontFamily: root.fontFamily
              fontSize: Style.font.bodySmall
              bordered: true
              onClicked: root.printRequested()
            }
          }
        }

        Flickable {
          id: stepsScroll
          anchors.top: mapFrame.bottom
          anchors.topMargin: Style.space(10)
          anchors.bottom: footer.top
          anchors.bottomMargin: Style.space(10)
          anchors.left: parent.left
          anchors.right: parent.right
          visible: window.showSteps
          clip: true
          contentWidth: width
          contentHeight: stepsCol.implicitHeight
          boundsBehavior: Flickable.StopAtBounds
          interactive: contentHeight > height

          Column {
            id: stepsCol
            width: stepsScroll.width
            spacing: Style.space(6)

            Repeater {
              model: root.steps

              Row {
                required property var modelData
                required property int index
                width: parent.width
                spacing: Style.space(8)

                Text {
                  textFormat: Text.PlainText
                  width: Style.space(22)
                  text: (index + 1) + "."
                  color: Qt.darker(root.foreground, 1.4)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                }

                Text {
                  textFormat: Text.PlainText
                  width: parent.width - Style.space(86)
                  text: modelData.instruction
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  wrapMode: Text.WordWrap
                }

                Text {
                  textFormat: Text.PlainText
                  visible: modelData.distance > 0
                  text: Model.formatDistance(modelData.distance, root.imperial)
                  color: Qt.darker(root.foreground, 1.5)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                }
              }
            }
          }
        }
      }
    }
  }
}
