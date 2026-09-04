const assert = require("assert")
const http = require("http")
const fs = require("fs")
const os = require("os")
const path = require("path")
const zlib = require("zlib")
const { spawn, spawnSync } = require("child_process")
const Model = require("../Model.js")

function pngChunk(tag, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const type = Buffer.from(tag)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])) >>> 0)
  return Buffer.concat([len, type, data, crc])
}

function makePng(width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3)])
  const rows = []
  for (let y = 0; y < height; y++) rows.push(row)
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0))
  ])
}

function sendChunked(res, body, chunkSize) {
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Transfer-Encoding": "chunked"
  })
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const size = chunkSize || 512
  let offset = 0
  function write() {
    while (offset < buf.length) {
      const n = Math.min(size, buf.length - offset)
      const slice = buf.subarray(offset, offset + n)
      offset += n
      if (!res.write(slice)) {
        res.once("drain", write)
        return
      }
    }
    res.end()
  }
  write()
}

function runServer() {
  const pngOk = makePng(256, 256)
  const pngTiny = makePng(1, 1)
  const jsonOk = Buffer.from(JSON.stringify([{
    lat: "38.89",
    lon: "-77.03",
    name: "White House",
    display_name: "White House, Washington, DC"
  }]))
  const jsonOversize = Buffer.alloc(Model.maxSearchBytes() + 4096, 0x78)
  const jsonSmallOversize = Buffer.alloc(8192, 0x79)
  const tileOversize = Buffer.alloc(Model.maxTileBytes() + 4096, 0x7a)
  const tileSmallOversize = Buffer.alloc(8192, 0x7b)
  const junk = Buffer.from("not-a-png-image")

  const server = http.createServer(function(req, res) {
    res.on("error", function() {})
    const url = req.url.split("?")[0]
    if (url === "/json/ok") return sendChunked(res, jsonOk, 32)
    if (url === "/json/oversize") return sendChunked(res, jsonOversize, 1024)
    if (url === "/json/small-oversize") return sendChunked(res, jsonSmallOversize, 256)
    if (url.indexOf("/tile/ok/") === 0) return sendChunked(res, pngOk, 128)
    if (url.indexOf("/tile/tiny/") === 0) return sendChunked(res, pngTiny, 16)
    if (url.indexOf("/tile/junk/") === 0) return sendChunked(res, junk, 8)
    if (url.indexOf("/tile/oversize/") === 0) return sendChunked(res, tileOversize, 1024)
    if (url.indexOf("/tile/small-oversize/") === 0) return sendChunked(res, tileSmallOversize, 256)
    res.writeHead(404)
    res.end()
  })
  server.listen(0, "127.0.0.1", function() {
    process.stdout.write("PORT=" + server.address().port + "\n")
  })
}

function startServer() {
  const child = spawn(process.execPath, [__filename, "--server"], {
    stdio: ["ignore", "pipe", "inherit"]
  })
  return new Promise(function(resolve, reject) {
    let started = false
    let buf = ""
    const timer = setTimeout(function() {
      child.kill("SIGKILL")
      reject(new Error("chunked fixture server did not start"))
    }, 5000)
    child.stdout.on("data", function(chunk) {
      buf += chunk
      const match = buf.match(/PORT=(\d+)/)
      if (!match || started) return
      started = true
      clearTimeout(timer)
      resolve({
        child: child,
        port: Number(match[1]),
        base: "http://127.0.0.1:" + match[1]
      })
    })
    child.on("error", function(err) {
      if (!started) reject(err)
    })
    child.on("exit", function(code) {
      if (!started) reject(new Error("chunked fixture server exited " + code))
    })
  })
}

function responseHeaders(url) {
  return new Promise(function(resolve, reject) {
    http.get(url, function(res) {
      resolve(res.headers)
      res.resume()
    }).on("error", reject)
  })
}

function runCurl(url, maxBytes) {
  const cmd = Model.curlCommand(url, Model.userAgent(), maxBytes)
  return spawnSync(cmd[0], cmd.slice(1), { encoding: "buffer", timeout: 15000, maxBuffer: 2 * 1024 * 1024 })
}

function runTiles(cacheDir, tiles, baseUrl, maxBytes) {
  const script = Model.tileFetchScript(cacheDir, tiles, Model.userAgent(), baseUrl, maxBytes)
  return spawnSync("bash", ["-lc", script], { encoding: "buffer", timeout: 20000 })
}

function listCache(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).sort()
}

async function main() {
  const srv = await startServer()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quickmap-http-"))
  try {
    const jsonHeaders = await responseHeaders(srv.base + "/json/oversize")
    assert.ok(!jsonHeaders["content-length"], "oversize JSON fixture must omit Content-Length")
    assert.ok(String(jsonHeaders["transfer-encoding"] || "").indexOf("chunked") !== -1)
    const tileHeaders = await responseHeaders(srv.base + "/tile/oversize/2/3/3.png")
    assert.ok(!tileHeaders["content-length"], "oversize tile fixture must omit Content-Length")
    assert.ok(String(tileHeaders["transfer-encoding"] || "").indexOf("chunked") !== -1)

    const okJson = runCurl(srv.base + "/json/ok")
    assert.strictEqual(okJson.status, 0, String(okJson.stderr || ""))
    const parsed = Model.parseSearchResults(okJson.stdout.toString())
    assert.strictEqual(parsed.length, 1)
    assert.strictEqual(parsed[0].name, "White House")

    const overJson = runCurl(srv.base + "/json/oversize")
    assert.notStrictEqual(overJson.status, 0)
    assert.strictEqual(overJson.stdout.length, 0)
    assert.deepStrictEqual(Model.parseSearchResults(String(overJson.stdout)), [])

    const smallOver = runCurl(srv.base + "/json/small-oversize", 2048)
    assert.notStrictEqual(smallOver.status, 0)
    assert.strictEqual(smallOver.stdout.length, 0)

    const okDir = path.join(tmp, "ok")
    const okTiles = runTiles(okDir, [{ z: 2, x: 0, y: 0 }], srv.base + "/tile/ok")
    assert.strictEqual(okTiles.status, 0, String(okTiles.stderr || okTiles.stdout || ""))
    const okFile = path.join(okDir, "2-0-0.png")
    assert.ok(fs.existsSync(okFile))
    assert.ok(fs.statSync(okFile).size > 24)
    assert.ok(fs.statSync(okFile).size <= Model.maxTileBytes())
    assert.deepStrictEqual(listCache(okDir).filter(function(name) { return name.indexOf(".part") !== -1 }), [])

    const tinyDir = path.join(tmp, "tiny")
    const tinyTiles = runTiles(tinyDir, [{ z: 2, x: 1, y: 1 }], srv.base + "/tile/tiny")
    assert.ok(tinyTiles.status === 0 || tinyTiles.status === 1)
    assert.ok(!fs.existsSync(path.join(tinyDir, "2-1-1.png")))
    assert.deepStrictEqual(listCache(tinyDir).filter(function(name) { return name.indexOf(".part") !== -1 }), [])

    const junkDir = path.join(tmp, "junk")
    runTiles(junkDir, [{ z: 2, x: 2, y: 2 }], srv.base + "/tile/junk")
    assert.ok(!fs.existsSync(path.join(junkDir, "2-2-2.png")))
    assert.deepStrictEqual(listCache(junkDir), [])

    const overDir = path.join(tmp, "over")
    const overTiles = runTiles(overDir, [{ z: 2, x: 3, y: 3 }], srv.base + "/tile/oversize")
    assert.ok(overTiles.status === 0 || overTiles.status === 1)
    assert.ok(!fs.existsSync(path.join(overDir, "2-3-3.png")))
    assert.deepStrictEqual(listCache(overDir).filter(function(name) { return name.indexOf(".part") !== -1 }), [])

    const smallDir = path.join(tmp, "small")
    runTiles(smallDir, [{ z: 2, x: 4, y: 4 }], srv.base + "/tile/small-oversize", 1024)
    assert.ok(!fs.existsSync(path.join(smallDir, "2-4-4.png")))
    assert.deepStrictEqual(listCache(smallDir), [])
  } finally {
    try { srv.child.kill("SIGKILL") } catch (e) {}
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[2] === "--server") runServer()
else main().then(function() {
  console.log("http-size ok")
}).catch(function(err) {
  console.error(err)
  process.exit(1)
})
