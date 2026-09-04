const assert = require("assert")
const Model = require("../Model.js")

const nominatim = JSON.stringify([
  {
    lat: "38.8976998",
    lon: "-77.0365535",
    name: "White House",
    display_name: "White House, 1600 Pennsylvania Avenue NW, Washington, DC, United States",
    type: "building"
  },
  {
    lat: "39.6687749",
    lon: "-77.7193667",
    display_name: "1600, Pennsylvania Avenue, Washington County, Maryland, United States",
    type: "house"
  }
])

const results = Model.parseSearchResults(nominatim)
assert.strictEqual(results.length, 2)
assert.strictEqual(results[0].name, "White House")
assert.ok(results[0].description.indexOf("Washington") !== -1)
assert.strictEqual(results[1].name, "1600")
assert.deepStrictEqual(Model.parseSearchResults("not-json"), [])
assert.deepStrictEqual(Model.parseSearchResults("[]"), [])

assert.deepStrictEqual(Model.parseCoords("38.89, -77.03"), { lat: 38.89, lon: -77.03 })
assert.deepStrictEqual(Model.parseCoords("-122.4, 38.89"), { lat: 38.89, lon: -122.4 })
assert.strictEqual(Model.parseCoords("hello"), null)

const coords = Model.coordsPlace(1.5, 2.5)
assert.strictEqual(coords.type, "coordinates")
assert.ok(coords.name.indexOf("1.50000") !== -1)

assert.deepStrictEqual(
  Model.parseLocationFile('{"name":"Austin","latitude":30.27,"longitude":-97.74}'),
  { name: "Austin", description: "Weather location", lat: 30.27, lon: -97.74, type: "current" }
)
assert.strictEqual(Model.parseLocationFile("{}"), null)

const ip = Model.parseIpLocation(JSON.stringify({
  success: true,
  latitude: 30.27,
  longitude: -97.74,
  city: "Austin",
  region: "Texas",
  country: "United States"
}))
assert.strictEqual(ip.name, "Austin, Texas, United States")
assert.strictEqual(Model.parseIpLocation('{"success":false}'), null)

assert.ok(Model.searchUrl("white house", 5).indexOf("nominatim.openstreetmap.org/search") !== -1)
assert.ok(Model.searchUrl("a b").indexOf("a%20b") !== -1)
assert.strictEqual(Model.userAgent().indexOf("QuickMap/1.0"), 0)

const from = { lat: 38.8977, lon: -77.0365 }
const to = { lat: 38.8899, lon: -77.0091 }
assert.ok(Model.routeUrl("drive", from, to).indexOf("/route/v1/driving/") !== -1)
assert.ok(Model.routeUrl("walk", from, to).indexOf("/route/v1/foot/") !== -1)

const osrm = {
  code: "Ok",
  routes: [{
    distance: 3416.4,
    duration: 374.9,
    geometry: { coordinates: [[-77.0365, 38.8977], [-77.02, 38.89], [-77.0091, 38.8899]] },
    legs: [{
      steps: [
        { name: "Pennsylvania Avenue", distance: 100, duration: 20, maneuver: { type: "depart", modifier: "left" } },
        { name: "15th Street", distance: 200, duration: 40, maneuver: { type: "turn", modifier: "right" } },
        { name: "", distance: 0, duration: 0, maneuver: { type: "arrive" } }
      ]
    }]
  }]
}
const route = Model.parseRoute(JSON.stringify(osrm))
assert.strictEqual(route.distance, 3416.4)
assert.strictEqual(route.steps.length, 3)
assert.strictEqual(route.steps[0].instruction, "Head onto Pennsylvania Avenue")
assert.strictEqual(route.steps[1].instruction, "Turn right onto 15th Street")
assert.strictEqual(route.steps[2].instruction, "Arrive")
assert.strictEqual(Model.parseRoute('{"code":"NoRoute"}'), null)

assert.strictEqual(Model.formatDistance(250, false), "250 m")
assert.strictEqual(Model.formatDistance(2500, false), "2.5 km")
assert.strictEqual(Model.formatDistance(80, true), "262 ft")
assert.strictEqual(Model.formatDuration(45), "45s")
assert.strictEqual(Model.formatDuration(140), "2 min")
assert.strictEqual(Model.formatDuration(3800), "1 h 3 min")
assert.strictEqual(Model.formatSummary(route, false), "3.4 km · 6 min")

assert.ok(Model.useImperial("en_US"))
assert.ok(!Model.useImperial("en_GB"))

const placeUrl = Model.osmPlaceUrl(38.9, -77.0)
assert.ok(placeUrl.indexOf("mlat=38.9") !== -1)
const dirUrl = Model.osmDirectionsUrl(from, to, "walk")
assert.ok(dirUrl.indexOf("fossgis_osrm_foot") !== -1)
assert.ok(Model.openUrl(null, from, to, "drive").indexOf("fossgis_osrm_car") !== -1)

assert.strictEqual(Model.webMercatorX(-180, 1), 0)
assert.strictEqual(Model.webMercatorX(180, 1), 2)
assert.ok(Math.abs(Model.webMercatorX(0, 1) - 1) < 1e-9)
assert.ok(Math.abs(Model.webMercatorY(0, 1) - 1) < 1e-9)

const line = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]
assert.strictEqual(Model.downsampleLine(line, 3).length, 3)
assert.deepStrictEqual(Model.downsampleLine(line, 3)[2], [4, 4])

const view = Model.fitView([{ lat: 0, lon: 0 }])
assert.strictEqual(view.cols, 2)
assert.strictEqual(view.rows, 1)
assert.ok(view.tiles.length >= 2)
assert.strictEqual(view.zoom, 15)
const centered = Model.projectOnView(0, 0, view, 200, 100)
assert.ok(Math.abs(centered.x - 100) < 1)
assert.ok(Math.abs(centered.y - 50) < 1)

const wide = Model.fitView([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }])
assert.ok(wide.zoom < 15)

const script = Model.tileFetchScript("/tmp/quickmap-tiles", view.tiles)
assert.ok(script.indexOf("mkdir -p '/tmp/quickmap-tiles'") !== -1)
assert.ok(script.indexOf("tile.openstreetmap.org/") !== -1)
assert.ok(script.indexOf("curl -fsS") !== -1)
assert.ok(script.indexOf("-ge 2") !== -1)

const halo = Model.neighborTiles(view, 1)
assert.ok(halo.length > view.tiles.length)
const parents = Model.parentTiles(view.tiles)
assert.ok(parents.length > 0)
assert.strictEqual(parents[0].z, view.zoom - 1)
const children = Model.childTiles(view.tiles)
assert.strictEqual(children.length, view.tiles.length * 4)
assert.strictEqual(children[0].z, view.zoom + 1)
const pre = Model.prefetchTiles(view, 40)
assert.ok(pre.length >= view.tiles.length)
assert.ok(pre.length <= 40)
assert.strictEqual(pre[0].z, view.tiles[0].z)
assert.strictEqual(pre[0].x, view.tiles[0].x)
assert.deepStrictEqual(Model.uniqueTiles([{ z: 5, x: 1, y: 1 }, { z: 5, x: 1, y: 1 }]).length, 1)

const markers = Model.markersFor("drive", null, from, to)
assert.strictEqual(markers.length, 2)
assert.strictEqual(markers[0].role, "from")
assert.strictEqual(Model.markersFor("lookup", { lat: 1, lon: 2 }, null, null)[0].role, "to")

assert.strictEqual(Model.moveSuggestion(0, 1, 3), 1)
assert.strictEqual(Model.moveSuggestion(2, 1, 3), 2)
assert.strictEqual(Model.moveSuggestion(0, -1, 3), 0)

const curl = Model.curlCommand("https://example.com")
assert.deepStrictEqual(curl.slice(0, 3), ["curl", "-fsS", "--max-time"])
assert.strictEqual(curl[curl.length - 1], "https://example.com")

const text = Model.formatDirectionsText(route, from, to, "drive", false)
assert.ok(text.indexOf("Driving directions") !== -1)
assert.ok(text.indexOf("1. Head onto Pennsylvania Avenue") !== -1)
assert.ok(text.indexOf("OpenStreetMap") !== -1)
assert.strictEqual(Model.escapeHtml('A <B> & "C"'), "A &lt;B&gt; &amp; &quot;C&quot;")
const html = Model.formatDirectionsHtml(route, from, to, "walk", false)
assert.ok(html.indexOf("<ol>") !== -1)
assert.ok(html.indexOf("Walking") !== -1)
const printCmd = Model.printCommand("/tmp/a.txt", "hi")
assert.strictEqual(printCmd[0], "python3")
assert.strictEqual(printCmd[3], "/tmp/a.txt")
assert.ok(printCmd[2].indexOf("xdg-open") === -1)
assert.ok(printCmd[2].indexOf("NO_PRINTER") !== -1)

const off = Model.offlineTiles(view, 2, 2, 200)
assert.ok(off.length > view.tiles.length)
assert.ok(off.length <= 200)
assert.ok(off.some(function(t) { return t.z === view.zoom + 1 }))
assert.ok(off.some(function(t) { return t.z === view.zoom }))

const zoomed = Model.zoomView(view, 1, 100, 50, 200, 100)
assert.strictEqual(zoomed.zoom, view.zoom + 1)
const stillCentered = Model.projectOnView(0, 0, zoomed, 200, 100)
assert.ok(Math.abs(stillCentered.x - 100) < 2)
assert.ok(Math.abs(stillCentered.y - 50) < 2)
const panned = Model.panView(view, 50, 0, 200, 100)
const afterPan = Model.projectOnView(0, 0, panned, 200, 100)
assert.ok(afterPan.x > 100)

console.log("ok")
