local mp = require("mp")
local msg = require("mp.msg")

local function is_local_torrent(url)
    local authority, resource = url:lower():match("^https?://([^/]+)(/.*)$")
    if not authority then return false end

    local host, port = authority:match("^(.-):(%d+)$")
    local service = (host == "127.0.0.1" or host == "localhost" or host == "[::1]")
        and port:match("^1147[0-4]$")
    local secure_service = authority == "local.strem.io:12470" and url:lower():sub(1, 8) == "https://"
    if not service and not secure_service then return false end

    local hash, file = resource:match("^/(%x+)/([^/?#]+)")
    return hash and #hash == 40 and file:match("^%-?%d+$") ~= nil
end

mp.add_hook("on_load", 50, function()
    if not is_local_torrent(mp.get_property("path", "")) then return end

    -- These values expire at end-file, so local files and other URLs retain their settings.
    local options = {
        ["cache"] = "yes",
        ["cache-pause"] = "yes",
        ["cache-pause-initial"] = "yes",
        ["cache-pause-wait"] = "5",
        ["cache-secs"] = "50",
        ["demuxer-max-bytes"] = "768MiB",
        ["demuxer-max-back-bytes"] = "96MiB",
    }
    for name, value in pairs(options) do
        local ok, err = mp.set_property("file-local-options/" .. name, value)
        if not ok then msg.warn("Could not set " .. name .. ": " .. tostring(err)) end
    end
end)
