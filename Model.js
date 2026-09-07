// Nominatim search, OSRM routes, and Web Mercator tiles for QuickMap.
// Qt-free so it can be unit tested under node.

var USER_AGENT = "QuickMap/1.0 (io.github.cfaulkingham.quickmap; colin.faulkingham@gmail.com)"
var ANON_USER_AGENT = "QuickMap/1.0 (io.github.cfaulkingham.quickmap)"
var TILE_SIZE = 256
var MAX_TILE_COLS = 2
var MAX_TILE_ROWS = 1
var MODAL_TILE_COLS = 4
var MODAL_TILE_ROWS = 3
var MAX_VIEW_COLS = 12
var MAX_VIEW_ROWS = 8
var MIN_ZOOM = 2
var MAX_ZOOM = 18
var MAX_VIAS = 8
var MAX_ROUTE_POINTS = MAX_VIAS + 2
var ROUTE_HIT_PX = 14
var VIA_HIT_PX = 16
var HTTP_TIMEOUT_SEC = 8
var MAX_SEARCH_BYTES = 64 * 1024
var MAX_ROUTE_BYTES = 256 * 1024
var MAX_LOCATION_BYTES = 16 * 1024
var MAX_TILE_BYTES = 256 * 1024
var MAX_SEARCH_RESULTS = 8
var MAX_ROUTE_STEPS = 200
var MAX_ROUTE_COORDS = 2000
var MAX_NAME_CHARS = 200
var MAX_DESCRIPTION_CHARS = 300
var MAX_INSTRUCTION_CHARS = 200
var MAX_QUERY_CHARS = 200
var MAX_HELPER_STDOUT = MAX_ROUTE_BYTES
var TILE_BASE_URL = "https://tile.openstreetmap.org"
var OSM_OPEN_PREFIX = "https://www.openstreetmap.org/"
var OSRM_DRIVE_PREFIX = "https://router.project-osrm.org/route/v1/driving"
var OSRM_WALK_PREFIX = "https://routing.openstreetmap.de/routed-foot/route/v1/foot"
var HELPER_NAME = "quickmap-helper.py"

function userAgent() {
  return USER_AGENT
}

function anonUserAgent() {
  return ANON_USER_AGENT
}

function maxSearchBytes() {
  return MAX_SEARCH_BYTES
}

function maxRouteBytes() {
  return MAX_ROUTE_BYTES
}

function maxLocationBytes() {
  return MAX_LOCATION_BYTES
}

function maxTileBytes() {
  return MAX_TILE_BYTES
}

function maxQueryChars() {
  return MAX_QUERY_CHARS
}

function maxHelperStdout() {
  return MAX_HELPER_STDOUT
}

function maxSearchResults() {
  return MAX_SEARCH_RESULTS
}

function maxRouteSteps() {
  return MAX_ROUTE_STEPS
}

function maxVias() {
  return MAX_VIAS
}

function maxRoutePoints() {
  return MAX_ROUTE_POINTS
}

function routeHitPx() {
  return ROUTE_HIT_PX
}

function viaHitPx() {
  return VIA_HIT_PX
}

function httpTimeoutSec() {
  return HTTP_TIMEOUT_SEC
}

function tileSize() {
  return TILE_SIZE
}

function oversizeText(raw, maxBytes) {
  return String(raw == null ? "" : raw).length > maxBytes
}

function plain(text, maxLen) {
  var limit = parseInt(maxLen, 10)
  if (!isFinite(limit) || limit < 1) limit = MAX_NAME_CHARS
  var s = String(text == null ? "" : text)
  s = s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
  s = s.replace(/&/g, "").replace(/</g, "").replace(/>/g, "")
  if (s.length > limit) s = s.slice(0, limit)
  return s
}

function shouldFetchIpLocation(mode, hasLocation, weatherResolved, usingCurrentOrigin, ipOptIn) {
  if (!ipOptIn || hasLocation || !weatherResolved || !usingCurrentOrigin) return false
  return mode === "drive" || mode === "walk"
}

function trim(text) {
  return String(text == null ? "" : text).replace(/^\s+|\s+$/g, "")
}

function clamp(n, lo, hi) {
  n = Number(n)
  if (!isFinite(n)) return lo
  if (n < lo) return lo
  if (n > hi) return hi
  return n
}

function parseCoords(text) {
  var m = trim(text).match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  var a = Number(m[1])
  var b = Number(m[2])
  if (!isFinite(a) || !isFinite(b)) return null
  if (Math.abs(a) > 90 && Math.abs(a) <= 180 && Math.abs(b) <= 90)
    return { lat: b, lon: a }
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b }
  return null
}

function searchUrl(query, limit) {
  var q = encodeURIComponent(trim(query).slice(0, MAX_QUERY_CHARS))
  var n = parseInt(limit, 10)
  if (!isFinite(n) || n < 1) n = 5
  if (n > MAX_SEARCH_RESULTS) n = MAX_SEARCH_RESULTS
  return "https://nominatim.openstreetmap.org/search?q=" + q
    + "&format=jsonv2&limit=" + n
}

function placeName(row) {
  if (!row) return "Place"
  if (row.name) return plain(row.name, MAX_NAME_CHARS) || "Place"
  var display = plain(row.display_name || "", MAX_DESCRIPTION_CHARS)
  var comma = display.indexOf(",")
  return comma > 0 ? trim(display.slice(0, comma)) : (display || "Place")
}

function placeDescription(row) {
  if (!row) return ""
  var name = placeName(row)
  var display = plain(row.display_name || "", MAX_DESCRIPTION_CHARS)
  if (display.indexOf(name) === 0)
    display = trim(display.slice(name.length).replace(/^,/, ""))
  return plain(display, MAX_DESCRIPTION_CHARS)
}

function parseSearchResults(raw) {
  if (oversizeText(raw, MAX_SEARCH_BYTES)) return []
  try {
    var data = JSON.parse(String(raw || "[]"))
    if (!data || typeof data.length !== "number") return []
    if (data.length < 1) return []
    if (data.length > MAX_SEARCH_RESULTS) return []
    var out = []
    for (var i = 0; i < data.length; i++) {
      var row = data[i]
      if (!row) continue
      var lat = parseFloat(row.lat)
      var lon = parseFloat(row.lon)
      if (!isFinite(lat) || !isFinite(lon)) continue
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
      out.push({
        name: placeName(row),
        description: placeDescription(row),
        lat: lat,
        lon: lon,
        type: plain(row.type || row.addresstype || "", 32)
      })
    }
    return out
  } catch (e) {
    return []
  }
}

function coordsPlace(lat, lon) {
  lat = Number(lat)
  lon = Number(lon)
  if (!isFinite(lat) || !isFinite(lon)) return null
  var name = lat.toFixed(5) + ", " + lon.toFixed(5)
  return { name: name, description: "Coordinates", lat: lat, lon: lon, type: "coordinates" }
}

function parseLocationFile(raw) {
  if (oversizeText(raw, MAX_LOCATION_BYTES)) return null
  try {
    var data = JSON.parse(String(raw || ""))
    if (!data || typeof data !== "object") return null
    var lat = parseFloat(data.latitude)
    var lon = parseFloat(data.longitude)
    if (!isFinite(lat) || !isFinite(lon)) return null
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
    return {
      name: plain(trim(data.name) || "Current location", MAX_NAME_CHARS),
      description: "Weather location",
      lat: lat,
      lon: lon,
      type: "weather"
    }
  } catch (e) {
    return null
  }
}

function parseIpLocation(raw) {
  if (oversizeText(raw, MAX_LOCATION_BYTES)) return null
  try {
    var data = JSON.parse(String(raw || "{}"))
    if (!data || data.success === false) return null
    var lat = parseFloat(data.latitude)
    var lon = parseFloat(data.longitude)
    if (!isFinite(lat) || !isFinite(lon)) return null
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
    var parts = [data.city, data.region, data.country]
    var name = []
    for (var i = 0; i < parts.length; i++) {
      var piece = plain(parts[i], 80)
      if (piece) name.push(piece)
    }
    return {
      name: name.length ? name.join(", ").slice(0, MAX_NAME_CHARS) : "Current location",
      description: "Estimated from IP",
      lat: lat,
      lon: lon,
      type: "ip"
    }
  } catch (e) {
    return null
  }
}

function routeProfile(mode) {
  return mode === "walk" ? "foot" : "driving"
}

function routeServiceUrl(mode) {
  return mode === "walk" ? OSRM_WALK_PREFIX : OSRM_DRIVE_PREFIX
}

function validCoord(point) {
  if (!point) return false
  var lat = Number(point.lat)
  var lon = Number(point.lon)
  return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

function sanitizeVias(vias) {
  var out = []
  vias = vias || []
  for (var i = 0; i < vias.length && out.length < MAX_VIAS; i++) {
    var v = vias[i]
    if (!validCoord(v)) continue
    out.push({ lat: Number(v.lat), lon: Number(v.lon) })
  }
  return out
}

function routePoints(from, to, vias) {
  var pts = []
  if (validCoord(from)) pts.push({ lat: Number(from.lat), lon: Number(from.lon) })
  var stops = sanitizeVias(vias)
  for (var i = 0; i < stops.length; i++) pts.push(stops[i])
  if (validCoord(to)) pts.push({ lat: Number(to.lat), lon: Number(to.lon) })
  return pts
}

function routeUrl(mode, from, to, vias) {
  var pts = routePoints(from, to, vias)
  if (pts.length < 2) return ""
  var parts = []
  for (var i = 0; i < pts.length; i++)
    parts.push(Number(pts[i].lon) + "," + Number(pts[i].lat))
  return routeServiceUrl(mode)
    + "/" + parts.join(";") + "?overview=simplified&geometries=geojson&steps=true"
}

function helperRouteArgs(mode, from, to, vias) {
  var pts = routePoints(from, to, vias)
  if (pts.length < 2) return []
  var args = [String(mode)]
  for (var i = 0; i < pts.length; i++) {
    args.push(String(pts[i].lat))
    args.push(String(pts[i].lon))
  }
  return args
}

function capitalize(text) {
  text = String(text || "")
  if (!text) return ""
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatManeuver(step) {
  step = step || {}
  var m = step.maneuver || {}
  var type = plain(m.type || "", 40)
  var modifier = plain(m.modifier || "", 40)
  var name = plain(trim(step.name), MAX_NAME_CHARS)
  var onto = name ? " onto " + name : ""

  if (type === "depart") return name ? "Head onto " + name : "Depart"
  if (type === "arrive") return name ? "Arrive at " + name : "Arrive"
  if (type === "roundabout" || type === "rotary")
    return "Enter the roundabout" + onto
  if (type === "exit roundabout" || type === "exit rotary")
    return "Exit the roundabout" + onto
  if (type === "merge") return "Merge" + onto
  if (type === "fork") return (modifier ? "Keep " + modifier : "Keep going") + onto
  if (type === "end of road") return (modifier ? "Turn " + modifier : "Turn") + onto
  if (type === "continue" || type === "new name")
    return name ? "Continue on " + name : "Continue"
  if (type === "notification") return name ? "Continue on " + name : "Continue"

  var turn = ""
  if (modifier === "straight") turn = "Continue straight"
  else if (modifier === "uturn") turn = "Make a U-turn"
  else if (modifier) turn = "Turn " + modifier
  else if (type) turn = capitalize(type)
  else turn = "Continue"

  if (type === "ramp" || type === "on ramp") turn = "Take the ramp"
  if (type === "off ramp") turn = "Take the off-ramp"
  return plain(turn + onto, MAX_INSTRUCTION_CHARS)
}

function parseRoute(raw) {
  if (oversizeText(raw, MAX_ROUTE_BYTES)) return null
  try {
    var data = JSON.parse(String(raw || "{}"))
    if (!data || data.code !== "Ok" || !data.routes || !data.routes[0]) return null
    var route = data.routes[0]
    var steps = []
    var legs = route.legs || []
    if (legs.length > MAX_VIAS + 1) return null
    for (var i = 0; i < legs.length; i++) {
      var list = legs[i].steps || []
      if (list.length > MAX_ROUTE_STEPS) return null
      for (var j = 0; j < list.length; j++) {
        if (steps.length >= MAX_ROUTE_STEPS) return null
        var step = list[j] || {}
        var dist = Number(step.distance)
        var dur = Number(step.duration)
        if (!isFinite(dist) || dist < 0) dist = 0
        if (!isFinite(dur) || dur < 0) dur = 0
        steps.push({
          instruction: formatManeuver(step),
          distance: dist,
          duration: dur,
          name: plain(trim(step.name), MAX_NAME_CHARS)
        })
      }
    }
    var geom = route.geometry && route.geometry.coordinates ? route.geometry.coordinates : []
    if (geom.length > MAX_ROUTE_COORDS) return null
    var coords = []
    for (var k = 0; k < geom.length; k++) {
      var c = geom[k]
      if (!c || c.length < 2) continue
      var lon = Number(c[0])
      var lat = Number(c[1])
      if (!isFinite(lat) || !isFinite(lon)) continue
      coords.push([lon, lat])
    }
    var distance = Number(route.distance)
    var duration = Number(route.duration)
    if (!isFinite(distance) || distance < 0) distance = 0
    if (!isFinite(duration) || duration < 0) duration = 0
    var waypoints = []
    var wps = data.waypoints || []
    if (wps.length > MAX_ROUTE_POINTS) return null
    for (var w = 0; w < wps.length; w++) {
      var loc = wps[w] && wps[w].location ? wps[w].location : null
      if (!loc || loc.length < 2) continue
      var wlon = Number(loc[0])
      var wlat = Number(loc[1])
      if (!isFinite(wlat) || !isFinite(wlon)) continue
      if (Math.abs(wlat) > 90 || Math.abs(wlon) > 180) continue
      waypoints.push({ lat: wlat, lon: wlon })
    }
    return {
      distance: distance,
      duration: duration,
      coordinates: coords,
      steps: steps,
      waypoints: waypoints
    }
  } catch (e) {
    return null
  }
}

function useImperial(localeName) {
  var name = String(localeName || "").replace(".", "_")
  return /^en[_-]US($|[_.-])/i.test(name)
    || /^en[_-]LR($|[_.-])/i.test(name)
    || /^my($|[_.-])/i.test(name)
}

function formatDistance(meters, imperial) {
  var m = Number(meters)
  if (!isFinite(m) || m < 0) return ""
  if (imperial) {
    var feet = m * 3.28084
    if (feet < 528) return Math.round(feet) + " ft"
    var miles = m / 1609.344
    return (miles < 10 ? miles.toFixed(1) : String(Math.round(miles))) + " mi"
  }
  if (m < 1000) return Math.round(m) + " m"
  var km = m / 1000
  return (km < 10 ? km.toFixed(1) : String(Math.round(km))) + " km"
}

function formatDuration(seconds) {
  var s = Math.round(Number(seconds))
  if (!isFinite(s) || s < 0) return ""
  if (s < 60) return s + "s"
  var minutes = Math.round(s / 60)
  if (minutes < 60) return minutes + " min"
  var hours = Math.floor(minutes / 60)
  var rest = minutes % 60
  return rest ? hours + " h " + rest + " min" : hours + " h"
}

function formatSummary(route, imperial) {
  if (!route) return ""
  var dist = formatDistance(route.distance, imperial)
  var dur = formatDuration(route.duration)
  if (dist && dur) return dist + " · " + dur
  return dist || dur
}

function modeLabel(mode) {
  if (mode === "walk") return "Walking"
  if (mode === "drive") return "Driving"
  return "Place"
}

function directionsTitle(origin, dest, place, mode) {
  if (mode === "drive" || mode === "walk") {
    var fromName = origin && origin.name ? plain(origin.name, MAX_NAME_CHARS) : "Start"
    var toName = dest && dest.name ? plain(dest.name, MAX_NAME_CHARS) : "Destination"
    return fromName + " → " + toName
  }
  return place && place.name ? plain(place.name, MAX_NAME_CHARS) : "Map"
}

function formatDirectionsText(route, origin, dest, mode, imperial) {
  var lines = []
  lines.push(modeLabel(mode) + " directions")
  lines.push(directionsTitle(origin, dest, null, mode))
  var summary = formatSummary(route, imperial)
  if (summary) lines.push(summary)
  lines.push("")
  var steps = route && route.steps ? route.steps : []
  var n = Math.min(steps.length, MAX_ROUTE_STEPS)
  for (var i = 0; i < n; i++) {
    var dist = steps[i].distance > 0 ? " (" + formatDistance(steps[i].distance, imperial) + ")" : ""
    lines.push((i + 1) + ". " + plain(steps[i].instruction, MAX_INSTRUCTION_CHARS) + dist)
  }
  lines.push("")
  lines.push("© OpenStreetMap contributors")
  return lines.join("\n")
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function formatDirectionsHtml(route, origin, dest, mode, imperial) {
  var title = escapeHtml(directionsTitle(origin, dest, null, mode))
  var heading = escapeHtml(modeLabel(mode) + " directions")
  var summary = escapeHtml(formatSummary(route, imperial))
  var items = []
  var steps = route && route.steps ? route.steps : []
  var n = Math.min(steps.length, MAX_ROUTE_STEPS)
  for (var i = 0; i < n; i++) {
    var dist = steps[i].distance > 0
      ? " <span>" + escapeHtml(formatDistance(steps[i].distance, imperial)) + "</span>"
      : ""
    items.push("<li>" + escapeHtml(plain(steps[i].instruction, MAX_INSTRUCTION_CHARS)) + dist + "</li>")
  }
  return "<!doctype html><html><head><meta charset=\"utf-8\"><title>"
    + heading + "</title><style>"
    + "body{font:14px/1.45 sans-serif;margin:24px;color:#111}"
    + "h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#444}"
    + "ol{padding-left:22px}li{margin:0 0 8px}li span{color:#666}"
    + "@media print{body{margin:12px}}"
    + "</style></head><body><h1>" + heading + "</h1><p>" + title
    + (summary ? "<br>" + summary : "") + "</p><ol>" + items.join("")
    + "</ol><p>© OpenStreetMap contributors</p></body></html>"
}

function osmPlaceUrl(lat, lon) {
  lat = Number(lat)
  lon = Number(lon)
  if (!isFinite(lat) || !isFinite(lon)) return ""
  return "https://www.openstreetmap.org/?mlat=" + lat + "&mlon=" + lon
    + "#map=16/" + lat + "/" + lon
}

function osmDirectionsUrl(from, to, mode, vias) {
  var pts = routePoints(from, to, vias)
  if (pts.length < 2) return ""
  var engine = mode === "walk" ? "fossgis_osrm_foot" : "fossgis_osrm_car"
  var parts = []
  for (var i = 0; i < pts.length; i++)
    parts.push(Number(pts[i].lat) + "," + Number(pts[i].lon))
  return "https://www.openstreetmap.org/directions?engine=" + engine
    + "&route=" + parts.join(";")
}

function isSafeOsmUrl(url) {
  url = String(url || "")
  if (url.length < OSM_OPEN_PREFIX.length || url.length > 768) return false
  if (/[\u0000-\u001F\u007F\\]/.test(url)) return false
  if (url.indexOf("@") !== -1) return false
  if (url.indexOf(OSM_OPEN_PREFIX) !== 0) return false
  if (url.toLowerCase().indexOf("%2f%2f") !== -1) return false
  return true
}

function openUrl(place, origin, dest, mode, vias) {
  var url = ""
  if (mode === "drive" || mode === "walk") {
    if (origin && dest) url = osmDirectionsUrl(origin, dest, mode, vias)
  }
  if (!url && place) url = osmPlaceUrl(place.lat, place.lon)
  if (!url && dest) url = osmPlaceUrl(dest.lat, dest.lon)
  return isSafeOsmUrl(url) ? url : ""
}

function helperPath(pluginDir) {
  var dir = String(pluginDir || "")
  if (!dir || dir.indexOf("\x00") >= 0) return ""
  var parts = dir.split("/")
  for (var i = 0; i < parts.length; i++) if (parts[i] === "..") return ""
  if (parts[parts.length - 1] === "") parts.pop()
  return parts.join("/") + "/bin/" + HELPER_NAME
}

function helperCommand(pluginDir, verb, args) {
  var path = helperPath(pluginDir)
  if (!path) return []
  if (!/^[a-z]{1,16}$/.test(String(verb || ""))) return []
  var cmd = ["/usr/bin/python3", "-I", "-S", path, String(verb)]
  if (args && args.length) {
    cmd.push("--")
    for (var i = 0; i < args.length; i++) cmd.push(String(args[i]))
  }
  return cmd
}

function cacheDirPath(home, xdgCache) {
  home = String(home || "")
  xdgCache = String(xdgCache || "")
  if (home && xdgCache && xdgCache.indexOf(home + "/") === 0) return xdgCache + "/quickmap/tiles"
  return home + "/.cache/quickmap/tiles"
}

function tileFileName(tile) {
  if (!tile) return ""
  var z = Number(tile.z) | 0
  var x = Number(tile.x) | 0
  var y = Number(tile.y) | 0
  if (z < MIN_ZOOM || z > MAX_ZOOM || x < 0 || y < 0) return ""
  return z + "-" + x + "-" + y + ".png"
}

function tilesJson(tiles) {
  return JSON.stringify(uniqueTiles(tiles))
}

function webMercatorX(lon, zoom) {
  return (Number(lon) + 180) / 360 * Math.pow(2, zoom)
}

function webMercatorY(lat, zoom) {
  var s = Math.sin(clamp(Number(lat), -85.0511, 85.0511) * Math.PI / 180)
  s = clamp(s, -0.9999, 0.9999)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, zoom)
}

function downsampleLine(coords, maxPoints) {
  coords = coords || []
  var max = parseInt(maxPoints, 10)
  if (!isFinite(max) || max < 2) max = 80
  if (coords.length <= max) return coords.slice()
  var out = []
  var step = (coords.length - 1) / (max - 1)
  for (var i = 0; i < max; i++)
    out.push(coords[Math.round(i * step)])
  return out
}

function emptyView() {
  return { zoom: 0, tileX: 0, tileY: 0, minTx: 0, minTy: 0, cols: 0, rows: 0, tiles: [] }
}

function pointsFrom(place, origin, dest, route) {
  var points = []
  function add(p) {
    if (!p || !isFinite(Number(p.lat)) || !isFinite(Number(p.lon))) return
    points.push({ lat: Number(p.lat), lon: Number(p.lon) })
  }
  add(place)
  add(origin)
  add(dest)
  var coords = route && route.coordinates ? route.coordinates : []
  var sample = downsampleLine(coords, 12)
  for (var i = 0; i < sample.length; i++) {
    var c = sample[i]
    if (c && c.length >= 2) points.push({ lat: Number(c[1]), lon: Number(c[0]) })
  }
  return points
}

function clampViewSize(cols, rows) {
  cols = Number(cols)
  rows = Number(rows)
  if (!isFinite(cols) || cols < 1) cols = MAX_TILE_COLS
  if (!isFinite(rows) || rows < 1) rows = MAX_TILE_ROWS
  if (cols > MAX_VIEW_COLS) cols = MAX_VIEW_COLS
  if (rows > MAX_VIEW_ROWS) rows = MAX_VIEW_ROWS
  return { cols: cols, rows: rows }
}

function viewSizeForPixels(width, height, maxTiles) {
  width = Number(width)
  height = Number(height)
  maxTiles = parseInt(maxTiles, 10)
  if (!isFinite(maxTiles) || maxTiles < 4) maxTiles = 12
  if (!isFinite(width) || width < 1 || !isFinite(height) || height < 1)
    return { cols: MAX_TILE_COLS, rows: MAX_TILE_ROWS }

  var cols = width / TILE_SIZE
  var rows = height / TILE_SIZE
  var area = cols * rows
  if (area > maxTiles) {
    var s = Math.sqrt(maxTiles / area)
    cols *= s
    rows *= s
  }
  if (cols < 1) {
    rows = rows / cols
    cols = 1
  }
  if (rows < 1) {
    cols = cols / rows
    rows = 1
  }
  return clampViewSize(cols, rows)
}

function resizeView(view, cols, rows) {
  if (!view || !view.cols || !view.rows) return emptyView()
  var size = clampViewSize(cols, rows)
  var cx = view.tileX + view.cols / 2
  var cy = view.tileY + view.rows / 2
  return viewAt(view.zoom, cx - size.cols / 2, cy - size.rows / 2, size.cols, size.rows)
}

function fitView(points, maxCols, maxRows) {
  points = points || []
  var size = clampViewSize(maxCols, maxRows)
  maxCols = size.cols
  maxRows = size.rows
  if (!points.length) return emptyView()

  var minLat = 90, maxLat = -90, minLon = 180, maxLon = -180
  for (var i = 0; i < points.length; i++) {
    var p = points[i]
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
  }

  var padLat = Math.max(0.0004, (maxLat - minLat) * 0.18)
  var padLon = Math.max(0.0004, (maxLon - minLon) * 0.18)
  minLat -= padLat
  maxLat += padLat
  minLon -= padLon
  maxLon += padLon

  var zoom = 15
  if (points.length > 1) {
    for (zoom = 16; zoom >= 2; zoom--) {
      var w = Math.abs(webMercatorX(maxLon, zoom) - webMercatorX(minLon, zoom))
      var h = Math.abs(webMercatorY(minLat, zoom) - webMercatorY(maxLat, zoom))
      if (w <= maxCols - 0.15 && h <= maxRows - 0.15) break
    }
  }

  var cx = (webMercatorX(minLon, zoom) + webMercatorX(maxLon, zoom)) / 2
  var cy = (webMercatorY(minLat, zoom) + webMercatorY(maxLat, zoom)) / 2
  return viewAt(zoom, cx - maxCols / 2, cy - maxRows / 2, maxCols, maxRows)
}

function viewAt(zoom, originX, originY, cols, rows) {
  zoom = Math.round(Number(zoom))
  if (!isFinite(zoom)) zoom = 15
  zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
  var size = clampViewSize(cols, rows)
  cols = size.cols
  rows = size.rows

  var n = Math.pow(2, zoom)
  originX = Number(originX)
  originY = Number(originY)
  if (!isFinite(originX)) originX = 0
  if (!isFinite(originY)) originY = 0
  originX = ((originX % n) + n) % n
  if (originY < 0) originY = 0
  if (originY + rows > n) originY = Math.max(0, n - rows)

  var minTx = Math.floor(originX)
  var minTy = Math.floor(originY)
  var tileCols = Math.max(1, Math.ceil(originX + cols - minTx - 1e-9))
  var tileRows = Math.max(1, Math.ceil(originY + rows - minTy - 1e-9))

  var tiles = []
  for (var row = 0; row < tileRows; row++) {
    for (var col = 0; col < tileCols; col++) {
      var x = (minTx + col) % n
      var y = minTy + row
      if (y < 0 || y >= n) continue
      tiles.push({ z: zoom, x: x, y: y, col: col, row: row })
    }
  }

  return {
    zoom: zoom,
    tileX: originX,
    tileY: originY,
    minTx: minTx,
    minTy: minTy,
    cols: cols,
    rows: rows,
    tiles: tiles
  }
}

function panView(view, dxPx, dyPx, width, height) {
  if (!view || !view.cols || !view.rows) return emptyView()
  width = Number(width)
  height = Number(height)
  if (!width || !height) return view
  return viewAt(
    view.zoom,
    view.tileX - Number(dxPx) / width * view.cols,
    view.tileY - Number(dyPx) / height * view.rows,
    view.cols,
    view.rows
  )
}

function zoomView(view, delta, ax, ay, width, height) {
  if (!view || !view.cols || !view.rows) return emptyView()
  width = Number(width)
  height = Number(height)
  if (!width || !height) return view
  var newZoom = clamp(view.zoom + Number(delta), MIN_ZOOM, MAX_ZOOM)
  if (newZoom === view.zoom) return view
  var fracX = clamp(Number(ax) / width, 0, 1)
  var fracY = clamp(Number(ay) / height, 0, 1)
  var worldX = view.tileX + fracX * view.cols
  var worldY = view.tileY + fracY * view.rows
  var scale = Math.pow(2, newZoom - view.zoom)
  return viewAt(
    newZoom,
    worldX * scale - fracX * view.cols,
    worldY * scale - fracY * view.rows,
    view.cols,
    view.rows
  )
}

function projectOnView(lat, lon, view, width, height) {
  if (!view || !view.cols || !view.rows) return { x: 0, y: 0 }
  var mx = webMercatorX(lon, view.zoom)
  var my = webMercatorY(lat, view.zoom)
  var dx = mx - view.tileX
  var n = Math.pow(2, view.zoom)
  if (dx < -n / 2) dx += n
  if (dx > n / 2) dx -= n
  return {
    x: dx / view.cols * width,
    y: (my - view.tileY) / view.rows * height
  }
}

function unprojectOnView(x, y, view, width, height) {
  if (!view || !view.cols || !view.rows) return { lat: 0, lon: 0 }
  width = Number(width)
  height = Number(height)
  if (!width || !height) return { lat: 0, lon: 0 }
  var n = Math.pow(2, view.zoom)
  var mx = view.tileX + Number(x) / width * view.cols
  var my = view.tileY + Number(y) / height * view.rows
  mx = ((mx % n) + n) % n
  if (my < 0) my = 0
  if (my > n) my = n
  var lon = mx / n * 360 - 180
  var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * my / n))) * 180 / Math.PI
  return {
    lat: clamp(lat, -85.0511, 85.0511),
    lon: clamp(lon, -180, 180)
  }
}

function distPointToSeg(px, py, ax, ay, bx, by) {
  var dx = bx - ax
  var dy = by - ay
  var len2 = dx * dx + dy * dy
  var t = 0
  if (len2 > 0) t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1)
  var x = ax + t * dx
  var y = ay + t * dy
  var ddx = px - x
  var ddy = py - y
  return { dist: Math.sqrt(ddx * ddx + ddy * ddy), t: t, x: x, y: y }
}

function nearestOnRoute(coords, view, width, height, px, py) {
  coords = coords || []
  if (coords.length < 2 || !view) return null
  var segs = []
  for (var i = 0; i < coords.length - 1; i++) {
    var c0 = coords[i]
    var c1 = coords[i + 1]
    if (!c0 || c0.length < 2 || !c1 || c1.length < 2) continue
    var a = projectOnView(c0[1], c0[0], view, width, height)
    var b = projectOnView(c1[1], c1[0], view, width, height)
    var len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y))
    segs.push({ a: a, b: b, len: len })
  }
  if (!segs.length) return null
  var best = null
  var bestDist = Infinity
  var walked = 0
  var bestAlong = 0
  for (var j = 0; j < segs.length; j++) {
    var s = segs[j]
    var hit = distPointToSeg(px, py, s.a.x, s.a.y, s.b.x, s.b.y)
    if (hit.dist < bestDist) {
      bestDist = hit.dist
      bestAlong = walked + hit.t * s.len
      best = hit
    }
    walked += s.len
  }
  if (!best) return null
  var geo = unprojectOnView(best.x, best.y, view, width, height)
  return {
    dist: bestDist,
    along: bestAlong,
    lat: geo.lat,
    lon: geo.lon,
    x: best.x,
    y: best.y
  }
}

function alongRoute(coords, view, width, height, lat, lon) {
  var p = projectOnView(lat, lon, view, width, height)
  var hit = nearestOnRoute(coords, view, width, height, p.x, p.y)
  return hit ? hit.along : 0
}

function viaInsertIndex(coords, vias, view, width, height, lat, lon) {
  vias = vias || []
  var dropAt = alongRoute(coords, view, width, height, lat, lon)
  var idx = 0
  for (var i = 0; i < vias.length; i++) {
    if (!validCoord(vias[i])) continue
    var at = alongRoute(coords, view, width, height, vias[i].lat, vias[i].lon)
    if (at < dropAt) idx = i + 1
  }
  return idx
}

function hitIndex(points, view, width, height, px, py, radius) {
  points = points || []
  radius = Number(radius)
  if (!isFinite(radius) || radius < 1) radius = VIA_HIT_PX
  var best = -1
  var bestDist = radius
  for (var i = 0; i < points.length; i++) {
    var p = points[i]
    if (!validCoord(p)) continue
    var q = projectOnView(p.lat, p.lon, view, width, height)
    var d = Math.sqrt((q.x - px) * (q.x - px) + (q.y - py) * (q.y - py))
    if (d <= bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

function snappedVias(route, viaCount) {
  viaCount = parseInt(viaCount, 10)
  if (!isFinite(viaCount) || viaCount < 1) return []
  if (!route || !route.waypoints || route.waypoints.length !== viaCount + 2) return []
  var out = []
  for (var i = 1; i < route.waypoints.length - 1; i++) {
    var p = route.waypoints[i]
    if (validCoord(p)) out.push({ lat: Number(p.lat), lon: Number(p.lon) })
  }
  return out.length === viaCount ? out : []
}

function tilePath(cacheDir, tile) {
  var name = tileFileName(tile)
  if (!name) return ""
  return String(cacheDir || "") + "/" + name
}

function tileUrl(tile, baseUrl) {
  var base = String(baseUrl || TILE_BASE_URL).replace(/\/+$/, "")
  return base + "/" + tile.z + "/" + tile.x + "/" + tile.y + ".png"
}

function wrapTileX(x, zoom) {
  var n = Math.pow(2, zoom)
  return ((Number(x) % n) + n) % n
}

function uniqueTiles(tiles) {
  var seen = Object.create(null)
  var out = []
  tiles = tiles || []
  for (var i = 0; i < tiles.length; i++) {
    var t = tiles[i]
    if (!t) continue
    var z = Number(t.z) | 0
    var x = Number(t.x) | 0
    var y = Number(t.y) | 0
    if (z < MIN_ZOOM || z > MAX_ZOOM || x < 0 || y < 0) continue
    var key = z + "/" + x + "/" + y
    if (seen[key]) continue
    seen[key] = true
    out.push({ z: z, x: x, y: y })
  }
  return out
}

function neighborTiles(view, pad) {
  if (!view || !view.cols || !view.rows) return []
  pad = parseInt(pad, 10)
  if (!isFinite(pad) || pad < 0) pad = 1
  var n = Math.pow(2, view.zoom)
  var minX = Math.floor(view.tileX) - pad
  var minY = Math.floor(view.tileY) - pad
  var maxX = Math.ceil(view.tileX + view.cols + 1e-9) + pad
  var maxY = Math.ceil(view.tileY + view.rows + 1e-9) + pad
  var tiles = []
  for (var y = minY; y < maxY; y++) {
    if (y < 0 || y >= n) continue
    for (var x = minX; x < maxX; x++)
      tiles.push({ z: view.zoom, x: wrapTileX(x, view.zoom), y: y })
  }
  return tiles
}

function parentTiles(tiles) {
  var out = []
  tiles = tiles || []
  for (var i = 0; i < tiles.length; i++) {
    var t = tiles[i]
    if (!t || t.z <= MIN_ZOOM) continue
    out.push({ z: t.z - 1, x: Math.floor(t.x / 2), y: Math.floor(t.y / 2) })
  }
  return out
}

function childTiles(tiles) {
  var out = []
  tiles = tiles || []
  for (var i = 0; i < tiles.length; i++) {
    var t = tiles[i]
    if (!t || t.z >= MAX_ZOOM) continue
    var x = t.x * 2
    var y = t.y * 2
    out.push({ z: t.z + 1, x: x, y: y })
    out.push({ z: t.z + 1, x: x + 1, y: y })
    out.push({ z: t.z + 1, x: x, y: y + 1 })
    out.push({ z: t.z + 1, x: x + 1, y: y + 1 })
  }
  return out
}

function offlineTiles(view, extraDown, extraUp, maxTiles) {
  if (!view || !view.cols || !view.rows) return []
  extraDown = parseInt(extraDown, 10)
  extraUp = parseInt(extraUp, 10)
  maxTiles = parseInt(maxTiles, 10)
  if (!isFinite(extraDown) || extraDown < 0) extraDown = 2
  if (!isFinite(extraUp) || extraUp < 0) extraUp = 2
  if (!isFinite(maxTiles) || maxTiles < 16) maxTiles = 220

  var z = view.zoom
  var out = []
  for (var z2 = z - extraDown; z2 <= z + extraUp; z2++) {
    if (z2 < MIN_ZOOM || z2 > MAX_ZOOM) continue
    var scale = Math.pow(2, z2 - z)
    var pad = z2 === z ? 2 : (z2 < z ? 1 : 0)
    var x0 = Math.floor(view.tileX * scale) - pad
    var y0 = Math.floor(view.tileY * scale) - pad
    var x1 = Math.ceil((view.tileX + view.cols) * scale) + pad
    var y1 = Math.ceil((view.tileY + view.rows) * scale) + pad
    var n = Math.pow(2, z2)
    for (var y = y0; y < y1; y++) {
      if (y < 0 || y >= n) continue
      for (var x = x0; x < x1; x++)
        out.push({ z: z2, x: wrapTileX(x, z2), y: y })
    }
  }
  return uniqueTiles(out).slice(0, maxTiles)
}

function prefetchTiles(view, maxTiles) {
  if (!view) return []
  maxTiles = parseInt(maxTiles, 10)
  if (!isFinite(maxTiles) || maxTiles < 8) maxTiles = 40
  var visible = view.tiles || []
  var all = uniqueTiles(visible
    .concat(neighborTiles(view, 1))
    .concat(parentTiles(visible))
    .concat(childTiles(visible)))
  if (all.length > maxTiles) all = all.slice(0, maxTiles)
  return all
}

function markersFor(mode, place, origin, dest) {
  var out = []
  if (mode === "drive" || mode === "walk") {
    if (origin) out.push({ lat: origin.lat, lon: origin.lon, role: "from" })
    if (dest) out.push({ lat: dest.lat, lon: dest.lon, role: "to" })
    return out
  }
  if (place) out.push({ lat: place.lat, lon: place.lon, role: "to" })
  return out
}

function moveSuggestion(index, delta, count) {
  if (!count) return 0
  var current = parseInt(index, 10)
  if (!isFinite(current) || current < 0) current = 0
  var next = current + Number(delta)
  if (next < 0) return 0
  if (next > count - 1) return count - 1
  return next
}

if (typeof module !== "undefined") {
  module.exports = {
    userAgent: userAgent,
    anonUserAgent: anonUserAgent,
    maxSearchBytes: maxSearchBytes,
    maxRouteBytes: maxRouteBytes,
    maxLocationBytes: maxLocationBytes,
    maxTileBytes: maxTileBytes,
    maxQueryChars: maxQueryChars,
    maxHelperStdout: maxHelperStdout,
    maxSearchResults: maxSearchResults,
    maxRouteSteps: maxRouteSteps,
    maxVias: maxVias,
    maxRoutePoints: maxRoutePoints,
    routeHitPx: routeHitPx,
    viaHitPx: viaHitPx,
    httpTimeoutSec: httpTimeoutSec,
    tileSize: tileSize,
    shouldFetchIpLocation: shouldFetchIpLocation,
    trim: trim,
    plain: plain,
    parseCoords: parseCoords,
    searchUrl: searchUrl,
    parseSearchResults: parseSearchResults,
    coordsPlace: coordsPlace,
    parseLocationFile: parseLocationFile,
    parseIpLocation: parseIpLocation,
    routeProfile: routeProfile,
    routeServiceUrl: routeServiceUrl,
    validCoord: validCoord,
    sanitizeVias: sanitizeVias,
    routePoints: routePoints,
    routeUrl: routeUrl,
    helperRouteArgs: helperRouteArgs,
    formatManeuver: formatManeuver,
    parseRoute: parseRoute,
    useImperial: useImperial,
    formatDistance: formatDistance,
    formatDuration: formatDuration,
    formatSummary: formatSummary,
    modeLabel: modeLabel,
    directionsTitle: directionsTitle,
    formatDirectionsText: formatDirectionsText,
    formatDirectionsHtml: formatDirectionsHtml,
    escapeHtml: escapeHtml,
    viewAt: viewAt,
    panView: panView,
    zoomView: zoomView,
    clampViewSize: clampViewSize,
    viewSizeForPixels: viewSizeForPixels,
    resizeView: resizeView,
    osmPlaceUrl: osmPlaceUrl,
    osmDirectionsUrl: osmDirectionsUrl,
    openUrl: openUrl,
    isSafeOsmUrl: isSafeOsmUrl,
    helperPath: helperPath,
    helperCommand: helperCommand,
    cacheDirPath: cacheDirPath,
    tileFileName: tileFileName,
    tilesJson: tilesJson,
    webMercatorX: webMercatorX,
    webMercatorY: webMercatorY,
    downsampleLine: downsampleLine,
    pointsFrom: pointsFrom,
    fitView: fitView,
    projectOnView: projectOnView,
    unprojectOnView: unprojectOnView,
    distPointToSeg: distPointToSeg,
    nearestOnRoute: nearestOnRoute,
    alongRoute: alongRoute,
    viaInsertIndex: viaInsertIndex,
    hitIndex: hitIndex,
    snappedVias: snappedVias,
    uniqueTiles: uniqueTiles,
    neighborTiles: neighborTiles,
    parentTiles: parentTiles,
    childTiles: childTiles,
    prefetchTiles: prefetchTiles,
    offlineTiles: offlineTiles,
    tileUrl: tileUrl,
    tilePath: tilePath,
    markersFor: markersFor,
    moveSuggestion: moveSuggestion,
    emptyView: emptyView
  }
}
