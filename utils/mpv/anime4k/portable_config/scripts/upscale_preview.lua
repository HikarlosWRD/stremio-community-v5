-- SPDX-License-Identifier: GPL-3.0-or-later
local mp = require("mp")
local msg = require("mp.msg")
local utils = require("mp.utils")

local function anime(restore, upscale, extra)
    local files = {"Anime4K_Clamp_Highlights"}
    if restore then files[#files + 1] = restore end
    files[#files + 1] = upscale
    files[#files + 1] = "Anime4K_AutoDownscalePre_x2"
    files[#files + 1] = "Anime4K_AutoDownscalePre_x4"
    if extra then files[#files + 1] = extra end
    files[#files + 1] = "Anime4K_Upscale_CNN_x2_M"
    for i, file in ipairs(files) do files[i] = file .. ".glsl" end
    return files
end

local profiles = {
    off = {name = "Desligado"},
    rtx = {name = "NVIDIA RTX VSR", vendor = "nvidia"},
    intel = {name = "Intel VSR", vendor = "intel"},
    ewa = {name = "EWA Lanczos", scale = "ewa_lanczos"},
    fsr = {name = "AMD FSR 1", shaders = {"FSR.glsl"}},
    fsrcnnx = {name = "FSRCNNX", min_scale = 1.3, shaders = {"FSRCNNX_x2_8-0-4-1.glsl"}},
    anime_fast = {name = "Anime4K Performance", shaders = {
        "Anime4K_Clamp_Highlights.glsl", "Anime4K_Upscale_CNN_x2_M.glsl"
    }},
    anime_a = {name = "Anime4K A", shaders = anime("Anime4K_Restore_CNN_VL", "Anime4K_Upscale_CNN_x2_VL")},
    anime_b = {name = "Anime4K B", shaders = anime("Anime4K_Restore_CNN_Soft_VL", "Anime4K_Upscale_CNN_x2_VL")},
    anime_c = {name = "Anime4K C", shaders = anime(nil, "Anime4K_Upscale_Denoise_CNN_x2_VL")},
    anime_aa = {name = "Anime4K A+A", shaders = anime("Anime4K_Restore_CNN_VL", "Anime4K_Upscale_CNN_x2_VL", "Anime4K_Restore_CNN_M")},
    anime_bb = {name = "Anime4K B+B", shaders = anime("Anime4K_Restore_CNN_Soft_VL", "Anime4K_Upscale_CNN_x2_VL", "Anime4K_Restore_CNN_Soft_M")},
    anime_ca = {name = "Anime4K C+A", shaders = anime(nil, "Anime4K_Upscale_Denoise_CNN_x2_VL", "Anime4K_Restore_CNN_M")},
}

local selected = "off"
local applied_key = "off"
local added_shaders = {}
local saved_scale
local vpp_label = "@stremio_upscale"
local vpp_installed = false
local last_status
local last_error

local function clear_effect()
    if vpp_installed then
        mp.commandv("vf", "remove", vpp_label)
        vpp_installed = false
    end
    if next(added_shaders) then
        local keep = {}
        for _, path in ipairs(mp.get_property_native("options/glsl-shaders", {})) do
            if not added_shaders[path] then keep[#keep + 1] = path end
        end
        mp.set_property_native("options/glsl-shaders", keep)
        added_shaders = {}
    end
    if saved_scale then
        mp.set_property("options/scale", saved_scale)
        saved_scale = nil
    end
end

local function apply_effect(profile, factor)
    if profile.vendor then
        local filter = ("%s:d3d11vpp=scale=%.3f:scaling-mode=%s"):format(vpp_label, factor, profile.vendor)
        local ok, err = mp.commandv("vf", "add", filter)
        vpp_installed = not not ok
        return ok, err
    elseif profile.scale then
        saved_scale = mp.get_property("options/scale")
        return mp.set_property("options/scale", profile.scale)
    elseif profile.shaders then
        local existing = mp.get_property_native("options/glsl-shaders", {})
        local paths = {}
        for _, file in ipairs(profile.shaders) do
            local path = mp.command_native({"expand-path", "~~/shaders/" .. file})
            if not path or not utils.file_info(path) then return nil, "shader ausente: " .. file end
            paths[#paths + 1] = path
        end
        local present = {}
        for _, path in ipairs(existing) do present[path] = true end
        for _, path in ipairs(paths) do
            if not present[path] then
                added_shaders[path] = true
                existing[#existing + 1] = path
            end
        end
        return mp.set_property_native("options/glsl-shaders", existing)
    end
    return true
end

local function plan(profile)
    if selected == "off" then return "off", "Desligado" end
    local source = mp.get_property_native("video-params")
    local viewport = mp.get_property_native("osd-dimensions")
    if not source or not source.dw or not source.dh or not viewport or viewport.w == 0 or viewport.h == 0 then
        return "off", "aguardando vídeo"
    end
    if source.gamma == "pq" or source.gamma == "hlg" then return "off", "HDR preservado" end
    local width = viewport.w - viewport.ml - viewport.mr
    local height = viewport.h - viewport.mt - viewport.mb
    local factor = math.min(width / source.dw, height / source.dh)
    if factor < (profile.min_scale or 1.06) then return "off", "escala insuficiente para o perfil" end

    local vo = mp.get_property("current-vo")
    if vo ~= "gpu-next" and vo ~= "gpu" then return "off", "saída GPU indisponível" end
    if not profile.vendor then return selected, "aplicado" end

    if mp.get_property("options/gpu-context") ~= "d3d11" then
        return "off", "requer contexto D3D11"
    end
    if source.h < 360 or source.h > 1440 or source.w > 2560 then
        return "off", "fonte fora do intervalo do VSR"
    end
    factor = math.min(4, math.floor(factor * 16) / 16)
    return selected .. ":" .. factor, ("filtro %.2fx enviado ao driver"):format(factor), factor
end

local function refresh(show)
    local profile = profiles[selected]
    local key, status, factor = plan(profile)
    if key ~= applied_key then
        clear_effect()
        applied_key = key
        last_error = nil
        if key ~= "off" then
            local ok, err = apply_effect(profile, factor)
            if not ok then
                clear_effect()
                last_error = tostring(err or "erro ao aplicar")
            end
        end
    end
    local text = "Upscale " .. profile.name
    if selected ~= "off" then text = text .. " | " .. (last_error or status) end
    if text ~= last_status then
        msg.info(text)
        last_status = text
    end
    if show then mp.osd_message(text, 3) end
end

local update = mp.add_timeout(0.25, function() refresh(false) end)
update:kill()
local function schedule()
    update:kill()
    update:resume()
end

mp.register_script_message("preset", function(mode)
    if profiles[mode] then
        selected = mode
        -- Re-selecting a failed preset allows a retry after changing driver/settings.
        if last_error then applied_key = "off" end
    elseif mode ~= "status" then
        return
    end
    refresh(true)
end)

mp.register_event("start-file", function()
    clear_effect()
    applied_key = "off"
    last_error = nil
end)
mp.observe_property("osd-dimensions", "native", schedule)
mp.observe_property("video-params", "native", schedule)
mp.observe_property("current-vo", "string", schedule)
