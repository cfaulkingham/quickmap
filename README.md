# QuickMap

Look up an address or get driving and walking directions in a small Omarchy
bar popup. Geocoding, routes, and map tiles come from OpenStreetMap services.
An IP city estimate is available only after you turn it on. The bar icon does
no network work until you search, cache tiles, or opt in to that estimate.

## Install

From this folder while developing:

```sh
PLUGIN_ID="io.github.cfaulkingham.quickmap"
PLUGIN_DIR="$HOME/.config/omarchy/plugins/$PLUGIN_ID"
mkdir -p "$PLUGIN_DIR"
rsync -a --delete --exclude .git --exclude test "$PWD/" "$PLUGIN_DIR/"
omarchy-shell shell rescanPlugins
omarchy plugin enable "$PLUGIN_ID" --section right
```

From a public repository:

```sh
omarchy plugin add https://github.com/cfaulkingham/quickmap.git --enable
```

## Usage

- Left-click the map marker to open or close the panel
- **Cache** and **Open in browser** stay off until a map is showing
- With no network, search fields disable and the panel says
  "Offline — search not available" instead of "No results"
- **Lookup** — type an address, city, or `lat, lon` and press Enter
- **Drive** / **Walk** — destination in **To**; leave **From** empty to use
  your current location (Omarchy weather coordinates first)
- **Estimate start from IP** is off until you turn it on. It asks ipwho.is
  for a city-level location only in Drive/Walk when weather has no coords
- Arrow keys move through suggestions; Enter selects
- Click the map (or **Expand** / **View all**) for a larger top-down map
- On driving or walking directions, drag the route line to send the path
  through that point; drag a white point to move it, or click it to remove it
- Drag to pan, scroll or use **+** / **−** to zoom; Escape closes the map
- **Print** sends the turn-by-turn list to the default printer. If none is
  set up, it says so in the plugin instead of opening a browser
- **Cache offline** (on the expanded map, or **Cache** on the popup) downloads
  the current area at nearby zoom levels into `~/.cache/quickmap/tiles`
- **Open in browser** opens the same place or route on openstreetmap.org
  in another app
- Escape closes the expanded map, then the panel

To bind a compositor shortcut yourself (for example Super+Ctrl+M):

```sh
omarchy-shell shell toggle io.github.cfaulkingham.quickmap '{}'
```

## Configure

```sh
omarchy bar move io.github.cfaulkingham.quickmap --section right
```

## Data

Personal, light use of public HTTPS endpoints. Nominatim, OSRM (drive and
walk), and tile requests send an identifying User-Agent. The IP estimate uses a User-Agent
without an email address. Tiles are cached in `~/.cache/quickmap/tiles`
(or `$XDG_CACHE_HOME/quickmap/tiles` when that directory is under your home).
After a view loads, neighboring tiles and the next zoom levels are fetched in
the background so pan and zoom stay on the cache. **Cache offline** saves a
larger block of the area you are looking at (a few zoom levels, capped) so
that map works without a network. Address search, routing, and IP estimates
still need the internet.

| Need | Service | When |
| --- | --- | --- |
| Address search | [Nominatim](https://nominatim.openstreetmap.org/) | You type a lookup |
| Drive routes | [OSRM](https://router.project-osrm.org/) | Drive with both ends set |
| Walk routes | [FOSSGIS OSRM foot](https://routing.openstreetmap.de/) | Walk with both ends set |
| Map tiles | [tile.openstreetmap.org](https://operations.osmfoundation.org/policies/tiles/) | A map is showing, or you cache offline |
| Optional city-level IP estimate | [ipwho.is](https://ipwho.is/) | You turn on **Estimate start from IP** |

© OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).

## Remove

```sh
omarchy plugin remove io.github.cfaulkingham.quickmap
```

That removes the plugin from Omarchy. Cached map tiles in
`~/.cache/quickmap/tiles` (or `$XDG_CACHE_HOME/quickmap/tiles`) are kept.
Delete that folder yourself if you do not want them to remain.
