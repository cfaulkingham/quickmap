# QuickMap

Look up an address or get driving and walking directions in a small Omarchy
bar popup. Geocoding, routes, and map tiles all come from OpenStreetMap
services. The bar icon does no network work until you search.

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
  your current location (Omarchy weather coordinates, or an IP estimate)
- Arrow keys move through suggestions; Enter selects
- Click the map (or **Expand** / **View all**) for a larger centered map
- Drag to pan, scroll or use **+** / **−** to zoom; Escape closes the map
- **Print** sends the turn-by-turn list to the default printer. If none is
  set up, it says so in the plugin instead of opening a browser
- **Cache offline** (on the expanded map, or **Cache** on the popup) downloads
  the current area at nearby zoom levels into `~/.cache/quickmap/tiles`
- **Open in browser** opens the same place or route on openstreetmap.org
  in another app
- Escape closes the expanded map, then the panel
- **Super+Ctrl+M** toggles the plugin (same pattern as Audio, Network, etc.)

To bind it yourself:

```sh
omarchy-shell shell toggle io.github.cfaulkingham.quickmap '{}'
```

## Configure

```sh
omarchy bar move io.github.cfaulkingham.quickmap --section right
```

## Data

Personal, light use of public OSM endpoints. Each request sends an identifying
User-Agent. Tiles are cached in `~/.cache/quickmap/tiles`. After a view loads,
neighboring tiles and the next zoom levels are fetched in the background so pan
and zoom stay on the cache. **Cache offline** saves a larger block of the area
you are looking at (a few zoom levels, capped) so that map works without a
network. Address search and routing still need the internet.

| Need | Service |
| --- | --- |
| Address search | [Nominatim](https://nominatim.openstreetmap.org/) |
| Drive / walk routes | [OSRM](https://router.project-osrm.org/) |
| Map tiles | [tile.openstreetmap.org](https://operations.osmfoundation.org/policies/tiles/) |

© OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).

## Remove

```sh
omarchy plugin remove io.github.cfaulkingham.quickmap
```
